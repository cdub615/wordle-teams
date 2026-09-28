// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime, and `.hook.test.ts` for the
// precedent app-menu / Header / monthly-winner-celebration set. `.test.ts`
// rather than `.test.tsx` because vitest.config.ts's glob is
// `src/**/*.test.ts`, so the one element below goes through `createElement`.
//
// WHY THIS FILE IS NOT A PURE-FUNCTION TEST, WHEN EVERY OTHER RULE IN
// use-chat-sync.ts IS ONE (wordle-teams-pnhe).
//
// The decision to stop reading a query is pure and IS tested next door:
// `unreadArgs` returns `'skip'` while degraded, and `shouldDropSubscription`
// says when the held query must go. Neither of those can prove the thing that
// actually matters, because the bandwidth this valve exists to shed is spent by
// a WEBSOCKET SUBSCRIPTION, not by a React hook reading a value — and whether
// that socket closes is a fact about @convex-dev/react-query and TanStack's
// query cache, not about our arithmetic.
//
// AND THE LIBRARY'S BEHAVIOUR IS THE TRAP. It opens its Convex watch on the
// query cache's `added` event and closes it on `removed` — explicitly NOT on
// `observerRemoved`, whose handler is an empty block carrying the comment
// "don't clean up yet, after gcTime a 'removed' event will notify"
// (node_modules/@convex-dev/react-query/dist/esm/index.js). So the obvious fix —
// `enabled: false`, which is what `'skip'` compiles to — removes the OBSERVER
// and leaves the socket open for a full gcTime, five minutes by default, per
// degraded client. A suite that asserted only on `unreadArgs` would be
// completely green with the subscription still running.
//
// SO THIS DRIVES THE REAL LIBRARY. A real TanStack QueryClient, a real
// ConvexQueryClient connected to it, and the real hook; only the Convex client
// underneath is a fake, and it is faked at exactly the seam the library uses —
// `watchQuery(...).onUpdate(cb)` returning an unsubscribe. The assertion is
// that unsubscribe is CALLED, promptly, when the answer says degraded. That is
// the whole of what "shed" means.
import { ConvexQueryClient } from '@convex-dev/react-query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useUnreadTeams } from './use-chat-sync.ts'
import type { ConvexReactClient } from 'convex/react'
import type { Id } from '../../../convex/_generated/dataModel'

const TEAM = 'team_a' as Id<'teams'>

/** What the fake backend currently answers, and what the watch pushes. */
let answer: { unread: Array<Id<'teams'>>; degraded: boolean }
/** The library's own update callback, so a test can push a new answer. */
let push: (() => void) | null
let unsubscribe: ReturnType<typeof vi.fn>
let watchQuery: ReturnType<typeof vi.fn>
let queryClient: QueryClient
let convexQueryClient: ConvexQueryClient

beforeEach(() => {
  answer = { unread: [TEAM], degraded: false }
  push = null
  unsubscribe = vi.fn()
  watchQuery = vi.fn(() => ({
    onUpdate: (callback: () => void) => {
      push = callback
      return unsubscribe
    },
    localQueryResult: () => answer,
  }))

  // The seam: everything above the `watchQuery`/`query` pair is the real
  // library. Mirrors src/router.tsx's wiring exactly — hashFn and queryFn on
  // the client's defaults, then `connect` — because the ordering of those three
  // is what decides whether the cache events reach the library at all.
  convexQueryClient = new ConvexQueryClient({
    watchQuery,
    query: async () => answer,
    url: 'https://example.convex.cloud',
  } as unknown as ConvexReactClient)
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  convexQueryClient.connect(queryClient)
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

/** Renders the hook and reports what it answers, so both halves are visible. */
function mountBadge(teamIds: Array<Id<'teams'>> | undefined) {
  function Probe() {
    const { unread, degraded } = useUnreadTeams(teamIds)
    return createElement(
      'div',
      { 'data-testid': 'probe' },
      `${degraded ? 'degraded' : 'live'}:${(unread ?? ['?']).join(',')}`,
    )
  }
  return render(
    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
  )
}

test('holds one live watch while the month is under budget', async () => {
  const view = mountBadge([TEAM])

  await waitFor(() => {
    expect(view.getByTestId('probe').textContent).toBe(`live:${TEAM}`)
  })
  expect(watchQuery).toHaveBeenCalledTimes(1)
  expect(unsubscribe).not.toHaveBeenCalled()
})

/**
 * THE ASSERTION THE WHOLE ISSUE IS ABOUT.
 *
 * `unsubscribe` is what closes the Convex watch. It is called from the cache's
 * `removed` event and from nowhere else, so this passes only if the query is
 * genuinely removed from the cache — `enabled: false` alone leaves it there for
 * gcTime (five minutes) and this test would time out rather than merely
 * reporting a different value.
 */
test('drops the watch outright the moment the answer says degraded', async () => {
  const view = mountBadge([TEAM])
  await waitFor(() => {
    expect(view.getByTestId('probe').textContent).toBe(`live:${TEAM}`)
  })

  answer = { unread: [TEAM], degraded: true }
  act(() => push?.())

  await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1))
  // AND NOTHING RE-OPENS IT. A shed that immediately re-subscribed — which is
  // what removing a query somebody is still observing produces — would show up
  // here as a second `watchQuery`.
  expect(watchQuery).toHaveBeenCalledTimes(1)
})

/**
 * THE BADGE DOES NOT GO BLANK WHEN IT GOES QUIET. Removing the query empties
 * TanStack's cache for that key, so a hook that read `query.data` would answer
 * `undefined` — and `hasUnread` reads `undefined` as "no dot". Every dot on the
 * dashboard would vanish the instant chat degraded, which reports something
 * false rather than something stale.
 */
test('keeps answering the last unread it saw after it has stopped listening', async () => {
  const view = mountBadge([TEAM])
  await waitFor(() => {
    expect(view.getByTestId('probe').textContent).toBe(`live:${TEAM}`)
  })

  answer = { unread: [TEAM], degraded: true }
  act(() => push?.())

  await waitFor(() => {
    expect(view.getByTestId('probe').textContent).toBe(`degraded:${TEAM}`)
  })
})

/**
 * NOTHING IS OPENED BEFORE THE TEAM LIST RESOLVES, which is the pre-existing
 * `'skip'` and is pinned here because `unreadArgs` now folds two reasons to
 * skip into one answer and a regression in either looks the same from outside.
 */
test('opens no watch at all until the caller knows its teams', async () => {
  mountBadge(undefined)
  await waitFor(() => expect(watchQuery).not.toHaveBeenCalled())
})
