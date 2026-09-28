// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts): driving a real
// hook through @testing-library/react needs a DOM to mount into, and this one
// reads `window.location` and calls `window.history.replaceState`.
// `.hook.test.ts` matches the existing precedents beside it, and `.test.ts`
// rather than `.test.tsx` because vitest.config.ts's glob is `src/**/*.test.ts`.
//
// WHAT THIS REPLACES (wordle-teams-3jdu). These properties lived inside
// `Dashboard` in routes/app.tsx, which is not exported and cannot be rendered
// under vitest, so routes.test.ts held them with index and string comparisons
// over the file text — `code.indexOf("url.searchParams.delete('join')")` and
// friends. Those pin the TEXT: rename a local and they fail for nothing;
// restructure the effect and they pass while the property is gone. Everything
// below is behaviour.
//
// WHAT pending-invite.test.ts ALREADY OWNS, and is deliberately not repeated
// here: that the storage carrier survives a round trip, is cleared BY the read,
// and cannot throw when the store is blocked. This file is about which carrier
// wins, what happens to the address bar, and the ORDER of the two.
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PENDING_INVITE_KEY, rememberPendingInvite } from './pending-invite.ts'
import { usePendingInvite } from './use-pending-invite.ts'

afterEach(cleanup)

beforeEach(() => {
  sessionStorage.clear()
  window.history.replaceState({}, '', '/app')
})

/** Mounts the hook at `url` and reports every token it handed over. */
const mountAt = (url: string, joinParam?: string) => {
  window.history.replaceState({}, '', url)
  const seen: string[] = []
  const at: string[] = []
  renderHook(() =>
    usePendingInvite(joinParam, (token) => {
      seen.push(token)
      // CAPTURED INSIDE THE CALLBACK, which is the whole point of recording it:
      // it is what the address bar looked like AT THE MOMENT the token was
      // handed over, and the ordering assertion below depends on that rather
      // than on inspecting the world afterwards.
      at.push(window.location.search)
    }),
  )
  return { seen, at }
}

describe('usePendingInvite', () => {
  test('prefers the URL carrier over the stashed one', () => {
    // The two disagree on purpose. `?join=` is the faster carrier and wins
    // whenever it survived the trip; a `stashed ?? fromUrl` inversion would
    // spend a stale token from an abandoned earlier attempt instead.
    rememberPendingInvite('from-storage')
    const { seen } = mountAt('/app?join=from-url', 'from-url')
    expect(seen).toEqual(['from-url'])
  })

  test('falls back to the stashed one when the search param did not survive', () => {
    // /app's beforeLoad redirects an account with no player row to
    // /complete-profile, and that redirect drops the search params — which is
    // the whole reason a second carrier exists.
    rememberPendingInvite('from-storage')
    const { seen } = mountAt('/app')
    expect(seen).toEqual(['from-storage'])
  })

  test('hands over nothing when neither carrier has a token', () => {
    const { seen } = mountAt('/app')
    expect(seen).toEqual([])
  })

  test('strips ?join= from the address bar, keeping every other param and the hash', () => {
    rememberPendingInvite('unused')
    mountAt('/app?team=abc&join=tok&month=2026-09#board', 'tok')
    expect(window.location.search).toBe('?team=abc&month=2026-09')
    expect(window.location.hash).toBe('#board')
    expect(window.location.pathname).toBe('/app')
  })

  test('the URL is already stripped BY THE TIME the token is handed over', () => {
    // THE ORDERING THAT THE DOUBLE-CONSUME BUG WAS ABOUT, and the one property
    // the old source assertion could only approximate by comparing indexOf
    // positions. Dashboard remounts on this path and React re-runs effects on a
    // remount whatever the deps say, so if the token were spent before
    // replaceState the router would still be holding `?join=` and would hand it
    // over a second time.
    const { at } = mountAt('/app?join=tok', 'tok')
    expect(at).toEqual([''])
  })

  test('empties the storage carrier even when the URL carrier is the one that wins', () => {
    // Otherwise the stashed copy outlives the consume and is spent again on the
    // next mount — the same double-consume from the other direction.
    rememberPendingInvite('from-storage')
    mountAt('/app?join=from-url', 'from-url')
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull()
  })

  test('does not touch the address bar when there is no URL carrier', () => {
    // A replaceState on every dashboard load would be a pointless history write
    // on the overwhelmingly common path, and would fire for visitors who never
    // held an invite at all.
    //
    // THE SPY GOES ON AFTER THE URL IS POSITIONED, and the first draft of this
    // test got that wrong: `mountAt` sets the location with replaceState itself,
    // so a spy installed first counts its own setup and the test fails against
    // correct code. Positioned by hand here for that reason.
    rememberPendingInvite('from-storage')
    window.history.replaceState({}, '', '/app')
    const spy = vi.spyOn(window.history, 'replaceState')
    renderHook(() => usePendingInvite(undefined, () => {}))
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('a blocked store does not stop a URL-carried invite', () => {
    // pending-invite.ts guarantees takePendingInvite cannot throw; this is the
    // integration of that guarantee — a private-mode visitor following a link
    // must still be able to join.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    const { seen } = mountAt('/app?join=tok', 'tok')
    expect(seen).toEqual(['tok'])
    spy.mockRestore()
  })
})
