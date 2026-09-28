#!/usr/bin/env node
/**
 * Route-by-route parity between production and beta. The mechanical half of the
 * Phase 7 audit (Task 13); Task 17's checklist pastes its table in and then walks
 * the half a script cannot reach.
 *
 *   node scripts/parity-routes.mjs
 *   node scripts/parity-routes.mjs --beta=http://localhost:3000
 *   node scripts/parity-routes.mjs --out=../docs/superpowers/audits/parity-routes.md
 *
 * FETCHING ONLY. Every judgement — what counts as absent, which fields differ,
 * how the table reads — lives in scripts/lib/parity-routes-report.mjs, where a
 * test can reach it. This file cannot be imported without hitting two live
 * origins, which is the rule vitest.config.ts's comment records.
 *
 * THREE THINGS THIS GETS RIGHT ON PURPOSE:
 *
 * 1. REDIRECTS ARE REPORTED, NOT FOLLOWED. `/me` returning a 301 to `/app` is
 *    the interesting answer, and a harness that followed it would report a 200
 *    on both sides and call the divergence a match.
 *
 * 2. NO COOKIES, NO CREDENTIALS. The anonymous rendering is what a crawler and a
 *    first-time visitor get, and it is the case the cache policy makes
 *    cacheable. A signed-in fetch measures a different app.
 *
 * 3. THE BODY IS PARSED, NEVER GREPPED. Every SSR document this app serves
 *    carries NUL bytes, so GNU grep classifies it as binary and reports no
 *    matches with no error — see the header of the lib module and wt-ksh.8.44.
 *    A harness that shelled out to grep would report every route on beta as
 *    missing every meta tag, which reads as catastrophic failure and is nothing
 *    of the sort.
 */
import { writeFileSync } from 'node:fs'
import { classify, formatTable, observe } from './lib/parity-routes-report.mjs'

const DEFAULT_PROD = 'https://wordleteams.com'
const DEFAULT_BETA = 'https://beta.wordleteams.com'

/**
 * The UNION of both apps' public surface, so a route missing on either side
 * shows up as a difference rather than being silently skipped.
 *
 * `expectAbsentOnBeta` marks a divergence that is already known and agreed, so
 * the report does not cry wolf on it. It is deliberately narrow: it downgrades a
 * CONFIRMED absence and nothing else, so a route that unexpectedly turns up on
 * beta still gets compared.
 */
const ROUTES = [
  { path: '/' },
  { path: '/home' },
  { path: '/about' },
  { path: '/privacy' },
  { path: '/terms' },
  { path: '/login' },
  { path: '/login-error' },
  { path: '/maintenance' },
  { path: '/me' },
  { path: '/app' },
  { path: '/complete-profile' },
  { path: '/robots.txt' },
  { path: '/sitemap.xml' },
  { path: '/opengraph-image.png' },
  // v1-only, and staying that way: the branding page was never part of v2's
  // scope. Listed so the audit records the decision rather than omitting the
  // route and leaving a reader to wonder whether anyone checked.
  { path: '/branding', expectAbsentOnBeta: true },
]

// A real browser UA, because that is the request whose answer we care about, and
// because an unfamiliar one can be routed differently by the edge — which would
// make the harness measure something no visitor ever sees.
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}

const trimSlash = (u) => u.replace(/\/+$/, '')

const prodOrigin = trimSlash(arg('prod', DEFAULT_PROD))
const betaOrigin = trimSlash(arg('beta', DEFAULT_BETA))
const outPath = arg('out', undefined)

/**
 * One request. Returns the shape classify() compares, or `{ error }`.
 *
 * The body is read ONLY for HTML. `/opengraph-image.png` is a binary asset whose
 * bytes are not compared, so downloading it would be waste — the response is
 * cancelled instead, which still leaves status and headers measured.
 */
async function probe(origin, path) {
  const url = `${origin}${path}`
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      credentials: 'omit',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,*/*' },
      signal: AbortSignal.timeout(20_000),
    })
    const isHtml = (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')
    let body = ''
    if (isHtml) body = await res.text()
    else await res.body?.cancel()
    return observe({ origin, status: res.status, headers: res.headers, body })
  } catch (e) {
    return { error: e?.cause?.code ?? e?.name ?? String(e), og: {} }
  }
}

const rows = []
for (const route of ROUTES) {
  // Both origins in parallel for one route, but routes serially — a burst of
  // thirty concurrent requests is a different load profile from the one a cache
  // header is measured under, and the whole run takes seconds either way.
  const [prod, beta] = await Promise.all([probe(prodOrigin, route.path), probe(betaOrigin, route.path)])
  rows.push(classify({ path: route.path, prod, beta, expectAbsentOnBeta: route.expectAbsentOnBeta ?? false }))
  process.stderr.write(`  probed ${route.path}\n`)
}

const report = [
  `# Route parity — prod vs beta`,
  '',
  `- prod: \`${prodOrigin}\``,
  `- beta: \`${betaOrigin}\``,
  `- run: ${new Date().toISOString()}`,
  `- anonymous, redirects reported not followed`,
  '',
  formatTable(rows),
].join('\n')

console.log(report)
if (outPath) {
  writeFileSync(outPath, `${report}\n`)
  process.stderr.write(`\nwrote ${outPath}\n`)
}

// A DIFFERENCE IS OUTPUT, NOT A FAILURE — this is an audit, and Stage B expects
// divergences. A fetch that never landed is different: it means a row in the
// table is not evidence of anything, so the run must not read as clean.
const errored = rows.filter((r) => r.verdict === 'error')
if (errored.length) {
  process.stderr.write(`\n${errored.length} route(s) could not be fetched: ${errored.map((r) => r.path).join(', ')}\n`)
  process.exit(1)
}
