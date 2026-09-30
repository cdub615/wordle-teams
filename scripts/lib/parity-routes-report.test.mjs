import { describe, expect, test } from 'vitest'
import { classify, extractMeta, formatTable, observe, relativize } from './parity-routes-report.mjs'

// The verdict logic for the Phase 7 route parity audit, pinned. parity-routes.mjs
// itself cannot be tested — it fetches two live origins — so everything that
// decides whether a row reads as MATCH, GAP or DIVERGENCE lives here, per the
// rule recorded in vitest.config.ts's comment.
//
// What is at stake: this table is the mechanical half of Task 17's checklist and
// the evidence Stage B's sign-off rests on. A classifier that cries wolf on
// eighteen rows stops being read, and one that swallows a real gap is worse.

describe('classify', () => {
  test('identical responses are a match', () => {
    const row = classify({
      path: '/about',
      prod: { status: 200, cacheControl: 'public, s-maxage=86400', title: 'About - Wordle Teams' },
      beta: { status: 200, cacheControl: 'public, s-maxage=86400', title: 'About - Wordle Teams' },
    })
    expect(row.verdict).toBe('match')
    expect(row.fields).toEqual([])
  })

  test('a route present on prod and absent on beta is a gap', () => {
    const row = classify({
      path: '/terms',
      prod: { status: 200, title: 'Terms - Wordle Teams' },
      beta: { status: 404 },
    })
    expect(row.verdict).toBe('missing-on-beta')
  })

  // The mirror case. The route list is the UNION of both surfaces, so v2-only
  // routes (/app, /maintenance) are in it and must not classify as a match with
  // prod's 404 — the audit has to say which side is missing which.
  test('a route present on beta and absent on prod is reported as such', () => {
    const row = classify({
      path: '/app',
      prod: { status: 404 },
      beta: { status: 200, title: 'Wordle Teams' },
    })
    expect(row.verdict).toBe('missing-on-prod')
  })

  test('a route absent on both sides is a match', () => {
    const row = classify({ path: '/nope', prod: { status: 404 }, beta: { status: 404 } })
    expect(row.verdict).toBe('match')
  })

  // The jcj case, and the reason amendment A4 exists. A page that renders
  // identically but caches differently is a DIFFERENCE, and it is exactly the
  // one a screenshot comparison cannot see.
  test('same body, different cache header, is still a difference', () => {
    const row = classify({
      path: '/privacy',
      prod: { status: 200, cacheControl: 'public, max-age=0, must-revalidate', title: 'Privacy' },
      beta: { status: 200, cacheControl: 'public, s-maxage=86400', title: 'Privacy' },
    })
    expect(row.verdict).toBe('differs')
    expect(row.fields).toContain('cacheControl')
  })

  // Cache-Control is an unordered directive list. Flagging a reorder would be a
  // false positive on the one field the audit exists to check, so the comparison
  // is set-wise — but ONLY set-wise: a changed max-age is still a difference.
  test('cache directives compare as a set, not as a string', () => {
    const same = classify({
      path: '/',
      prod: { status: 200, cacheControl: 'public, s-maxage=86400, stale-while-revalidate=604800' },
      beta: { status: 200, cacheControl: 'stale-while-revalidate=604800, s-maxage=86400, public' },
    })
    expect(same.verdict).toBe('match')

    const changed = classify({
      path: '/',
      prod: { status: 200, cacheControl: 'public, s-maxage=86400' },
      beta: { status: 200, cacheControl: 'public, s-maxage=60' },
    })
    expect(changed.fields).toContain('cacheControl')
  })

  test('content type compares case- and whitespace-insensitively', () => {
    const row = classify({
      path: '/sitemap.xml',
      prod: { status: 200, contentType: 'application/xml; charset=utf-8' },
      beta: { status: 200, contentType: 'application/xml;charset=UTF-8' },
    })
    expect(row.verdict).toBe('match')
  })

  // A known divergence must be reportable as expected, or the report cries
  // wolf on eighteen rows and stops being read.
  test('a route marked expected-absent is not a gap', () => {
    const row = classify({
      path: '/branding',
      expectAbsentOnBeta: true,
      prod: { status: 200 },
      beta: { status: 404 },
    })
    expect(row.verdict).toBe('expected')
  })

  // The other half of that flag, and the one that keeps it honest. An
  // expectation that fires on the OPPOSITE observation is exactly the "green for
  // a reason other than the behaviour it names" failure this phase kept finding:
  // /branding turning up ON beta must not be filed under "expected, ignore".
  test('expected-absent does not swallow a route that is actually present on beta', () => {
    const row = classify({
      path: '/branding',
      expectAbsentOnBeta: true,
      prod: { status: 200, title: 'Branding' },
      beta: { status: 200, title: 'Something else' },
    })
    expect(row.verdict).toBe('differs')
    expect(row.fields).toContain('title')
  })

  // /me is the reason parity-routes.mjs uses redirect: 'manual'. A 301 is a
  // route that EXISTS, and where it points is the answer we came for.
  test('a redirect is present, and its target is compared', () => {
    const row = classify({
      path: '/me',
      prod: { status: 200, title: 'Wordle Teams' },
      beta: { status: 301, location: '/app' },
    })
    expect(row.verdict).toBe('differs')
    expect(row.fields).toEqual(expect.arrayContaining(['status', 'location']))
  })

  // The og: set is compared over the UNION of both sides' keys. Comparing only
  // prod's keys would be blind to a tag beta invented, and comparing only the
  // ones both sides have would be blind to a tag beta dropped — the Phase 7
  // footer test made exactly this mistake with <a href> links.
  test('an OpenGraph tag present on one side only is a difference', () => {
    const dropped = classify({
      path: '/',
      prod: { status: 200, og: { 'og:image': '/opengraph-image.png' } },
      beta: { status: 200, og: {} },
    })
    expect(dropped.fields).toContain('og:image')

    const invented = classify({
      path: '/',
      prod: { status: 200, og: {} },
      beta: { status: 200, og: { 'og:video': '/x.mp4' } },
    })
    expect(invented.fields).toContain('og:video')
  })

  // A 500 is NOT absence. Folding it into "missing" would let a beta outage
  // during the audit read as a known gap, which is the one misreading that
  // could get signed off.
  test('a route that is broken on beta is a difference, not a gap', () => {
    const row = classify({
      path: '/app',
      prod: { status: 200, title: 'Wordle Teams' },
      beta: { status: 500 },
    })
    expect(row.verdict).toBe('differs')
    expect(row.fields).toContain('status')
  })

  test('a fetch failure on either side is an error, never a match', () => {
    const row = classify({
      path: '/',
      prod: { status: 200, title: 'Wordle Teams' },
      beta: { error: 'ECONNREFUSED' },
    })
    expect(row.verdict).toBe('error')
  })
})

describe('relativize', () => {
  test('rewrites a URL on the fetched origin to its path', () => {
    expect(relativize('https://beta.wordleteams.com/about', 'https://beta.wordleteams.com')).toBe('/about')
    expect(relativize('https://beta.wordleteams.com', 'https://beta.wordleteams.com')).toBe('/')
    expect(relativize('/about', 'https://beta.wordleteams.com')).toBe('/about')
  })

  // wt-ksh.8.55: beta's og:url is the APEX on every route. Leaving a foreign
  // origin absolute is what makes that visible — rewriting every URL to its path
  // would turn /about's `https://wordleteams.com` into `/` on both sides and
  // hide the divergence behind a match.
  test('leaves a URL pointing at some other origin absolute', () => {
    expect(relativize('https://wordleteams.com/about', 'https://beta.wordleteams.com')).toBe(
      'https://wordleteams.com/about',
    )
  })

  test('does not treat a longer hostname as the origin it is a prefix of', () => {
    expect(relativize('https://wordleteams.com.evil.test/x', 'https://wordleteams.com')).toBe(
      'https://wordleteams.com.evil.test/x',
    )
  })
})

describe('extractMeta', () => {
  const doc = (head) => `<!DOCTYPE html><html><head>${head}</head><body><h1>hi</h1></body></html>`

  test('reads title, canonical and the og set', () => {
    const meta = extractMeta(
      doc(
        `<title>Wordle Teams</title>` +
          `<link rel="canonical" href="https://wordleteams.com/about"/>` +
          `<meta property="og:title" content="Wordle Teams"/>` +
          `<meta property="og:image" content="/opengraph-image.png"/>`,
      ),
    )
    expect(meta.title).toBe('Wordle Teams')
    expect(meta.canonical).toBe('https://wordleteams.com/about')
    expect(meta.og).toEqual({ 'og:title': 'Wordle Teams', 'og:image': '/opengraph-image.png' })
  })

  // THE wt-ksh.8.44 HAZARD, as a test. Every SSR document this app serves
  // carries NUL bytes — TanStack serializes route ids with a trailing one — and
  // that is what makes grep report a fully server-rendered page as having no
  // matches at all. A harness that inherits the same blindness reports every
  // route on beta as missing every meta tag, which reads as catastrophic parity
  // failure and is nothing of the sort.
  test('finds everything in a document carrying NUL bytes', () => {
    const NUL = '\u0000'
    const html =
      doc(`<title>Wordle Teams</title><meta property="og:title" content="Wordle Teams"/>`) +
      `<script>window.__D={"routes":["__root__${NUL}","/${NUL}"]}</script>`
    expect(html.includes(NUL)).toBe(true)

    const meta = extractMeta(html)
    expect(meta.title).toBe('Wordle Teams')
    expect(meta.og['og:title']).toBe('Wordle Teams')
  })

  test('survives attribute order, single quotes and extra attributes', () => {
    const meta = extractMeta(
      doc(
        `<link href='/x' rel='canonical' data-tsr=''>` +
          `<meta content="Compete with friends" property="og:description" data-x>`,
      ),
    )
    expect(meta.canonical).toBe('/x')
    expect(meta.og['og:description']).toBe('Compete with friends')
  })

  // THE REGRESSION, and the reason this reader is NOT bounded on </head>.
  //
  // Measured against production 2026-09-01: `/about` closes </head> at byte 2960
  // and emits its <title> at 9787. React streams metadata into the BODY on
  // dynamically-rendered routes and only hoists it into the head once the client
  // runs; prerendered routes like /privacy put it in the head as expected, which
  // is exactly what makes it easy to miss — half the routes look right.
  //
  // The first draft of this file WAS head-bounded, and reported prod's /, /about
  // and /login as having no title and no OpenGraph tags at all. False, on the
  // three highest-traffic routes in the audit, and false in the direction that
  // reads as "beta invented twelve tags production never had".
  test('reads metadata that React streamed into the body', () => {
    const html =
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="app">…</div>` +
      `<title>About - Wordle Teams</title>` +
      `<meta property="og:title" content="About - Wordle Teams">` +
      `<link rel="canonical" href="/about">` +
      `</body></html>`
    const meta = extractMeta(html)
    expect(meta.title).toBe('About - Wordle Teams')
    expect(meta.og['og:title']).toBe('About - Wordle Teams')
    expect(meta.canonical).toBe('/about')
  })

  // What the head bound was really buying, kept: an <svg><title> is an icon's
  // accessible name, not the document's.
  test('an svg title is an icon label, not the document title', () => {
    expect(extractMeta(doc('') + `<svg viewBox="0 0 1 1"><title>Icon</title></svg><title>Real</title>`).title).toBe(
      'Real',
    )
    expect(extractMeta(doc('') + `<svg viewBox="0 0 1 1"><title>Icon</title></svg>`).title).toBeUndefined()
  })

  // The other half: the dehydrated router payload is serialized text inside a
  // <script>, so markup quoted in it is not markup. This is the blob the NUL
  // bytes live in.
  //
  // The markup inside the script is UNESCAPED on purpose. A first draft quoted
  // it the way a JS string literal would (`\\"og:title\\"`), and the mutation
  // that deleted the script stripper altogether still passed — the backslashes
  // alone were enough to stop the attribute parser, so the test was green for a
  // reason other than the behaviour it names. Raw markup is the case the
  // stripper actually exists for.
  test('og-shaped markup inside a script payload is not a meta tag', () => {
    const html =
      doc(`<title>Real</title>`) +
      `<script>window.__D = '<meta property="og:title" content="injected"><title>Injected</title>'</script>`
    const meta = extractMeta(html)
    expect(meta.title).toBe('Real')
    expect(meta.og).toEqual({})
  })

  // Pinned because the code claims it and nothing else exercises it: with two
  // document-level titles a browser resolves the FIRST, and so does this.
  test('the first document title wins, not the last', () => {
    expect(extractMeta(doc(`<title>First</title>`) + `<title>Second</title>`).title).toBe('First')
  })

  test('decodes entities in the title', () => {
    expect(extractMeta(doc(`<title>Wordle &amp; Teams &#39;25</title>`)).title).toBe("Wordle & Teams '25")
  })

  test('a non-HTML body yields no metadata rather than throwing', () => {
    const meta = extractMeta('User-agent: *\nDisallow: /app\n')
    expect(meta.title).toBeUndefined()
    expect(meta.canonical).toBeUndefined()
    expect(meta.og).toEqual({})
  })

  test('og tags declared with name= instead of property= are still read', () => {
    expect(extractMeta(doc(`<meta name="og:type" content="website">`)).og['og:type']).toBe('website')
  })
})

describe('observe', () => {
  const headers = (o) => new Headers(o)

  test('pulls the compared fields off a real response shape', () => {
    const side = observe({
      origin: 'https://beta.wordleteams.com',
      status: 200,
      headers: headers({ 'cache-control': 'public, s-maxage=86400', 'content-type': 'text/html; charset=utf-8' }),
      body: `<html><head><title>Wordle Teams</title><link rel="canonical" href="https://beta.wordleteams.com/about"></head></html>`,
    })
    expect(side).toMatchObject({
      status: 200,
      cacheControl: 'public, s-maxage=86400',
      contentType: 'text/html; charset=utf-8',
      title: 'Wordle Teams',
      canonical: '/about',
    })
  })

  // The metadata of a 301 is not interesting; where it points is. Parsing an
  // empty redirect body must not manufacture a "missing title" difference.
  test('a redirect carries its Location, relativized', () => {
    const side = observe({
      origin: 'https://beta.wordleteams.com',
      status: 301,
      headers: headers({ location: 'https://beta.wordleteams.com/app' }),
      body: '',
    })
    expect(side.status).toBe(301)
    expect(side.location).toBe('/app')
  })

  test('does not parse metadata out of a non-HTML response', () => {
    const side = observe({
      origin: 'https://wordleteams.com',
      status: 200,
      headers: headers({ 'content-type': 'text/plain; charset=utf-8' }),
      body: '<title>not really html</title>',
    })
    expect(side.title).toBeUndefined()
    expect(side.og).toEqual({})
  })

  test('og:url is relativized against the origin it was fetched from', () => {
    const side = observe({
      origin: 'https://beta.wordleteams.com',
      status: 200,
      headers: headers({ 'content-type': 'text/html' }),
      body: `<html><head><meta property="og:url" content="https://wordleteams.com"><meta property="og:image" content="https://beta.wordleteams.com/opengraph-image.png"></head></html>`,
    })
    expect(side.og['og:url']).toBe('https://wordleteams.com')
    expect(side.og['og:image']).toBe('/opengraph-image.png')
  })
})

describe('formatTable', () => {
  const rows = [
    { path: '/about', verdict: 'match', fields: [], prod: { status: 200 }, beta: { status: 200 } },
    {
      path: '/terms',
      verdict: 'missing-on-beta',
      fields: ['status'],
      prod: { status: 200, title: 'Terms' },
      beta: { status: 404 },
    },
    {
      path: '/privacy',
      verdict: 'differs',
      fields: ['cacheControl'],
      prod: { status: 200, cacheControl: 'public, max-age=0, must-revalidate' },
      beta: { status: 200, cacheControl: 'public, s-maxage=86400' },
    },
  ]

  test('renders one summary row per path, with the verdict and the differing fields', () => {
    const md = formatTable(rows)
    const start = md.indexOf('| /about')
    const summary = md.slice(start, md.indexOf('\n\n', start))
    expect(summary).toContain('| /about | 200 | 200 | match |')
    expect(summary).toContain('missing-on-beta')
    expect(summary).toContain('cacheControl')
  })

  test('spells out both values for every differing field, so the table is actionable alone', () => {
    const md = formatTable(rows)
    expect(md).toContain('public, max-age=0, must-revalidate')
    expect(md).toContain('public, s-maxage=86400')
  })

  test('escapes pipes so a value cannot silently add a column', () => {
    const md = formatTable([
      {
        path: '/',
        verdict: 'differs',
        fields: ['title'],
        prod: { status: 200, title: 'a | b' },
        beta: { status: 200, title: 'c' },
      },
    ])
    expect(md).toContain('a \\| b')
    expect(md).not.toContain(' a | b ')
  })

  test('counts the verdicts, so the summary cannot disagree with the rows', () => {
    const md = formatTable(rows)
    expect(md).toContain('1 match')
    expect(md).toContain('1 missing-on-beta')
    expect(md).toContain('1 differs')
  })
})
