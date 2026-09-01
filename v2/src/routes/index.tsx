import { createFileRoute, redirect } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'
import { Landing } from '#/components/home/landing.tsx'

/**
 * The marketing landing, at the apex.
 *
 * WHY THIS ROUTE EXISTS AT ALL. v1 renders this page at `/` to everyone, signed
 * in or not, and keeps the dashboard at `/me`. v2 inverted that — `/` WAS the
 * dashboard and bounced anonymous visitors straight to `/login` — so between
 * Phase 0 and now v2 has had no marketing surface whatsoever. At cutover the
 * apex flips to v2, and v1's src/app/sitemap.ts puts this URL at priority 1: a
 * first-time visitor and every crawler would arrive at a login wall. Two funnel
 * bugs are already open against production (wordle-teams-390: ~7% of /login
 * visitors complete auth; wordle-teams-456: 87% of signups never enter a board),
 * and deleting the page that says what the product IS plausibly makes 390 worse.
 * Phase 7 Task 1 moved the dashboard to /app precisely to free this path up.
 *
 * THE REDIRECT PORTS v1's `welcomePaths` RULE, from
 * src/lib/supabase/middleware.ts, whose comment reads:
 *
 *   "Routes that show the marketing / sign-in experience. A signed-in user
 *   should never land here (e.g. an iOS PWA relaunch that ignores manifest
 *   start_url and restores the welcome page) — bounce them into the app
 *   instead."
 *
 * That is the whole justification, and it is a real production behaviour rather
 * than a preference: an installed iOS PWA can relaunch onto the last page it
 * had rather than the manifest's start_url, and for those installs the last
 * page is this one. v1's `welcomePaths` is exactly ['/', '/login'] — note that
 * `/home` is NOT in it, which is why src/routes/home.tsx has no such redirect.
 * /login's own beforeLoad already carries the other half of the same rule.
 *
 * IT ALSO REPLACES v1's CLIENT-SIDE VERSION of the same idea. v1 runs a second,
 * redundant standalone-mode check inside dashboard-preview.tsx; it is not
 * ported, and the reason is written down there.
 *
 * A signed-in visitor with no players row lands on /complete-profile, because
 * that is what /app's own beforeLoad does with them. v1's src/app/page.tsx
 * redirected to /complete-profile from here directly; routing through /app
 * keeps the profile check in one place instead of two.
 *
 * THIS PATH IS IN src/lib/cache-policy.ts's STATIC_DOCUMENTS and, as of this
 * route existing, that listing is finally live: an anonymous GET / now answers
 * 200 and is published to the edge for a day. It was inert while `/` 404'd,
 * because src/server.ts applies the static policy to a 200 and nothing else.
 * e2e/routes.spec.ts pins both the new 200 case and the unchanged behaviour of
 * the redirect a signed-in visitor gets.
 */
export const Route = createFileRoute('/')({
  // No segment: the apex takes the site-wide default title, which is what v1's
  // src/app/page.tsx does by declaring no metadata of its own.
  head: () => ({ meta: [{ title: pageTitle() }] }),
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: '/app' })
  },
  component: Landing,
})
