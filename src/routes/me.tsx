import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * THE ROUTE IS PERMANENT; THE REDIRECT IS A 307. DO NOT DELETE THIS IN A TIDY-UP.
 *
 * v1's src/app/manifest.json sets "start_url": "/me". Every production user
 * who installed the PWA has that path burned into their installed app, and an
 * installed iOS PWA does not adopt a new start_url from a re-fetched manifest.
 * At cutover the domain flips to v2, and without this route their app opens on
 * a route that does not exist.
 *
 * The same applies to bookmarks and to any link anyone ever shared.
 *
 * src/routes.test.ts pins both halves of that — the file's existence and the
 * target below — because all four CI gates stayed green when this file was
 * deleted, and only e2e noticed.
 *
 * A 307, AND DELIBERATELY NOT A 301 (`wordle-teams-cog5`). TanStack's
 * `redirect()` defaults to 307, and the heading above used to read "PERMANENT,
 * NOT TRANSITIONAL" — which described the ROUTE's lifetime, correctly, while
 * colliding with the HTTP term for a status the wire does not send. The wording
 * is what changed; the status is right as it stands.
 *
 * A 301 IS IRREVERSIBLE IN EVERY BROWSER THAT HAS SEEN IT, and the population
 * this route exists for is precisely the one that would cache it: installed
 * PWAs launching through /me on every open. Making the one path an unknown
 * number of existing installs depend on permanently uncorrectable buys a saved
 * round trip per launch. The 307 costs that round trip and keeps every option
 * open — Task 17 settled it on those terms.
 *
 * BOTH MANIFESTS OMIT `scope`, so it defaults to `/` on each, which is why the
 * /me -> /app hop cannot eject a standalone window into the browser. Measured
 * 2026-09-03 during Task 17's walk; it is the reason this redirect is safe for
 * an installed app at all, and it is not obvious from either file.
 */
export const Route = createFileRoute('/me')({
  beforeLoad: ({ location }) => {
    // THE QUERY STRING COMES WITH IT. v1's src/lib/polar/checkout.ts sets
    // `successUrl: ${appOrigin()}/me?checkout=success`, which is a live
    // production URL right now: a checkout in flight across the DNS cutover
    // comes back to /me carrying the marker that src/lib/checkout-return.ts
    // reads. A bare `to: '/app'` dropped it and the return notice never fired.
    // e2e/routes.spec.ts pins the hop with the param on it.
    throw redirect({ to: '/app', search: location.search, replace: true })
  },
})
