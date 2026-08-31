import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * PERMANENT, NOT TRANSITIONAL. DO NOT DELETE THIS IN A TIDY-UP.
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
