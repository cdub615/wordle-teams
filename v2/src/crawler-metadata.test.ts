import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  APP_DEFAULT_TITLE,
  APP_DESCRIPTION,
  APP_NAME,
  OG_IMAGE_ALT,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_TYPE,
  OG_IMAGE_URL,
  OG_IMAGE_WIDTH,
  SITE_ORIGIN,
  socialMetaTags,
} from './lib/seo'
import {
  SITEMAP_CONTENT_TYPE,
  SITEMAP_ENTRIES,
  renderSitemap,
  sitemapResponse,
} from './lib/sitemap'
import {
  elementsOf,
  optionsPassedTo,
  propertiesOf,
  returnedObjectOf,
} from './test-support/source-ast'

/**
 * THE THREE ARTEFACTS NOBODY LOOKS AT UNTIL THEY ARE WRONG — public/robots.txt,
 * /sitemap.xml and the social card — AND THE ONE CHECK THAT SPANS THEM.
 *
 * WHY THESE ARE UNIT TESTS AND NOT ONLY e2e. .github/workflows/deploy-v2.yml
 * runs lint, typecheck, `vitest run` and build, then deploys and smoke-tests
 * /login. IT RUNS NO PLAYWRIGHT (wt-ksh.8.49), so an e2e-only protection is not
 * a gate — it is a thing somebody may run. Everything here is reachable from
 * `vitest run`, which is.
 *
 * WHY EVERY ASSERTION PARSES INSTEAD OF MATCHING. `expect(body).toContain(
 * 'Disallow: /app')` is the obvious test for a robots file and it is worth
 * almost nothing: it passes on a file that says `Allow: /app` two lines lower,
 * on one where the rule sits inside a comment, and on one with a second
 * User-agent group that overrides it. Eleven defects this phase were found only
 * because an assertion was moved off a substring of a blob and onto a parsed,
 * bounded value. So robots.txt is parsed into directives, the sitemap into url
 * records, the meta tags are imported as data, and the PNG's dimensions are
 * read out of its IHDR chunk.
 *
 * THE CHECK WORTH MORE THAN EITHER FILE'S OWN ASSERTIONS is the last describe
 * block. robots.txt and the sitemap are two files that talk about the same set
 * of URLs, maintained months apart by people who have read one of them. Nothing
 * makes them agree, and a sitemap entry for a path robots.txt forbids tells a
 * crawler two contradictory things about one URL. That is the check a human
 * would never do by hand, and it is a five-line loop here.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const ROBOTS = '../public/robots.txt'
const OG_IMAGE_FILE = '../public/opengraph-image.png'
const SITEMAP_ROUTE = './routes/sitemap[.]xml.ts'
const ROOT_ROUTE = './routes/__root.tsx'

// ---------------------------------------------------------------------------
// robots.txt, parsed into the directives a crawler would act on.
// ---------------------------------------------------------------------------

interface RobotsGroup {
  userAgents: string[]
  allow: string[]
  disallow: string[]
}

interface Robots {
  groups: RobotsGroup[]
  sitemaps: string[]
  /** Any directive this parser does not know. Asserted empty: a typo is a bug. */
  unrecognised: string[]
}

/**
 * A robots.txt parser, deliberately strict.
 *
 * Comments run from `#` to end of line and are dropped BEFORE anything else, so
 * the long rationale at the top of the file cannot satisfy any assertion below
 * — the same reason src/routes.test.ts strips comments before reading route
 * source. Field names are case-insensitive per the standard; v1's generated
 * file writes `User-Agent` and this one writes `User-agent`.
 *
 * Consecutive `User-agent` lines form ONE group, which is the rule that makes
 * "there is exactly one group here" a meaningful thing to assert: a second
 * group with its own rules is precisely how a `Disallow` that reads correctly
 * stops applying to Googlebot.
 */
function parseRobots(text: string): Robots {
  const robots: Robots = { groups: [], sitemaps: [], unrecognised: [] }
  let group: RobotsGroup | null = null
  let previousWasUserAgent = false

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue

    const separator = line.indexOf(':')
    if (separator === -1) {
      robots.unrecognised.push(line)
      previousWasUserAgent = false
      continue
    }

    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === 'user-agent') {
      if (!previousWasUserAgent || !group) {
        group = { userAgents: [], allow: [], disallow: [] }
        robots.groups.push(group)
      }
      group.userAgents.push(value)
      previousWasUserAgent = true
      continue
    }

    previousWasUserAgent = false
    if (field === 'sitemap') robots.sitemaps.push(value)
    else if (field === 'allow' && group) group.allow.push(value)
    else if (field === 'disallow' && group) group.disallow.push(value)
    else robots.unrecognised.push(line)
  }

  return robots
}

const robots = parseRobots(read(ROBOTS))

describe('public/robots.txt', () => {
  test('is one group for every crawler, and nothing this parser cannot read', () => {
    // v2 shipped the Vite starter default until Phase 7 Task 8: a comment,
    // `User-agent: *` and an empty `Disallow:`, which allows everything.
    expect(robots.unrecognised).toEqual([])
    expect(robots.groups).toHaveLength(1)
    expect(robots.groups[0].userAgents).toEqual(['*'])
  })

  test('disallows exactly /app, /me, /complete-profile and /api', () => {
    // SORTED AND EXHAUSTIVE, not four toContain calls. The mutation a
    // `toContain('Disallow: /app')` cannot see is an ADDED rule — a
    // `Disallow: /privacy` slipped in beneath these would deindex the legal
    // pages and satisfy every positive assertion in the file.
    expect([...robots.groups[0].disallow].sort()).toEqual([
      '/api',
      '/app',
      '/complete-profile',
      '/me',
    ])
  })

  test('the /me rule has no trailing slash, which is where v1 gets it wrong', () => {
    // Production serves `Disallow: /me/` today. These are PREFIX rules, and
    // `/me/` is not a prefix of `/me`, so v1's dashboard — the page behind the
    // login — has been crawlable for the life of the project. v2's `/me` covers
    // the path and everything under it.
    expect(robots.groups[0].disallow).toContain('/me')
    expect(robots.groups[0].disallow).not.toContain('/me/')
  })

  test('allows everything else', () => {
    expect(robots.groups[0].allow).toEqual(['/'])
  })

  test('names one sitemap, at the production origin', () => {
    // THE LITERAL, not `${SITE_ORIGIN}/sitemap.xml` — building the expectation
    // from the same constant the code uses would pass whatever that constant
    // became. The second assertion is what ties the two together, and it is
    // the one that fails if only one of the pair is edited.
    expect(robots.sitemaps).toEqual(['https://wordleteams.com/sitemap.xml'])
    expect(robots.sitemaps[0]).toBe(`${SITE_ORIGIN}/sitemap.xml`)
  })
})

// ---------------------------------------------------------------------------
// The sitemap document, parsed into url records.
// ---------------------------------------------------------------------------

/**
 * The `<url>` entries of a urlset, each as a tag -> text record.
 *
 * There is no DOMParser under `environment: 'edge-runtime'` and no XML parser
 * in the tree, so this is hand-rolled — but it still yields BOUNDED VALUES. An
 * assertion below is about one entry's `<loc>`, never about "this string
 * appears somewhere in the document", and the key set of each record is
 * asserted too, which is what makes the absence of `<lastmod>` provable rather
 * than merely unobserved.
 */
function parseUrlset(xml: string): Array<Record<string, string>> {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true)

  const open = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  const start = xml.indexOf(open)
  const end = xml.indexOf('</urlset>')
  expect(start, 'no sitemaps.org urlset element').toBeGreaterThan(-1)
  expect(end, 'unclosed urlset element').toBeGreaterThan(start)

  const inner = xml.slice(start + open.length, end)
  const entries = [...inner.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/<(\w+)>([^<]*)<\/\1>/g)].map(([, tag, value]) => [tag, value]),
    ),
  )

  // Nothing may live between the <url> blocks. Without this a stray element
  // could sit in the urlset and no per-entry assertion would ever see it.
  expect(inner.replace(/<url>[\s\S]*?<\/url>/g, '').trim()).toBe('')
  return entries
}

const sitemap = parseUrlset(renderSitemap())

/** Every URL the sitemap advertises, as a path: the apex becomes '/'. */
const sitemapPaths = sitemap.map((entry) => new URL(entry.loc).pathname)

describe('/sitemap.xml', () => {
  test('lists v1’s seven URLs, in v1’s order, and nothing else', () => {
    // ABSOLUTE URLS SPELLED OUT. Asserting on paths alone would pass on a
    // sitemap of beta.wordleteams.com URLs, which is a request to index the
    // staging copy of the site.
    expect(sitemap.map((entry) => entry.loc)).toEqual([
      'https://wordleteams.com',
      'https://wordleteams.com/home',
      'https://wordleteams.com/about',
      'https://wordleteams.com/privacy',
      'https://wordleteams.com/terms',
      'https://wordleteams.com/login',
      'https://wordleteams.com/maintenance',
    ])
  })

  test('carries v1’s priorities and change frequencies', () => {
    expect(sitemap.map((entry) => entry.priority)).toEqual([
      '1',
      '0.9',
      '0.8',
      '0.7',
      '0.6',
      '0.5',
      '0.4',
    ])
    expect(sitemap.map((entry) => entry.changefreq)).toEqual([
      'monthly',
      'monthly',
      'monthly',
      'yearly',
      'yearly',
      'yearly',
      'yearly',
    ])
  })

  test('carries no <lastmod> on any entry, which is the one change from v1', () => {
    // v1 stamps `new Date()` on all seven, so every URL claims to have changed
    // at the moment the crawler asked — the exact signal that makes a site's
    // lastmod untrustworthy. The build date would be the same mistake more
    // slowly. See the argument in lib/sitemap.ts.
    //
    // BOTH DIRECTIONS. The key-set assertion is the bounded one; the whole-
    // document scan is a negative over a superset, which cannot pass falsely.
    for (const entry of sitemap) {
      expect(Object.keys(entry).sort()).toEqual(['changefreq', 'loc', 'priority'])
    }
    expect(renderSitemap()).not.toContain('lastmod')
  })

  test('every <loc> is an absolute URL at the canonical origin', () => {
    for (const entry of sitemap) {
      expect(new URL(entry.loc).origin).toBe('https://wordleteams.com')
    }
    // The rendered document and the entry table cannot disagree about how many
    // URLs there are.
    expect(sitemap).toHaveLength(SITEMAP_ENTRIES.length)
  })

  test('the response is application/xml and edge-cacheable for everyone', async () => {
    // THE REAL Response OBJECT, built by the function the route calls. This is
    // the assertion that would otherwise exist only in Playwright.
    const response = sitemapResponse()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8')
    expect(SITEMAP_CONTENT_TYPE).toBe('application/xml; charset=utf-8')

    // Unconditionally shareable, unlike an SSR document: this body is rendered
    // from a compile-time constant, reads no request and is byte-identical for
    // an anonymous crawler and a signed-in user, so lib/cache-policy.ts's
    // session dimension has nothing to attach to. The LITERAL, so that a change
    // to STATIC_CACHE has to be made here too.
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )

    // NOT `private, no-store`. src/server.ts rewrites cache-control on any
    // text/html response and leaves everything else alone; this pins that the
    // content-type is on the correct side of that guard.
    expect(response.headers.get('cache-control')).not.toContain('no-store')

    expect(await response.text()).toBe(renderSitemap())
  })
})

describe('the /sitemap.xml route is still wired to that response', () => {
  // The wiring is the one part of this feature no imported function can reach:
  // src/routes/sitemap[.]xml.ts calls createFileRoute, which cannot be imported
  // under vitest. Parsed with the compiler rather than matched, for the reason
  // in test-support/source-ast.ts — a literal in a dead `const` has passed
  // every gate and every e2e test twice in this phase.
  const options = () =>
    optionsPassedTo(SITEMAP_ROUTE, read(SITEMAP_ROUTE), "createFileRoute('/sitemap.xml')")

  test('registers at /sitemap.xml and answers GET, and only GET', () => {
    const handlers = propertiesOf(propertiesOf(options().get('server')!).get('handlers')!)
    expect([...handlers.keys()]).toEqual(['GET'])
    // The handler expression itself, bounded to that property's initializer —
    // not "sitemapResponse appears in this file", which the module's own doc
    // comment would satisfy on its own.
    expect(handlers.get('GET')!.getText()).toMatch(
      /^withErrorCapture\(\s*'\/sitemap\.xml GET',\s*\(\) => sitemapResponse\(\),?\s*\)$/,
    )
  })

  test('is in the generated route tree, so the [.] escape really resolved', () => {
    // `sitemap[.]xml.ts` without the brackets registers as `/sitemap/xml` and
    // every unit test above still passes — this is the only place that shows.
    // routeTree.gen.ts is checked in, so it is an artefact of the commit.
    expect(read('./routeTree.gen.ts')).toMatch(/path:\s*'\/sitemap\.xml'/)
  })
})

// ---------------------------------------------------------------------------
// The social card.
// ---------------------------------------------------------------------------

/** The exact strings production serves, read off `curl https://wordleteams.com/home`. */
const PROD_TITLE = 'Wordle Teams: The ultimate app for Wordle enthusiasts'
const PROD_DESCRIPTION =
  'Wordle Teams lets you compete with friends by tracking and comparing your Wordle scores, adding a competitive edge to the popular word-guessing game. Stay ahead of the competition, enjoy friendly rivalry, and prove your Wordle mastery with this exciting score-tracking app. Revive the Wordle craze and bring your A-game to the ultimate word-guessing showdown with Wordle Teams!'

const metaKey = (tag: (typeof socialMetaTags)[number]) =>
  'name' in tag ? tag.name : tag.property

describe('the OpenGraph and Twitter card', () => {
  test('every tag is declared once', () => {
    // A duplicate og:title is not a compile error and not a visible one either:
    // scrapers take the first, or the last, depending on the scraper.
    const keys = socialMetaTags.map(metaKey)
    expect([...new Set(keys)]).toHaveLength(keys.length)
  })

  test('matches, tag for tag, what production emits today', () => {
    // v1's values were read OFF THE LIVE DOCUMENT, not reconstructed from its
    // `metadata` object — Next expands one image descriptor into four tags with
    // rules of its own, and this is a parity port of the OUTPUT.
    //
    // The whole map at once, so an ADDED tag fails as loudly as a changed one.
    expect(Object.fromEntries(socialMetaTags.map((tag) => [metaKey(tag), tag.content]))).toEqual({
      description: PROD_DESCRIPTION,
      'og:title': PROD_TITLE,
      'og:description': PROD_DESCRIPTION,
      'og:url': 'https://wordleteams.com',
      'og:site_name': 'Wordle Teams',
      'og:image:type': 'image/png',
      'og:image:width': '1200',
      'og:image:height': '630',
      'og:image:alt': 'Wordle Teams',
      'og:image': 'https://wordleteams.com/opengraph-image.png',
      'og:type': 'website',
      'twitter:card': 'summary_large_image',
      'twitter:title': PROD_TITLE,
      'twitter:description': PROD_DESCRIPTION,
      'twitter:image:type': 'image/png',
      'twitter:image:width': '1200',
      'twitter:image:height': '630',
      'twitter:image:alt': 'Wordle Teams',
      'twitter:image': 'https://wordleteams.com/opengraph-image.png',
    })
  })

  test('the constants the rest of the app shares hold those same values', () => {
    // The map above pins the TAGS. These pin the CONSTANTS, which routes and
    // lib/seo.ts's pageTitle() also read — so the two cannot be split by
    // editing one and leaving the other.
    expect(APP_DEFAULT_TITLE).toBe(PROD_TITLE)
    expect(APP_DESCRIPTION).toBe(PROD_DESCRIPTION)
    expect(APP_NAME).toBe('Wordle Teams')
    expect(OG_IMAGE_ALT).toBe('Wordle Teams') // v1's opengraph-image.alt.txt
    expect(OG_IMAGE_TYPE).toBe('image/png')
    expect(OG_IMAGE_URL).toBe('https://wordleteams.com/opengraph-image.png')
  })

  test('twitter:image and og:image are the same asset, deliberately', () => {
    // v1 ships two byte-identical 196KB PNGs and points one tag at each,
    // because Next's file convention gave it opengraph-image.png and
    // twitter-image.png. v2 ships one. If these ever diverge it should be
    // because somebody drew a second picture.
    const tags = new Map(socialMetaTags.map((tag) => [metaKey(tag), tag.content]))
    expect(tags.get('twitter:image')).toBe(tags.get('og:image'))
  })

  test('the declared dimensions are the ones in the PNG that ships', () => {
    // READ OUT OF THE FILE'S IHDR CHUNK. og:image:width and og:image:height are
    // strings in a meta tag; nothing else in this repo could notice them being
    // wrong, and a scraper that trusts them renders a stretched card. Uint8Array
    // rather than Buffer: the vitest environment is edge-runtime.
    const bytes = new Uint8Array(readFileSync(new URL(OG_IMAGE_FILE, import.meta.url)))
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe('IHDR')

    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(header.getUint32(16)).toBe(1200)
    expect(header.getUint32(20)).toBe(630)
    expect(OG_IMAGE_WIDTH).toBe(1200)
    expect(OG_IMAGE_HEIGHT).toBe(630)
  })

  test('og:image points at that file and not at some other host', () => {
    const url = new URL(OG_IMAGE_URL)
    expect(url.origin).toBe('https://wordleteams.com')
    expect(url.pathname).toBe('/opengraph-image.png')
    // The path names a file that is actually in public/. A social card with a
    // 404 for an image is the failure mode nobody sees until a link is shared.
    expect(readFileSync(new URL(OG_IMAGE_FILE, import.meta.url)).byteLength).toBeGreaterThan(0)
  })

  test('__root.tsx really spreads the tags into head().meta', () => {
    // The only unimported link in the chain. Deleting `...socialMetaTags` from
    // the root head leaves every assertion above green and ships a site with no
    // description and no social card.
    const root = optionsPassedTo(
      ROOT_ROUTE,
      read(ROOT_ROUTE),
      'createRootRouteWithContext<RouterContext>()',
    )
    const meta = elementsOf(propertiesOf(returnedObjectOf(root.get('head')!)).get('meta')!)
    expect(meta.filter((element) => element === '...socialMetaTags')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// The check that spans the files.
// ---------------------------------------------------------------------------

/** robots.txt rules are prefix matches on the path. */
const disallowedBy = (pathname: string) =>
  robots.groups[0].disallow.filter((rule) => rule !== '' && pathname.startsWith(rule))

describe('robots.txt and the sitemap cannot contradict each other', () => {
  test('nothing the sitemap advertises is disallowed', () => {
    // THE POINT OF THIS FILE. Two artefacts describing one set of URLs, edited
    // months apart by people who have read one of them. A sitemap entry for a
    // path robots.txt forbids fetching asks a crawler to index a page it is not
    // allowed to read, and it resolves that by ignoring one of the two.
    const contradictions = sitemapPaths
      .map((pathname) => [pathname, disallowedBy(pathname)] as const)
      .filter(([, rules]) => rules.length > 0)
    expect(contradictions).toEqual([])
  })

  test('the sitemap URL robots.txt names is not itself disallowed', () => {
    expect(disallowedBy(new URL(robots.sitemaps[0]).pathname)).toEqual([])
  })

  test('every route in the app is listed, disallowed, or deliberately neither', () => {
    /**
     * THE CHECK THAT MAKES THE NEXT ROUTE A DECISION INSTEAD OF AN OMISSION.
     *
     * routeTree.gen.ts is generated by the vite plugin and checked in, so it is
     * the app's real route list at this commit. Every path in it must be
     * accounted for one of three ways, and the third has to be written down
     * here — which is the whole mechanism: adding a route without thinking
     * about crawlers turns this red with the path's name in the failure.
     */
    const NEITHER = new Map([
      [
        '/login-error',
        'New in v2 (Task 6) and NOT disallowed — there is no harm in a crawler ' +
          'that finds it, the page is four sentences and a link. But a sitemap says ' +
          '"these are worth showing a searcher", and a dead-end error page reachable ' +
          'only mid sign-in is not. Nothing links to it either way.',
      ],
      ['/sitemap.xml', 'The sitemap does not list itself.'],
    ])

    const routes = [
      ...new Set(
        [...read('./routeTree.gen.ts').matchAll(/^\s*path: '([^']*)',$/gm)].map(
          (match) => match[1],
        ),
      ),
    ].sort()

    // The generated tree is the input to everything below, so a change to its
    // shape must not quietly turn this into a test of nothing.
    expect(routes.length, 'no route paths parsed out of routeTree.gen.ts').toBeGreaterThan(10)

    const unaccounted = routes.filter(
      (path) =>
        !sitemapPaths.includes(path) && disallowedBy(path).length === 0 && !NEITHER.has(path),
    )
    expect(
      unaccounted,
      'these routes are in neither the sitemap nor robots.txt. Decide: advertise ' +
        'it in lib/sitemap.ts, exclude it in public/robots.txt, or add it to ' +
        'NEITHER above with the reason.',
    ).toEqual([])

    // The converse, so a stale exclusion cannot outlive its route.
    expect([...NEITHER.keys()].filter((path) => !routes.includes(path))).toEqual([])

    // And the sitemap may only advertise paths that exist. A URL in a sitemap
    // that 404s is the one sitemap error Search Console actually reports.
    expect(sitemapPaths.filter((path) => !routes.includes(path))).toEqual([])
  })
})
