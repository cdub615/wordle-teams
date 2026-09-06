import { describe, expect, it } from 'vitest'
import {
  beforeForOlder,
  chatEntryLabel,
  chatHeading,
  hasUnread,
  hasUnreadElsewhere,
  isCurrentRequest,
  mergeOlder,
  nextOlderOutcome,
  nextSinceOutcome,
  nextSyncAction,
  teamPickerLabel,
  unreadTeamIds,
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

/**
 * THE ARGUMENT THAT REPLACED A FULL `teams` SCAN (wordle-teams-w7g2), and the
 * single thing standing between the badge and TWO Convex subscriptions.
 *
 * `unreadTeams` used to take no arguments, so every caller of it — the
 * dashboard, the picker's trigger, each row badge — hashed to one TanStack
 * query key for free. Now that it takes ids, the key IS the ids, and two
 * callers that build the same set in a different order get two cache entries,
 * two subscriptions and two server executions for one answer. Sorting is what
 * makes the key a function of the SET rather than of the order somebody
 * happened to render in.
 */
describe('unreadTeamIds', () => {
  const alpha = 'team_alpha'
  const beta = 'team_beta'
  const gamma = 'team_gamma'

  it('is the ids, in an order that does not depend on the caller', () => {
    expect(unreadTeamIds([{ id: gamma }, { id: alpha }, { id: beta }])).toEqual([
      alpha,
      beta,
      gamma,
    ])
  })

  // THE PROPERTY THE SINGLE SUBSCRIPTION RESTS ON, stated directly rather than
  // implied by the case above: the same teams in any order are the same key.
  it('is the same array for the same teams however they arrive', () => {
    expect(unreadTeamIds([{ id: beta }, { id: alpha }])).toEqual(
      unreadTeamIds([{ id: alpha }, { id: beta }]),
    )
  })

  it('does not reorder the caller\'s own list', () => {
    // TeamPicker renders `teams` in createdAt order and the menu must keep it.
    // `.sort()` mutates in place, so building the ids without copying first
    // would silently re-sort the picker alphabetically.
    const teams = [{ id: gamma }, { id: alpha }]
    unreadTeamIds(teams)
    expect(teams).toEqual([{ id: gamma }, { id: alpha }])
  })

  /**
   * `undefined` IN, `undefined` OUT, WHICH IS NOT THE SAME AS `[]`.
   *
   * An unresolved TEAMS list is not an empty one. Collapsing it to `[]` would
   * send a real query asking about no teams, get a real `[]` back, and
   * `hasUnread` would then read that as the settled answer "nothing unread" —
   * the badge asserting something it has not been told. `undefined` keeps the
   * query skipped and leaves `hasUnread` in its own not-loaded branch.
   */
  it('stays unresolved while the teams list is', () => {
    expect(unreadTeamIds(undefined)).toBeUndefined()
  })

  it('is empty for someone with no teams, which IS an answer', () => {
    expect(unreadTeamIds([])).toEqual([])
  })
})

describe('hasUnread', () => {
  const alpha = 'team_alpha' as Id<'teams'>
  const beta = 'team_beta' as Id<'teams'>

  it('shows a dot for a team in the unread list', () => {
    expect(hasUnread([alpha, beta], alpha)).toBe(true)
  })

  it('shows no dot for a team that is not in it', () => {
    expect(hasUnread([beta], alpha)).toBe(false)
  })

  // THE "NOT LOADED YET" BRANCH, and the reason this is a function rather than
  // an inline `.includes`. `undefined` is TanStack's pre-resolution state, not
  // an answer; `[]` is the real "nothing unread". Reading the unknown state as
  // unread would flash a dot on every team on every page load.
  it('shows no dot while the query has not resolved', () => {
    expect(hasUnread(undefined, alpha)).toBe(false)
  })

  it('shows no dot when nothing at all is unread', () => {
    expect(hasUnread([], alpha)).toBe(false)
  })
})
/**
 * The dashboard's "Team chat" control names its own unread state, because the
 * dot inside it cannot: `aria-label` replaces an element's content in the
 * accessibility tree, `UnreadBadge`'s `role="img"` label included.
 */
describe('chatEntryLabel', () => {
  it('names the unread state, since the badge inside the button is not read out', () => {
    expect(chatEntryLabel(true)).toBe('Team chat, unread messages')
  })

  it('is the plain control name when there is nothing unread', () => {
    expect(chatEntryLabel(false)).toBe('Team chat')
  })

  // THE PAIR IS THE POINT, not either string on its own: a constant label —
  // which is what this control had before wordle-teams-qix.25, and what every
  // other icon-collapsing button in the app correctly has — passes lint,
  // typecheck, build and every rendering test, and silently takes the badge
  // away from anyone not looking at the screen.
  it('says something different in the two states', () => {
    expect(chatEntryLabel(true)).not.toBe(chatEntryLabel(false))
  })
})
/**
 * THE TRIGGER DOT'S WHOLE QUESTION, and it is not the same one `hasUnread`
 * answers. Radix unmounts TeamPicker's menu content when the menu is closed, so
 * the per-team dots do not exist at rest; this is what decides whether the
 * closed trigger says anything at all.
 */
describe('hasUnreadElsewhere', () => {
  const alpha = 'team_alpha' as Id<'teams'>
  const beta = 'team_beta' as Id<'teams'>
  const gamma = 'team_gamma' as Id<'teams'>

  it('lights up when a team other than the selected one is unread', () => {
    expect(hasUnreadElsewhere([beta], alpha)).toBe(true)
  })

  it('stays dark when the ONLY unread team is the one already on screen', () => {
    // THE CASE THE WHOLE FUNCTION EXISTS FOR. The dashboard's "Team chat"
    // button beside the picker already shows this team's unread, so a trigger
    // dot here would draw two dots for one fact — and would sit lit while the
    // reader is inside that very conversation, which is how a signal gets
    // trained out of someone.
    expect(hasUnreadElsewhere([alpha], alpha)).toBe(false)
  })

  it('lights up when the selected team is unread AND another one is too', () => {
    expect(hasUnreadElsewhere([alpha, beta], alpha)).toBe(true)
  })

  it('counts every unread team as an "other" when nothing is selected', () => {
    // A real state, not a defensive one: routes/app.tsx renders TeamPicker for
    // the renders before useDashboardSearchSync fills `?team=` in, and a stale
    // param can name a team the player has left.
    expect(hasUnreadElsewhere([alpha, beta], undefined)).toBe(true)
  })

  // THE LOADED CHECK, INHERITED FROM `hasUnread` RATHER THAN REWRITTEN. Both
  // "not resolved yet" and "resolved to nothing" must draw no dot, and only one
  // of those two is an answer.
  it('draws nothing while the query has not resolved', () => {
    expect(hasUnreadElsewhere(undefined, alpha)).toBe(false)
  })

  it('draws nothing while the query has not resolved and nothing is selected', () => {
    expect(hasUnreadElsewhere(undefined, undefined)).toBe(false)
  })

  it('draws nothing when no team at all is unread', () => {
    expect(hasUnreadElsewhere([], alpha)).toBe(false)
  })

  it('is unmoved by which of the others is unread', () => {
    expect(hasUnreadElsewhere([gamma], alpha)).toBe(true)
  })
})

/**
 * The trigger's accessible name, which has to carry the roll-up dot's meaning
 * because `aria-label` replaces the content the dot lives in.
 */
describe('teamPickerLabel', () => {
  it('is byte-for-byte the old name when nothing else is unread', () => {
    // TWO E2E SPECS LOCATE THIS TRIGGER BY ITS EXACT ACCESSIBLE NAME
    // (teams.spec.ts, billing.spec.ts) and Playwright matches the whole
    // string. Their seeds post no chat messages, so this is the branch they
    // run — pinned here so a change to it is a named failure in a suite CI
    // runs, rather than a surprise in one it does not.
    expect(teamPickerLabel('E2E Team', false)).toBe('Team: E2E Team')
  })

  it('says the unread is somewhere ELSE, never about the team it names', () => {
    // "Team: Alpha, unread messages" would read as a claim about Alpha — the
    // one team the dot is guaranteed NOT to be about.
    expect(teamPickerLabel('Alpha', true)).toBe('Team: Alpha, other teams have unread messages')
  })

  it('keeps the FULL name in both states, never the truncated one', () => {
    // team-picker.tsx paints `Some very long...` on the button and passes the
    // whole name here; truncation is a visual affordance, not something a
    // screen-reader user should have to sit through.
    const long = 'Some very long team name'
    expect(teamPickerLabel(long, true)).toContain(long)
    expect(teamPickerLabel(long, false)).toContain(long)
  })
})
/**
 * The chat page's heading, which until now did not exist: /chat rendered a
 * message list and a composer and never said whose conversation it was.
 */
describe('chatHeading', () => {
  const alpha = 'team_alpha' as Id<'teams'>
  const beta = 'team_beta' as Id<'teams'>
  const teams = [
    { id: 'team_alpha', name: 'White Famiglia' },
    { id: 'team_beta', name: 'Wordle Wizards' },
  ]

  it('names the team once getMyTeams has answered', () => {
    expect(chatHeading(teams, alpha)).toEqual({ kind: 'named', name: 'White Famiglia' })
  })

  it('picks the team in the URL, not the first one the player is on', () => {
    // The push notification that lands someone here names a SPECIFIC team, and
    // the whole point of the heading is confirming which conversation opened.
    expect(chatHeading(teams, beta)).toEqual({ kind: 'named', name: 'Wordle Wizards' })
  })

  // THE DISTINCTION THE WHOLE TYPE EXISTS FOR, and the same one `hasUnread`
  // draws: `undefined` is TanStack's pre-resolution state, not an answer.
  // Rendering a name from it is impossible, but rendering the OTHER state's
  // answer — a permanent generic title — would be wrong in the opposite
  // direction, since the name is about to arrive.
  it('is pending while getMyTeams has not resolved', () => {
    expect(chatHeading(undefined, alpha)).toEqual({ kind: 'pending' })
  })

  it('is unnamed for a team the player is not on, which is the outsider case', () => {
    // e2e/chat.spec.ts drives exactly this: a signed-in account opening
    // /chat?team=<someone else's team>. It asserts nothing of that
    // conversation leaks — the NAME included, which is why this is not
    // "pending" and not a name.
    expect(chatHeading(teams, 'team_gamma' as Id<'teams'>)).toEqual({ kind: 'unnamed' })
  })

  it('is unnamed, not pending, for a player on no teams at all', () => {
    // `[]` is a real answer, exactly as it is for hasUnread.
    expect(chatHeading([], alpha)).toEqual({ kind: 'unnamed' })
  })
})
