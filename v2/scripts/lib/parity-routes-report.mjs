// Route parity: turning two responses into a verdict, and a set of verdicts into
// a table. Pure — no network, no process, no filesystem.
//
// parity-routes.mjs does the fetching and nothing else, per the rule recorded in
// vitest.config.ts's comment: a script that talks to production cannot be
// imported by a test, so what is worth asserting is lifted here.
//
// TWO HAZARDS ARE ENCODED IN THIS FILE, both from Phase 7, both of which made a
// harness lie before anyone noticed:
//
// 1. EVERY SSR DOCUMENT THIS APP SERVES CONTAINS NUL BYTES. TanStack serializes
//    route ids with a trailing one into the dehydrated payload, so a `GET /`
//    carries five. GNU grep classifies such a response as binary and reports NO
//    MATCHES, with no error and no warning; `file` calls it `data`. That already
//    produced one confident wrong answer this phase — that the landing page was
//    client-only and invisible to crawlers, about a page that was fully
//    server-rendered. Metadata is therefore parsed here, in JS, over a string,
//    never by shelling out to a matcher that has an opinion about binary.
//    (wt-ksh.8.44)
//
// 2. THE TWO ORIGINS HAVE DIFFERENT HOSTNAMES, so every URL-valued field —
//    canonical, og:url, og:image, Location — differs textually on every route
//    even when both sides are correct. Comparing raw would put a divergence on
//    all fourteen rows and the table would stop being read. See relativize for
//    the rule, and for why it deliberately does NOT normalize a URL pointing at
//    the *other* origin.

/** Fields compared on every route, in the order they appear in the detail table. */
const SCALAR_FIELDS = ['status', 'location', 'cacheControl', 'contentType', 'title', 'canonical']

/**
 * Rewrite a URL that lives on `origin` to its origin-relative path, and leave
 * every other value exactly as it was.
 *
 * WHY NOT JUST TAKE THE PATH. Because the interesting defects are precisely the
 * URLs that point somewhere unexpected. wt-ksh.8.55 is beta serving the APEX as
 * `og:url` on every route: `https://wordleteams.com` on `/about`. Reducing every
 * URL to its pathname would render that as `/` on both sides and file a real
 * divergence as a match. Leaving a foreign origin absolute makes it impossible
 * to miss — prod says `/about`, beta says `https://wordleteams.com`.
 *
 * The prefix test is on the origin plus a boundary, so `wordleteams.com.evil.test`
 * is not mistaken for `wordleteams.com`.
 */
export function relativize(value, origin) {
  if (typeof value !== 'string' || !origin) return value
  const lower = value.toLowerCase()
  const base = origin.toLowerCase().replace(/\/+$/, '')
  if (!lower.startsWith(base)) return value
  const rest = value.slice(base.length)
  if (rest === '') return '/'
  if (!rest.startsWith('/') && !rest.startsWith('?') && !rest.startsWith('#')) return value
  return rest.startsWith('/') ? rest : `/${rest}`
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
}

/** Attributes of a single tag, parsed from the tag's own body — never from the document. */
function parseAttrs(tagBody) {
  const attrs = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g
  let m
  while ((m = re.exec(tagBody)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}

/**
 * Content that is not document metadata, whatever it looks like.
 *
 *   - `<svg>` and `<math>` are foreign content: a `<title>` in there is the
 *     accessible name of an icon, not the document's title.
 *   - `<script>` and `<template>` hold serialized text. The dehydrated router
 *     payload is a `<script>`, and it is where this app's NUL bytes live.
 *
 * Removing these is what lets the rest of the document be scanned safely — see
 * extractMeta for why scanning only the head is NOT an option.
 */
const NON_METADATA = [
  /<svg\b[\s\S]*?<\/svg\s*>/gi,
  /<math\b[\s\S]*?<\/math\s*>/gi,
  /<script\b[\s\S]*?<\/script\s*>/gi,
  /<template\b[\s\S]*?<\/template\s*>/gi,
]

/**
 * Title, canonical and the OpenGraph set, out of an HTML document.
 *
 * THE WHOLE DOCUMENT IS SCANNED, NOT THE HEAD, and that is a correction rather
 * than laziness. Measured against production on 2026-09-01: on `/about`,
 * `</head>` closes at byte 2960 and the `<title>` is at 9787 — React streams
 * metadata into the BODY on dynamically-rendered routes and hoists it into the
 * head only once the client runs. Prerendered routes like `/privacy` put it in
 * the head as expected, which is what makes the bug so easy to miss: HALF the
 * routes look right.
 *
 * A head-bounded reader therefore reports prod's `/`, `/about` and `/login` as
 * having no title and no OpenGraph tags at all. That is false, and false in the
 * direction that reads as "beta invented twelve tags production never had". The
 * first draft of this file did exactly that, on the three highest-traffic routes
 * in the audit.
 *
 * IT IS STILL BOUNDED, just on the right boundary. Phase 7 kept finding
 * assertions whose scope was wider than the thing they named, so:
 *
 *   - Foreign content and serialized text are removed first (see NON_METADATA),
 *     which is what the head bound was really buying: an `<svg><title>` is an
 *     icon label, and an og-shaped string inside the router payload is not a tag.
 *   - Attributes are parsed out of each tag's OWN body, not matched across the
 *     document, so one tag's `content=` cannot be attributed to another's
 *     `property=`.
 *   - The FIRST title and the FIRST canonical win, as a browser resolves them.
 *
 * NULs are stripped too. JS regexes handle them fine, so this is belt and braces
 * for anything downstream that writes the values out again — but see the file
 * header for why the parsing happens here at all.
 */
export function extractMeta(html) {
  const og = {}
  if (typeof html !== 'string' || html === '') return { title: undefined, canonical: undefined, og }

  // replaceAll with a STRING, not a regex: a NUL in a regex literal is an
  // eslint no-control-regex error, and escaping it there buys nothing.
  let text = html.replaceAll('\u0000', '')
  for (const block of NON_METADATA) text = text.replace(block, '')

  const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : undefined

  let canonical
  for (const m of text.matchAll(/<(meta|link)\b([^>]*)>/gi)) {
    const attrs = parseAttrs(m[2])
    if (m[1].toLowerCase() === 'link') {
      // rel is a space-separated token list; `rel="canonical alternate"` counts.
      const rels = (attrs.rel ?? '').toLowerCase().split(/\s+/)
      if (rels.includes('canonical') && canonical === undefined) canonical = attrs.href
      continue
    }
    // Correct markup uses property=; several generators emit name=. Read both,
    // because a tag we failed to see reads as "beta dropped it", which is worse
    // than reading one we should have ignored.
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase()
    if (key.startsWith('og:') && !(key in og)) og[key] = attrs.content ?? ''
  }

  return { title, canonical, og }
}

function headerOf(headers, name) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === name)
  return hit === undefined ? undefined : headers[hit]
}

/**
 * One side of one route: the fields classify() compares, pulled off a response.
 *
 * The body is parsed for metadata ONLY when the response says it is HTML.
 * Otherwise `/robots.txt` and `/sitemap.xml` would be reported as having no
 * title on both sides — true, meaningless, and noise in a table whose whole job
 * is to make a real difference visible.
 */
export function observe({ origin, status, headers, body }) {
  const contentType = headerOf(headers, 'content-type')
  const isHtml = (contentType ?? '').toLowerCase().includes('text/html')
  const { title, canonical, og } = isHtml ? extractMeta(body) : { title: undefined, canonical: undefined, og: {} }

  const relativeOg = {}
  for (const [k, v] of Object.entries(og)) relativeOg[k] = relativize(v, origin)

  return {
    status,
    location: relativize(headerOf(headers, 'location'), origin),
    cacheControl: headerOf(headers, 'cache-control'),
    contentType,
    title,
    canonical: relativize(canonical, origin),
    og: relativeOg,
  }
}

/** Cache-Control is an unordered directive list, so it compares as a set. */
const normalizeCacheControl = (v) =>
  v === undefined
    ? undefined
    : v
        .toLowerCase()
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean)
        .sort()
        .join(', ')

/** `text/html; charset=utf-8` and `text/html;charset=UTF-8` are the same thing. */
const normalizeContentType = (v) => (v === undefined ? undefined : v.toLowerCase().replace(/\s*;\s*/g, ';').trim())

const NORMALIZE = { cacheControl: normalizeCacheControl, contentType: normalizeContentType }

const same = (field, a, b) => {
  const n = NORMALIZE[field] ?? ((x) => x)
  return n(a) === n(b)
}

/**
 * A route that is not there.
 *
 * 404 and 410 only. A 500 is NOT absence — it is a route that exists and is
 * broken, and folding it into "missing" would let a beta outage read as a known
 * gap. It falls through to the field comparison and shows up loudly as a status
 * difference.
 */
const absent = (side) => side.status === 404 || side.status === 410

export function classify({ path, prod = {}, beta = {}, expectAbsentOnBeta = false }) {
  const base = { path, prod, beta }

  if (prod.error || beta.error) {
    return { ...base, verdict: 'error', fields: ['status'] }
  }

  const prodGone = absent(prod)
  const betaGone = absent(beta)

  // expectAbsentOnBeta ONLY converts a CONFIRMED absence into an expected
  // divergence. If beta turns out to serve the route after all, the flag does
  // nothing and the comparison runs as normal — an expectation that fires on the
  // opposite observation is how a real finding gets filed under "known, ignore".
  if (!prodGone && betaGone) {
    return { ...base, verdict: expectAbsentOnBeta ? 'expected' : 'missing-on-beta', fields: ['status'] }
  }
  if (prodGone && !betaGone) {
    return { ...base, verdict: 'missing-on-prod', fields: ['status'] }
  }

  const fields = SCALAR_FIELDS.filter((f) => !same(f, prod[f], beta[f]))

  // Over the UNION of both sides' og keys. Iterating prod's alone would be blind
  // to a tag beta invented; iterating the intersection would be blind to one
  // beta dropped.
  const ogKeys = [...new Set([...Object.keys(prod.og ?? {}), ...Object.keys(beta.og ?? {})])].sort()
  for (const k of ogKeys) {
    if ((prod.og ?? {})[k] !== (beta.og ?? {})[k]) fields.push(k)
  }

  return { ...base, verdict: fields.length === 0 ? 'match' : 'differs', fields }
}

const cell = (v) => (v === undefined || v === null || v === '' ? '—' : String(v).replace(/\|/g, '\\|'))

const VERDICT_ORDER = ['error', 'missing-on-beta', 'missing-on-prod', 'differs', 'expected', 'match']

/**
 * The report: a summary row per route, then a value-by-value breakdown of every
 * route that is not a clean match.
 *
 * The breakdown exists because the summary alone is not actionable — "differs on
 * cacheControl" does not tell you which direction, and Task 17 pastes this table
 * into the checklist rather than re-running the script.
 */
export function formatTable(rows) {
  const counts = new Map()
  for (const r of rows) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1)
  const summaryLine = VERDICT_ORDER.filter((v) => counts.has(v))
    .map((v) => `${counts.get(v)} ${v}`)
    .join(', ')

  const sideStatus = (s) => (s.error ? `ERR ${s.error}` : cell(s.status))

  const out = [
    `${rows.length} routes: ${summaryLine}`,
    '',
    '| Path | Prod | Beta | Verdict | Differs on |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${cell(r.path)} | ${sideStatus(r.prod)} | ${sideStatus(r.beta)} | ${cell(r.verdict)} | ${
          r.fields.length ? r.fields.map((f) => cell(f)).join(', ') : '—'
        } |`,
    ),
    '',
  ]

  const interesting = rows.filter((r) => r.verdict !== 'match')
  if (interesting.length) {
    out.push('| Path | Field | Prod | Beta |', '| --- | --- | --- | --- |')
    for (const r of interesting) {
      for (const f of r.fields) {
        const read = (side) => (f.startsWith('og:') ? (side.og ?? {})[f] : side[f])
        out.push(`| ${cell(r.path)} | ${cell(f)} | ${cell(read(r.prod))} | ${cell(read(r.beta))} |`)
      }
    }
    out.push('')
  }

  return out.join('\n')
}
