import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { pageTitle } from '#/lib/seo'

/** Where a token waits while its holder signs in. */
export const PENDING_INVITE_KEY = 'wt.pendingInviteToken'

/**
 * Follow a shared invite link.
 *
 * TWO PATHS, and the signed-out one is why this route exists at all rather
 * than a mutation call from a dialog. Someone receiving a link in a chat is
 * usually not signed in, and there is no token in the EMAIL invite flow to
 * copy from — that one works by matching an address at profile completion
 * (players.ts:226), which a link holder has no way to trigger.
 *
 * Signed in  — consume immediately and land on the dashboard.
 * Signed out — stash the token, send them through /login, and let /app consume
 *              it once a player row exists. It cannot be consumed before then:
 *              consumeLink requires a player, and a brand-new account does not
 *              have one until /complete-profile.
 *
 * sessionStorage, not localStorage: a token that outlives the tab it was
 * opened in is a capability lying around on a shared computer.
 *
 * THE SIGNED-OUT BRANCH IS A COMPONENT AND NOT A `redirect()`, AND THAT IS THE
 * ONE PLACE THIS FILE DEPARTS FROM ITS OWN OBVIOUS SHAPE. `beforeLoad` looks
 * like the natural home for "stash it and bounce", guarded on
 * `typeof window !== 'undefined'` because beforeLoad also runs during SSR. It
 * does not work, and the reason is that the guard is not a formality here —
 * on the path this route exists for, the SERVER is the only place beforeLoad
 * ever runs.
 *
 * MEASURED, 2026-09-07, against `vite dev` with the local Convex backend up,
 * on the version that did stash in beforeLoad:
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
 * for /join, no client JavaScript for this route runs, and the `setItem` in
 * the `typeof window !== 'undefined'` block executes on exactly nobody. Every
 * gate stayed green: the code reads correctly, it type-checks, and the branch
 * is unreachable rather than wrong.
 *
 * So the stash has to happen where client code actually runs, which is a
 * rendered component. The signed-IN branch keeps its redirect — it carries the
 * token in the URL, which survives a 307 perfectly well.
 */
export const Route = createFileRoute('/join/$token')({
  head: () => ({ meta: [{ title: pageTitle('Join a team') }] }),
  beforeLoad: ({ context, params }) => {
    if (context.isAuthenticated) throw redirect({ to: '/app', search: { join: params.token } })
    // Signed out: fall through to the component below, deliberately. See above.
  },
  component: JoinLink,
})

function JoinLink() {
  const { token } = Route.useParams()
  const navigate = useNavigate()

  useEffect(() => {
    try {
      window.sessionStorage.setItem(PENDING_INVITE_KEY, token)
    } catch {
      // Private mode, or storage disabled. The link simply will not survive
      // the round trip; nothing here may throw at someone who is trying to
      // join a team, so they still reach sign-in either way.
    }
    // `replace`, so the browser's Back button from /login returns them to
    // wherever the link was — not to this page, which would bounce them
    // straight back to /login.
    void navigate({ to: '/login', replace: true })
  }, [token, navigate])

  // Rendered for the one frame between hydration and the navigation above, and
  // by the server for the document itself. Says what is happening rather than
  // flashing an empty page, and names no team: this side knows only a token,
  // and looking one up here would tell an anonymous holder of a guessed token
  // whether it is real.
  return (
    <main className="page-wrap flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-lg font-semibold">Joining a team</h1>
      <p className="text-sm text-muted-foreground">Taking you to sign in…</p>
    </main>
  )
}
