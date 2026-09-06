import { describe, expect, it } from 'vitest'
import {
  beforeForOlder,
  isCurrentRequest,
  mergeOlder,
  nextOlderOutcome,
  nextSinceOutcome,
  nextSyncAction,
} from './use-chat-sync.ts'
import type { ChatMessage } from './use-chat-sync.ts'
import type { Id } from '../../../convex/_generated/dataModel'

const at = (lastMessageAt: number, revision: number) => ({ lastMessageAt, revision, degraded: false })

describe('nextSyncAction', () => {
  it('loads the window when we hold nothing', () => {
    expect(nextSyncAction(null, at(500, 3), 0)).toEqual({ kind: 'window' })
  })

  it('does nothing when the pointer has not moved', () => {
    expect(nextSyncAction(at(500, 3), at(500, 3), 500)).toEqual({ kind: 'none' })
  })

  // The ordinary case: a new message arrived, so fetch only what we lack.
  it('appends from our newest when lastMessageAt advances', () => {
    expect(nextSyncAction(at(500, 3), at(600, 4), 500)).toEqual({ kind: 'since', since: 500 })
  })

  // A DELETE looks like this: history changed, but the newest message did not
  // move. We cannot know WHICH message went, so the window is refetched.
  it('refetches the window when revision moves alone', () => {
    expect(nextSyncAction(at(500, 3), at(500, 4), 500)).toEqual({ kind: 'window' })
  })

  // Both moved: a send and a delete coalesced into one delivered update. The
  // append would miss the deletion, so the window wins.
  it('prefers the window when both moved by more than one revision', () => {
    expect(nextSyncAction(at(500, 3), at(600, 5), 500)).toEqual({ kind: 'window' })
  })
})

describe('isCurrentRequest', () => {
  it('is current when nothing has dispatched since', () => {
    expect(isCurrentRequest(1, 1)).toBe(true)
  })

  // The ordinary race this guards against: a fetch dispatched as #1 is still
  // resolving when the pointer fires again and dispatches #2. #1's answer, if
  // applied, would overwrite whatever #2 goes on to set.
  it('is stale once a later request has dispatched', () => {
    expect(isCurrentRequest(1, 2)).toBe(false)
  })

  // Not merely "not equal": an id from the future never wins either, which is
  // what keeps this a plain equality check rather than mine >= latest.
  it('is stale when checked against an id from before it was dispatched', () => {
    expect(isCurrentRequest(2, 1)).toBe(false)
  })
})

describe('nextSinceOutcome', () => {
  const message = (createdAt: number): ChatMessage => ({
    _id: `msg_${createdAt}` as Id<'chatMessages'>,
    playerId: 'player_1' as Id<'players'>,
    body: 'hi',
    createdAt,
  })

  it('appends the fetched messages onto what is held', () => {
    const held = [message(100)]
    expect(nextSinceOutcome(held, { gap: false, messages: [message(200)] })).toEqual({
      kind: 'messages',
      messages: [message(100), message(200)],
    })
  })

  it('refetches the window on a gap', () => {
    expect(nextSinceOutcome([message(100)], { gap: true })).toEqual({ kind: 'window' })
  })

  // Not merely equal contents — the SAME array reference, which is what lets
  // setMessages bail out of the re-render via React's Object.is check instead
  // of committing a fresh array with nothing new in it.
  it('is a no-op, by reference, when nothing new came back', () => {
    const held = [message(100)]
    const outcome = nextSinceOutcome(held, { gap: false, messages: [] })
    expect(outcome).toEqual({ kind: 'messages', messages: held })
    expect(outcome.kind === 'messages' && outcome.messages).toBe(held)
  })
})

// Scrollback's three pure decisions. Shared helper rather than three copies of
// the one inside `nextSinceOutcome` above; `body` doubles as an identity label
// in the assertions, which is why it varies here and does not there.
const older = (createdAt: number, body = `m${createdAt}`): ChatMessage => ({
  _id: `msg_${createdAt}` as Id<'chatMessages'>,
  playerId: 'player_1' as Id<'players'>,
  body,
  createdAt,
})

describe('beforeForOlder', () => {
  // NOT 0, and not "just fire it anyway". `olderMessages` is a metered,
  // rate-limited mutation: a request that can only come back empty still
  // spends one of the ten pages a minute the caller gets.
  it('has nothing to page from when nothing is held', () => {
    expect(beforeForOlder([])).toBeNull()
  })

  // The OLDEST held, not the newest: the server takes messages strictly
  // before this timestamp, so anything else re-reads a page we already have.
  it('pages from the oldest held message', () => {
    expect(beforeForOlder([older(100), older(200), older(300)])).toBe(100)
  })
})

describe('nextOlderOutcome', () => {
  it('puts a fetched page ahead of the pages already held', () => {
    expect(nextOlderOutcome([older(300)], [older(100), older(200)])).toEqual({
      kind: 'pages',
      pages: [older(100), older(200), older(300)],
    })
  })

  // History only ever grows NEWER, so an empty page is proof there is nothing
  // before this point — permanently, not just now. That is what lets the
  // route retire the button rather than leave it there to spend rate-limit
  // budget on a question already answered.
  it('reports the start of history when a page comes back empty', () => {
    expect(nextOlderOutcome([older(300)], [])).toEqual({ kind: 'start' })
  })

  it('stays oldest-first across successive pages', () => {
    const first = nextOlderOutcome([], [older(300)])
    const pages = first.kind === 'pages' ? first.pages : []
    expect(nextOlderOutcome(pages, [older(100), older(200)])).toEqual({
      kind: 'pages',
      pages: [older(100), older(200), older(300)],
    })
  })
})

describe('mergeOlder', () => {
  it('renders held pages ahead of the live window', () => {
    expect(mergeOlder([older(100)], [older(200)])).toEqual([older(100), older(200)])
  })

  // THE DUPLICATE-KEY BUG THIS EXISTS TO PREVENT. The live window is the
  // newest RECENT_WINDOW messages, refetched whole on every delete — so
  // deleting a recent message pulls one older message INTO the window, and
  // that message may already be sitting in a page scrollback fetched earlier.
  // Rendered as-is that is the same `_id` twice in one <ol>. The live copy
  // wins because it is the one the pointer keeps current.
  it('drops an older copy of a message the live window has since taken in', () => {
    const shown = mergeOlder([older(100), older(200)], [older(200, 'live'), older(300)])
    expect(shown).toEqual([older(100), older(200, 'live'), older(300)])
  })

  // The same Object.is bail-out `nextSinceOutcome` protects: before anyone
  // presses "load older" this runs on every single render of the list.
  it('is the live window itself, by reference, when no page is held', () => {
    const live = [older(200)]
    expect(mergeOlder([], live)).toBe(live)
  })
})
