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
 */
export const Route = createFileRoute('/me')({
  beforeLoad: () => {
    throw redirect({ to: '/app', replace: true })
  },
})
