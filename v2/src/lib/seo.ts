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
 * og:url IS THE APEX ON EVERY ROUTE, which is what v1 does and is not right.
 * The property is meant to name the canonical URL of the page being shared, so
 * sharing /privacy today announces itself as the home page. Fixing it needs
 * per-route head() overrides, which is a behaviour change well outside a task
 * about robots.txt — filed rather than smuggled in here.
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
  { property: 'og:url', content: SITE_ORIGIN },
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
