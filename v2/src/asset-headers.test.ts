import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * public/_headers — the cache policy for everything src/server.ts never sees.
 *
 * PARSED, NOT SUBSTRING-MATCHED, for the reason crawler-metadata.test.ts gives
 * about robots.txt: `expect(file).toContain('immutable')` passes on a file
 * where the rule sits under the wrong path, inside a comment, or is overridden
 * by a later block. The dangerous assertion here is a NEGATIVE one — that
 * /sw.js is not covered — and a substring check cannot express it at all.
 */
const source = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')

/** `_headers` is path blocks in column 0, indented `Name: value` lines beneath. */
function parseHeaders(text: string): Array<{ path: string; headers: Record<string, string> }> {
  const rules: Array<{ path: string; headers: Record<string, string> }> = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '')
    if (!line.trim()) continue
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), headers: {} })
      continue
    }
    const [, name, value] = line.match(/^\s+([^:]+):\s*(.+?)\s*$/) ?? []
    if (name && rules.length > 0) rules[rules.length - 1].headers[name.toLowerCase()] = value
  }
  return rules
}

const rules = parseHeaders(source)

/** Cloudflare matches `*` as a wildcard over the rest of the path. */
const matches = (pattern: string, pathname: string) =>
  new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(
    pathname,
  )

const policyFor = (pathname: string) =>
  rules.filter((rule) => matches(rule.path, pathname)).at(-1)?.headers['cache-control'] ?? null

describe('the immutable rules cover exactly what is safe to freeze', () => {
  test('content-hashed bundles are immutable for a year', () => {
    // The filename changes whenever the bytes do, so a stale copy can never be
    // requested. Also the highest-value entry: every visitor fetches these.
    for (const asset of ['/assets/index-Buk_bM4H.js', '/assets/styles-abc123.css']) {
      expect(policyFor(asset), asset).toContain('immutable')
      expect(policyFor(asset), asset).toContain('max-age=31536000')
    }
  })

  test('the self-hosted fonts are immutable for a year', () => {
    // SAME ARGUMENT AS /assets/*, and it holds for the same reason: the
    // filenames come from Google and are content-derived, and
    // scripts/fetch-fonts.mjs clears public/fonts/ before every run — so a
    // refreshed face lands under a NEW name and the old one stops being
    // referenced. A stale immutable copy can never be requested.
    //
    // These went same-origin in wordle-teams-c0f.7 specifically to get off the
    // cold-start critical path; leaving them on the revalidate-always default
    // would give back part of what that bought.
    for (const font of ['/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7W0Q5n-wU.woff2']) {
      expect(policyFor(font), font).toContain('immutable')
      expect(policyFor(font), font).toContain('max-age=31536000')
    }
  })

  test('the OpenGraph image matches what production sends, byte for byte', () => {
    // Parity is the point of this rule — the apex inherits it at cutover.
    expect(policyFor('/opengraph-image.png')).toBe(
      'public, immutable, no-transform, max-age=31536000',
    )
  })
})

describe('the files that must NOT be frozen are not covered', () => {
  test('/sw.js has no rule at all', () => {
    // THE ASSERTION THAT MATTERS MOST HERE. The service worker controls every
    // future update; a browser holding a year-old copy cannot be reached by
    // shipping a new one. A `/*` rule added later would silently catch it,
    // which is exactly what this is written against.
    expect(policyFor('/sw.js')).toBeNull()
  })

  for (const pathname of ['/robots.txt', '/favicon.ico', '/offline.html']) {
    test(`${pathname} keeps the Workers Assets default`, () => {
      expect(policyFor(pathname)).toBeNull()
    })
  }

  test('/manifest.json is an hour, matching neither production nor the default', () => {
    /**
     * THE ONLY RULE IN THE FILE THAT IS DELIBERATELY NEITHER (wordle-teams-v917).
     *
     * Production sends `public, immutable, no-transform, max-age=31536000`.
     * Pinned as an EXACT string rather than "contains 3600", because the two
     * ways this can go wrong are both silent: drifting to immutable freezes the
     * app name, icons and start_url for a year, and losing the rule entirely
     * returns it to the Workers Assets default with nothing to say so.
     *
     * start_url is the field that makes freezing actively dangerous — it changes
     * at cutover, from production's /me to v2's /app.
     */
    expect(policyFor('/manifest.json')).toBe('public, max-age=3600')
    expect(policyFor('/manifest.json')).not.toContain('immutable')
  })

  test('the splash images get a day, and are deliberately NOT immutable', () => {
    // THE OPPOSITE CALL FROM /assets/* AND /fonts/*, and the difference is the
    // filename. Those are content-derived, so new bytes mean a new URL and a
    // frozen copy can never be requested. SPLASH NAMES ARE STABLE ACROSS
    // REDRAWS — scripts/build-splash-screens.mjs writes
    // iphone-15-portrait-dark.png under that same name every run — so an
    // immutable copy could never be replaced, and a redraw would be invisible
    // for a year to everyone who had already fetched one. Same argument
    // wordle-teams-v917 made for /manifest.json.
    //
    // Nor the Workers Assets default: 60 files revalidating at install is 60
    // round trips buying nothing. A day is long enough to make an install
    // cheap and short enough that a redraw propagates without anyone having to
    // remember this file exists.
    expect(policyFor('/splash/iphone-15-portrait-dark.png')).toBe('public, max-age=86400')
    expect(policyFor('/splash/iphone-15-portrait-dark.png')).not.toContain('immutable')
  })

  test('no rule is a bare catch-all', () => {
    // `/*` would cover every negative case above in one edit and is the single
    // change that makes this whole file dangerous.
    expect(rules.map((rule) => rule.path)).not.toContain('/*')
  })
})

test('every rule sets a cache-control and nothing else', () => {
  // An unnoticed second header here would ship to production on the apex.
  for (const rule of rules) {
    expect(Object.keys(rule.headers), rule.path).toEqual(['cache-control'])
  }
})
