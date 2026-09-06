import { describe, expect, it } from 'vitest'
import { isCurrentRequest, nextSyncAction } from './use-chat-sync.ts'

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
