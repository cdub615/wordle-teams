import { useEffect, useRef } from 'react'
import { takePendingInvite } from '#/lib/pending-invite.ts'

/**
 * Resolves an invite token from its two carriers, empties BOTH, and hands the
 * token over exactly once (wordle-teams-3jdu).
 *
 * LIFTED OUT OF `Dashboard` SO ITS PROPERTIES CAN BE TESTED FOR REAL. This ran
 * inside routes/app.tsx, where the component is not exported (the repo's export
 * guard forbids it) and a route module cannot be rendered under vitest — so the
 * only thing holding it was a set of index and string comparisons over the file
 * text in routes.test.ts. Those pin the TEXT, not the behaviour: rename a local
 * and they go red for nothing, restructure the effect and they go green while
 * the property is gone. Same move, and the same reason, as `useStartUpgrade`.
 *
 * WHAT IT DOES NOT DO: spend the token. Consuming it needs a Convex mutation
 * and a toast, which is route business — the caller gets the token and decides.
 * That boundary is what lets this be driven by `renderHook` with no Convex
 * client, no router and no provider tree.
 *
 * TWO CARRIERS, AND NEITHER IS REDUNDANT. `?join=` is the faster one and wins
 * whenever it survives; it does not always survive, because /app's beforeLoad
 * redirects an account with no player row to /complete-profile and that drops
 * the search params. sessionStorage is the carrier that survives that hop.
 * routes/join.$token.tsx fills in both and this reads whichever arrived.
 *
 * BOTH ARE EMPTIED BEFORE THE TOKEN IS HANDED OVER, and that ordering is the
 * whole defect this code was shaped by. Instrumented on the signed-in path, the
 * original effect ran THREE times for one arrival:
 *
 *   joinParam=<token> stashed=<token>   -> consumed
 *   joinParam=<token> stashed=undefined -> consumed AGAIN
 *   joinParam=undefined
 *
 * The second run carries the same dependency value as the first, so it is a
 * REMOUNT, and React re-runs effects on a remount whatever the deps say.
 * `takePendingInvite` had already emptied the storage carrier, which is why
 * that one refused — but `navigate()` is asynchronous, so the router still held
 * `?join=` and handed it over a second time. A `useRef` guard is the plausible
 * wrong fix: a remount resets it too.
 *
 * `window.history.replaceState` IS THE FIX BECAUSE IT IS SYNCHRONOUS, so the
 * remount cannot beat it. The same mechanism the funnel marker in app.tsx uses,
 * for the same stated reason: "so a refresh or a share cannot double-count".
 *
 * READ FROM `window.location`, NOT FROM THE ROUTER, and the two are not
 * interchangeable here. The router's copy is precisely what survived the
 * remount; reading `joinParam` and merely replaceState-ing the address bar
 * would look identical in a diff and restore the double consume exactly.
 * `joinParam` is still the DEPENDENCY — it is what changes when a link holder
 * arrives — but it is never the value that gets spent.
 */
export function usePendingInvite(
  joinParam: string | undefined,
  onToken: (token: string) => void,
): void {
  // The callback is held in a ref rather than listed as a dependency, so a
  // caller passing an inline arrow — which every caller will — cannot re-run
  // this effect and spend a token twice. It also keeps the dependency array
  // honestly equal to "a link holder arrived", with no eslint-disable needed.
  const latest = useRef(onToken)
  latest.current = onToken

  useEffect(() => {
    const stashed = takePendingInvite()

    const url = new URL(window.location.href)
    const fromUrl = url.searchParams.get('join') ?? undefined
    if (fromUrl) {
      url.searchParams.delete('join')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }

    const token = fromUrl ?? stashed
    if (!token) return
    latest.current(token)
  }, [joinParam])
}
