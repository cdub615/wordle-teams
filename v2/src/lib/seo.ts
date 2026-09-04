// Titles, ported 1:1 from the v1 app's Next.js metadata (src/app/layout.tsx).
// Next applies `template` automatically to any nested page title; TanStack has
// no equivalent, so pageTitle() does the interpolation explicitly and each
// route calls it.
export const APP_NAME = 'Wordle Teams'
export const APP_DEFAULT_TITLE = 'Wordle Teams: The ultimate app for Wordle enthusiasts'
const APP_TITLE_TEMPLATE = '%s - Wordle Teams'

/** A page title in the v1 house style: pageTitle('Dashboard') -> 'Dashboard - Wordle Teams'. */
export function pageTitle(segment?: string) {
  return segment ? APP_TITLE_TEMPLATE.replace('%s', segment) : APP_DEFAULT_TITLE
}

/**
 * v1's `metadata.description`, verbatim. Copied from the string production
 * serves today rather than retyped — a paraphrase here would be a silent
 * content change to the snippet every search result and every shared link
 * shows.
 *
 * IT WAS MISSING FROM v2 ENTIRELY until this task. v2's __root.tsx head()
 * carried charSet, viewport, theme-color and a title, and no description at
 * all, so every route shipped with nothing for a search engine or a link
 * preview to quote.
 */
export const APP_DESCRIPTION =
  'Wordle Teams lets you compete with friends by tracking and comparing your Wordle scores, adding a competitive edge to the popular word-guessing game. Stay ahead of the competition, enjoy friendly rivalry, and prove your Wordle mastery with this exciting score-tracking app. Revive the Wordle craze and bring your A-game to the ultimate word-guessing showdown with Wordle Teams!'

/**
 * THE CANONICAL ORIGIN, HARDCODED — AND IT IS THE PRODUCTION ONE ON BETA TOO.
 *
 * Deliberate, and it matches v1, which hardcodes the same string in
 * src/app/robots.ts, src/app/sitemap.ts and `metadataBase`. These values name
 * where the site canonically lives; they are not a description of whichever
 * host served the response. Templating this off SITE_URL would make beta
 * publish a sitemap of beta.wordleteams.com URLs and an og:url pointing at the
 * staging copy — a request to index staging, which is the opposite of what a
 * canonical declaration is for.
 *
 * public/robots.txt names `https://wordleteams.com/sitemap.xml` from the same
 * decision, and src/crawler-metadata.test.ts asserts that file and this
 * constant agree rather than trusting that whoever edits one remembers the
 * other.
 *
 * NO TRAILING SLASH, so the sitemap's apex entry renders as
 * `https://wordleteams.com`, exactly as v1's does today.
 */
export const SITE_ORIGIN = 'https://wordleteams.com'

/**
 * THE ONE SOCIAL CARD IMAGE. 1200x630, the size every scraper wants, copied
 * byte-for-byte from v1's src/app/opengraph-image.png.
 *
 * v1 SHIPS IT TWICE. Next's file conventions gave it src/app/opengraph-image.png
 * and src/app/twitter-image.png, and the two files are IDENTICAL — md5
 * 0bc403bf3db8f765efcdbf65592369dd for both — so production serves 196KB of the
 * same picture from two URLs and points og:image at one and twitter:image at
 * the other. v2 ships one copy and points both at it. Nothing any scraper
 * renders changes; there is simply one asset instead of two.
 *
 * THE DIMENSIONS ARE ASSERTED AGAINST THE FILE, not just declared.
 * src/crawler-metadata.test.ts reads public/opengraph-image.png's IHDR chunk
 * and compares, so cropping the image without editing these numbers goes red.
 */
const OG_IMAGE_PATH = '/opengraph-image.png'
export const OG_IMAGE_URL = `${SITE_ORIGIN}${OG_IMAGE_PATH}`
export const OG_IMAGE_TYPE = 'image/png'
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630
/** v1's src/app/opengraph-image.alt.txt, verbatim. Also its twitter-image.alt.txt. */
export const OG_IMAGE_ALT = 'Wordle Teams'

/**
 * THE OpenGraph AND TWITTER CARD TAGS, TAG FOR TAG AS PRODUCTION EMITS THEM.
 *
 * Read off `curl https://wordleteams.com/home` rather than reconstructed from
 * v1's `metadata` object, because Next expands that object into a tag set with
 * rules of its own — og:image:type/width/height/alt are Next's expansion of one
 * image descriptor, not anything anybody wrote. This is a parity port, so what
 * is matched is the OUTPUT, and Task 13's prod-vs-beta route walk
 * (scripts/parity-routes.mjs) has that much less to explain.
 *
 * TWO DELIBERATE DIVERGENCES, BOTH VISIBLE IN A DIFF:
 *   - twitter:image points at /opengraph-image.png, not v1's /twitter-image.png.
 *     Same bytes; see OG_IMAGE_PATH above.
 *   - The `?826b6e40d0d7ffa6` cache-busting query Next appends to both image
 *     URLs is dropped. It is Next's build fingerprint for a generated asset and
 *     there is no equivalent here — the file is served from the Workers assets
 *     layer under a stable name. THE TRADEOFF, which the fingerprint was what
 *     bought off: Facebook's and LinkedIn's scrapers cache the card image BY
 *     URL, so if this picture is ever redrawn under the same name they will go
 *     on serving the old one indefinitely. Redrawing it therefore means
 *     shipping it under a new filename, not overwriting this one.
 *
 * og:url IS DELIBERATELY ABSENT FROM THIS LIST, and its absence is the fix for
 * wt-ksh.8.55 rather than an omission. v1 sets it site-wide in the root layout
 * and no page overrides it, so production announces every URL as the home page
 * and a scraper that dedupes on og:url treats the whole site as one document.
 * It is now per-route, next to the canonical it has to agree with — see
 * publicRouteHead below.
 *
 * IT IS REMOVED FROM THE ROOT RATHER THAN OVERRIDDEN THERE. Relying on a child
 * route's meta to win a merge would make the correctness of every page depend
 * on TanStack's dedupe rule for `property`, and the failure mode of that rule
 * changing is TWO og:url tags rather than a visibly wrong one. Absent from the
 * root, a route either declares its own or emits none, and none is strictly
 * better than a wrong one.
 *
 * IT IS A DATA STRUCTURE AND NOT JSX so that `vitest run` can import it and
 * read the real values. Spelled into __root.tsx's head() by hand, these tags
 * would be reachable only from a rendered document, and v2 has no
 * component-rendering tests — the vitest environment is edge-runtime, so there
 * is no DOM — while CI runs no Playwright either (wt-ksh.8.49). As an array,
 * every content string is an assertion on a gate that actually runs.
 */
export const socialMetaTags = [
  { name: 'description', content: APP_DESCRIPTION },
  { property: 'og:title', content: APP_DEFAULT_TITLE },
  { property: 'og:description', content: APP_DESCRIPTION },
  { property: 'og:site_name', content: APP_NAME },
  { property: 'og:image:type', content: OG_IMAGE_TYPE },
  { property: 'og:image:width', content: String(OG_IMAGE_WIDTH) },
  { property: 'og:image:height', content: String(OG_IMAGE_HEIGHT) },
  { property: 'og:image:alt', content: OG_IMAGE_ALT },
  { property: 'og:image', content: OG_IMAGE_URL },
  { property: 'og:type', content: 'website' },
  { name: 'twitter:card', content: 'summary_large_image' },
  { name: 'twitter:title', content: APP_DEFAULT_TITLE },
  { name: 'twitter:description', content: APP_DESCRIPTION },
  { name: 'twitter:image:type', content: OG_IMAGE_TYPE },
  { name: 'twitter:image:width', content: String(OG_IMAGE_WIDTH) },
  { name: 'twitter:image:height', content: String(OG_IMAGE_HEIGHT) },
  { name: 'twitter:image:alt', content: OG_IMAGE_ALT },
  { name: 'twitter:image', content: OG_IMAGE_URL },
] as const


/**
 * WHAT EACH PUBLIC ROUTE DECLARES AS ITS CANONICAL URL.
 *
 * Keyed by the route's own path so a route passes what it IS and this table
 * decides what it CLAIMS — a route cannot give itself the wrong canonical by
 * mistyping a string, which is the whole failure mode a canonical has.
 *
 * `/home` IS THE ONE THAT IS NOT SELF-REFERENTIAL, and it is the reason this is
 * a table instead of a concatenation. src/routes/index.tsx and
 * src/routes/home.tsx render the same component, and lib/sitemap.ts advertises
 * both — v1's behaviour, carried over — so the pair is duplicate content
 * submitted twice with nothing saying which one is meant to win. Google ignores
 * the sitemap `priority` that is currently the only hint.
 *
 * /home CANNOT SIMPLY BE DROPPED: routes.test.ts and the route file both record
 * that it exists for inbound links and for v1's sitemap, and it is deliberately
 * exempt from the signed-in bounce that `/` has. So it stays listed and points
 * at the apex instead.
 *
 * og:url MOVES WITH THE CANONICAL, NOT WITH THE ROUTE. Both properties answer
 * the same question — "what URL is this page, really" — so /home shares to
 * social as the apex for exactly the reason it canonicalises there. Two tags
 * disagreeing about that would be worse than either answer alone.
 *
 * ROUTES ABSENT FROM THIS TABLE EMIT NEITHER TAG, deliberately: /app, /me,
 * /complete-profile and /login-error are either disallowed in robots.txt or
 * unadvertised, and a canonical on a page nobody should index does nothing.
 * src/crawler-metadata.test.ts pins this table against SITEMAP_ENTRIES so a
 * route added to one and not the other cannot go unnoticed.
 */
export const CANONICAL_PATH_BY_ROUTE: Readonly<Record<string, string>> = {
  '': '',
  '/home': '',
  '/about': '/about',
  '/privacy': '/privacy',
  '/terms': '/terms',
  '/login': '/login',
  '/maintenance': '/maintenance',
}

/** The absolute canonical URL a route declares. Always on SITE_ORIGIN. */
export function canonicalUrlFor(routePath: string): string {
  const canonicalPath = CANONICAL_PATH_BY_ROUTE[routePath]
  if (canonicalPath === undefined) {
    throw new Error(`No canonical declared for route "${routePath}" — add it to CANONICAL_PATH_BY_ROUTE`)
  }
  return `${SITE_ORIGIN}${canonicalPath}`
}

/**
 * The complete head() for a public route: its title, its og:url and its
 * rel=canonical, which are the three things that must not disagree.
 *
 * THE TITLE SEGMENT IS OPTIONAL and omitting it yields the site-wide default,
 * which is what `/`, `/home` and `/maintenance` already emitted. So adopting
 * this changes no title anywhere — worth stating because /maintenance's route
 * file records having NO head() as deliberate v1 parity, and it now has one.
 * That note was about the TITLE, and the title it produces is unchanged.
 */
export function publicRouteHead(
  routePath: string,
  titleSegment?: string,
  options?: { noindex?: boolean },
) {
  const href = canonicalUrlFor(routePath)
  return {
    meta: [
      { title: pageTitle(titleSegment) },
      { property: 'og:url', content: href },
      ...(options?.noindex ? [NOINDEX_META] : []),
    ],
    links: [{ rel: 'canonical', href }],
  }
}

/**
 * THE ONLY THING THAT ACTUALLY KEEPS A PAGE OUT OF AN INDEX (wt-ksh.8.58).
 *
 * A SITEMAP IS AN INVITATION, NOT A GATE. Removing a route's entry from
 * lib/sitemap.ts is the change anyone who notices an unwanted page will reach
 * for first, and it does nothing: a page that is reachable and answers 200 is
 * crawlable and indexable whether or not any sitemap mentions it. That is also
 * what makes KEEPING /maintenance's sitemap entry free — it changes nothing
 * about indexability either way, so do not "fix" this in the sitemap.
 *
 * Only this tag, or an `X-Robots-Tag: noindex` response header, does the job.
 *
 * IT IS NOT REDUNDANT WITH lib/robots-policy.ts, which sends X-Robots-Tag on
 * the staging HOSTNAMES. That one suppresses all of beta and stops at cutover,
 * by design. This one travels with the page, so it is what keeps these two
 * routes out of the index on PRODUCTION — which is the case wt-ksh.8.58 is
 * about and the one no host-level rule covers.
 */
export const NOINDEX_META = { name: 'robots', content: 'noindex' } as const
