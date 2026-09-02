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

  for (const pathname of ['/manifest.json', '/robots.txt', '/favicon.ico', '/offline.html']) {
    test(`${pathname} keeps the Workers Assets default`, () => {
      expect(policyFor(pathname)).toBeNull()
    })
  }

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
