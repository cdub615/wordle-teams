import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'
import { Landing } from '#/components/home/landing.tsx'

/**
 * The same landing as `/`, at v1's second address for it.
 *
 * KEPT BECAUSE SOMETHING OUTSIDE THIS REPO POINTS AT IT. v1's
 * src/app/sitemap.ts lists https://wordleteams.com/home at priority 0.9, second
 * only to the apex, and v1's own app bar links its wordmark here — so the path
 * has been advertised to crawlers and is carried by every inbound link anyone
 * ever shared. At cutover the domain flips to v2 and those requests arrive
 * here. Same reasoning as src/routes/me.tsx, and the same conclusion: this is
 * permanent, not transitional.
 *
 * IT IS THE SAME PAGE, NOT A VARIANT. v1 has two page files
 * (src/app/page.tsx and src/app/home/page.tsx) rendering one component, and the
 * only difference between them is a `redirectForPwa` prop that switches on the
 * client-side standalone check in dashboard-preview.tsx. That check is not
 * ported at all (see the note there), so the prop has nothing left to control
 * and the two routes render an identical `Landing`.
 *
 * NO `beforeLoad` REDIRECT, AND THAT ASYMMETRY WITH `/` IS v1's. v1's
 * `welcomePaths` in src/lib/supabase/middleware.ts is ['/', '/login'] — `/home`
 * is deliberately absent, so a signed-in visitor who follows a link here gets
 * the marketing page rather than being bounced. The bounce exists to keep a
 * relaunching PWA off the welcome screen, and no PWA relaunches onto /home.
 */
export const Route = createFileRoute('/home')({
  // Same as `/`: v1's src/app/home/page.tsx declares no metadata, so it inherits
  // the site-wide default title.
  head: () => ({ meta: [{ title: pageTitle() }] }),
  component: Landing,
})
