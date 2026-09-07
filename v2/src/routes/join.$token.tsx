import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { pageTitle } from '#/lib/seo'
import { rememberPendingInvite } from '#/lib/pending-invite.ts'

/**
 * Follow a shared invite link.
 *
 * TWO PATHS, and the signed-out one is why this route exists at all rather
 * than a mutation call from a dialog. Someone receiving a link in a chat is
 * usually not signed in, and there is no token in the EMAIL invite flow to
 * copy from — that one works by matching an address at profile completion
 * (players.ts:226), which a link holder has no way to trigger.
 *
 * Signed in  — hand the token to /app in the URL, and land on the dashboard.
 * Signed out — send them through /login, and let /app spend the token once a
 *              player row exists. It cannot be spent before then: consumeLink
 *              requires a player, and a brand-new account does not have one
 *              until /complete-profile.
 *
 * BOTH PATHS ALSO STASH THE TOKEN, AND THE SIGNED-IN ONE IS NOT REDUNDANT.
 * `/app`'s own beforeLoad redirects to /complete-profile when the account has
 * no player row, and that redirect DROPS the search params — so an account
 * that authenticated but abandoned onboarding half way (a state this whole
 * epic exists because people reach) followed a link, was told it was joining a
 * team, and completed its profile into nothing. The URL is the faster carrier
 * when it survives; sessionStorage is the one that survives /complete-profile.
 * routes/app.tsx prefers `?join=` and clears the stash either way.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THERE IS NO `beforeLoad` HERE, AND ITS ABSENCE IS THE LOAD-BEARING PART.
 *
 * The obvious shape for this route is a pair of `redirect()`s thrown from
 * `beforeLoad`, stashing first, guarded on `typeof window !== 'undefined'`
 * because beforeLoad also runs during SSR. That is how this route was first
 * written, and the guard is not a formality — on the one path this route
 * exists for, the SERVER is the only place beforeLoad ever runs.
 *
 * MEASURED, 2026-09-07, against `vite dev` with the local Convex backend up,
 * on the version that stashed in beforeLoad:
 *
 *   $ curl -D - -o /dev/null http://localhost:3999/join/testtoken123
 *   HTTP/1.1 307 Temporary Redirect
 *   content-length: 0
 *   location: /login
 *
 * A link in a chat message is a FRESH DOCUMENT LOAD. TanStack Start turns a
 * `redirect()` thrown from beforeLoad during SSR into a real 307 on the wire —
 * the same behaviour e2e/routes.spec.ts records for `/me` and relies on — so
 * the browser follows it at the network layer, no document is ever delivered
 * for /join, no client JavaScript for this route runs, and the `setItem`
 * executed on exactly nobody. Every gate stayed green: the code read
 * correctly, it type-checked, and the branch was unreachable rather than
 * wrong.
 *
 * So the stash has to happen where client code actually runs, which is a
 * rendered component — and once the signed-in path needs to stash as well,
 * BOTH branches belong in it. Nothing in `src/` links here, so a client-side
 * navigation to this route does not happen and there is no faster path being
 * given up.
 */
export const Route = createFileRoute('/join/$token')({
  head: () => ({ meta: [{ title: pageTitle('Join a team') }] }),
  component: JoinLink,
})

function JoinLink() {
  const { token } = Route.useParams()
  // The root route's beforeLoad puts this in context from a server function
  // that reads the session cookie, so it is already resolved by the time this
  // renders — unlike `useConvexAuth`, which reports false until its token
  // arrives and would send a signed-in holder to /login for a moment.
  const { isAuthenticated } = Route.useRouteContext()
  const navigate = useNavigate()

  useEffect(() => {
    rememberPendingInvite(token)
    // `replace`, so Back from /login or /app returns them to wherever the link
    // was — not to this page, which would bounce them straight forward again.
    void navigate(
      isAuthenticated
        ? { to: '/app', search: { join: token }, replace: true }
        : { to: '/login', replace: true },
    )
  }, [token, isAuthenticated, navigate])

  // Rendered by the server for the document itself, and for the one frame
  // between hydration and the navigation above. Says what is happening rather
  // than flashing an empty page, and names no team: this side knows only a
  // token, and looking one up here would tell an anonymous holder of a guessed
  // token whether it is real.
  return (
    <main className="page-wrap flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-lg font-semibold">Joining a team</h1>
      <p className="text-sm text-muted-foreground">One moment…</p>
    </main>
  )
}
