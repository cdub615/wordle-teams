import { STATIC_CACHE } from './cache-policy'
// SITE_ORIGIN lives in lib/seo.ts because the OG tags need the identical value,
// and a second copy of it here is exactly how the sitemap and the social card
// would come to disagree about what this site is called. The argument for
// hardcoding it — including on beta — is written up there, beside the constant.
import { SITE_ORIGIN } from './seo'

/**
 * THE SITEMAP, PORTED FROM v1's src/app/sitemap.ts.
 *
 * The entries and their priorities are v1's, unchanged: apex 1.0, /home 0.9,
 * /about 0.8, /privacy 0.7, /terms 0.6, /login 0.5, /maintenance 0.4. What
 * changed is `lastmod` and the reasoning about which routes belong; both are
 * argued below rather than left to be inferred.
 *
 * IT LIVES HERE RATHER THAN IN THE ROUTE FILE so that it can be IMPORTED by a
 * test. src/routes/sitemap[.]xml.ts calls createFileRoute, which cannot be
 * imported under vitest — it registers against a router that does not exist
 * there — so anything defined inside it is reachable only from Playwright, and
 * .github/workflows/deploy-v2.yml runs no Playwright (wt-ksh.8.49). Everything
 * worth asserting is therefore in this module, where `vitest run` — a real CI
 * gate — can call it and read the answer. The route file is the one line that
 * is left, and src/crawler-metadata.test.ts parses it to prove it still calls
 * sitemapResponse().
 */

/**
 * `changefreq` and `priority` ARE KEPT FOR PARITY AND ARE KNOWN TO BE IGNORED.
 * Google has said publicly for years that it reads neither. They cost two lines
 * per entry, other crawlers may still read them, and dropping them would be a
 * change to what production publishes that buys nothing — so they stay.
 *
 * `lastmod` IS DROPPED, AND THAT IS THE ONE REAL CHANGE FROM v1.
 *
 * v1 sets `lastModified: new Date()` on every entry, so every URL claims to
 * have changed at the moment the crawler asked — the sitemap fetched while
 * writing this said 2026-09-01T11:39:13.214Z against all seven. That is not
 * merely useless: Google's sitemap documentation says it uses lastmod only when
 * a site's values are CONSISTENTLY ACCURATE, and an identical always-now
 * timestamp on every URL is exactly the pattern that disqualifies them. An
 * untrusted lastmod is worth less than an absent one.
 *
 * THE BUILD DATE WAS THE OTHER OPTION AND IT IS THE SAME MISTAKE MORE SLOWLY.
 * One timestamp stamped across all seven URLs would tell a crawler that
 * /privacy and /terms changed because someone adjusted a colour token and
 * redeployed. The legal pages have a real effective date — 2024-05-21, in
 * routes/privacy.tsx and routes/terms.tsx — which is years away from any build
 * of this app, and there is no per-URL date available here for the others.
 *
 * So: no lastmod, rather than a lastmod that is wrong on every entry. It is
 * an optional element; omitting it says "I do not know", which is true.
 * src/crawler-metadata.test.ts asserts the rendered document contains no
 * <lastmod> at all, so re-adding `new Date()` goes red on a CI gate.
 */
export interface SitemapEntry {
  /** Appended to SITE_ORIGIN. Empty string is the apex. */
  readonly path: string
  readonly changefreq: 'monthly' | 'yearly'
  readonly priority: number
}

/**
 * THE ROUTE SET, AND THE THREE KINDS OF ABSENCE.
 *
 * These are v1's seven, unchanged. v2 has routes v1 did not, and the decision
 * about each one is recorded here because "it is not in the list" is otherwise
 * indistinguishable from "nobody thought about it".
 *
 * DISALLOWED, SO IT CANNOT BE LISTED — /app, /me, /complete-profile and the
 * /api routes. public/robots.txt excludes all four. A sitemap is a request to
 * index; listing a URL that robots.txt forbids fetching tells a crawler two
 * contradictory things about the same URL, and the crawler resolves it by
 * ignoring one of them. src/crawler-metadata.test.ts parses both files and
 * fails if any entry here is covered by any Disallow rule there, so the two
 * cannot drift into disagreeing.
 *
 * DELIBERATELY NOT ADVERTISED — /login-error, which is new in v2 (Task 6) and
 * has no v1 counterpart. It is NOT disallowed, because there is no harm in a
 * crawler that finds it fetching it: the page is four sentences and a link. But
 * a sitemap says "these are the pages worth putting in front of a searcher",
 * and a dead-end error page reachable only mid sign-in is not one. Nothing
 * links to it, so nothing will find it either way.
 *
 * /sitemap.xml ITSELF is excluded for the obvious reason and named anyway, so
 * that the "every route is accounted for" test in src/crawler-metadata.test.ts
 * can be exhaustive over src/routeTree.gen.ts rather than approximately so.
 * That test is what makes a route added in six months a decision instead of an
 * omission.
 *
 * /maintenance STAYS, AND IT IS THE UNCOMFORTABLE ONE. Advertising the outage
 * page means a searcher could conceivably be shown "we will be back shortly"
 * as a result for the product. It sits at priority 0.4, the bottom of v1's
 * list, and v1 has published it to production for the life of the project with
 * no observed consequence. Dropping it would be a change to production
 * behaviour argued from theory against evidence, which is not the trade this
 * task is for; it is written down here instead so the next person inherits the
 * argument rather than rediscovering it.
 *
 * / AND /home ARE BOTH LISTED, AS IN v1, AND THEY RENDER THE SAME COMPONENT.
 * That is duplicate content advertised twice with no rel=canonical between
 * them. Also v1's behaviour, also out of scope here, and filed rather than
 * quietly fixed under a task about robots.txt.
 */
export const SITEMAP_ENTRIES: readonly SitemapEntry[] = [
  { path: '', changefreq: 'monthly', priority: 1 },
  { path: '/home', changefreq: 'monthly', priority: 0.9 },
  { path: '/about', changefreq: 'monthly', priority: 0.8 },
  { path: '/privacy', changefreq: 'yearly', priority: 0.7 },
  { path: '/terms', changefreq: 'yearly', priority: 0.6 },
  { path: '/login', changefreq: 'yearly', priority: 0.5 },
  { path: '/maintenance', changefreq: 'yearly', priority: 0.4 },
]

/**
 * `application/xml`, which sitemaps.org permits alongside `text/xml`, and which
 * is what v1 serves today.
 *
 * IT IS ALSO WHAT KEEPS src/server.ts's HANDS OFF THIS RESPONSE. That wrapper
 * rewrites `cache-control` on anything whose content-type includes `text/html`
 * and returns everything else untouched — so the header set below is the header
 * set that ships, and this route is responsible for its own caching.
 */
export const SITEMAP_CONTENT_TYPE = 'application/xml; charset=utf-8'

/**
 * THE SAME BYTES FOR EVERY CALLER, SO IT IS SHAREABLE UNCONDITIONALLY.
 *
 * lib/cache-policy.ts makes public caching conditional on there being no
 * session cookie, because an SSR document embeds the visitor's JWT in its
 * dehydrated router state. NONE OF THAT APPLIES HERE. This response is rendered
 * from a compile-time constant, reads no request, and is byte-identical for an
 * anonymous crawler and a signed-in user. Reusing STATIC_CACHE gets the same
 * reviewed freshness numbers as the marketing pages — a day at the edge, a week
 * stale — without reusing the condition, which has nothing to attach to.
 *
 * The stale week has no invalidation behind it on a Worker deploy
 * (wt-ksh.8.46): `wrangler deploy` purges nothing, so a sitemap can keep being
 * served for a week after the route set changes. For THIS document that is
 * acceptable in a way it would not be for a page — the cost of a crawler
 * learning about a new marketing route seven days late is nil.
 */
export const SITEMAP_CACHE = STATIC_CACHE

/**
 * NOTHING IS XML-ESCAPED AND NOTHING NEEDS TO BE. Every <loc> is SITE_ORIGIN
 * plus a path from the compile-time literal above; there is no request input on
 * this path and no character in any of them that XML reserves. If an entry ever
 * gains a query string this stops being true, which is why
 * src/crawler-metadata.test.ts asserts the rendered document parses and that
 * every <loc> round-trips through `new URL`.
 */
export function renderSitemap(): string {
  const urls = SITEMAP_ENTRIES.map(
    ({ path, changefreq, priority }) =>
      '<url>\n' +
      `<loc>${SITE_ORIGIN}${path}</loc>\n` +
      `<changefreq>${changefreq}</changefreq>\n` +
      `<priority>${priority}</priority>\n` +
      '</url>',
  ).join('\n')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n` +
    '</urlset>\n'
  )
}

/**
 * The whole response, built here rather than in the route file, for the reason
 * at the top of this module: this function can be called by `vitest run` and
 * its headers and body read back, and nothing inside src/routes/ can.
 */
export function sitemapResponse(): Response {
  return new Response(renderSitemap(), {
    headers: {
      'content-type': SITEMAP_CONTENT_TYPE,
      'cache-control': SITEMAP_CACHE,
    },
  })
}
