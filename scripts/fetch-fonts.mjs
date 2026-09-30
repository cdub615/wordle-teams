#!/usr/bin/env node
/**
 * Fetches Inter and Geist ONCE and writes checked-in artifacts, so that no
 * visitor's browser ever talks to Google to render this app.
 *
 * WHY THIS EXISTS (wordle-teams-c0f.6 measured it). src/styles.css used to open
 * with `@import url("https://fonts.googleapis.com/css2?...")`, and that single
 * line was the most expensive thing on the cold-start path:
 *
 *   1. AN @import IS SERIAL. It cannot begin until the stylesheet containing it
 *      has been fetched AND parsed, so first paint waited on
 *      document -> styles.css -> fonts.googleapis.com, one after another.
 *   2. IT LANDS ON A NEW ORIGIN, so that third hop pays its own DNS, TCP and
 *      TLS. Measured at 70-90ms on broadband; a new-origin handshake on
 *      cellular is typically several hundred milliseconds, and it was paid on
 *      EVERY cold launch of the installed app.
 *   3. IT IS UNCACHEABLE BY THE SERVICE WORKER. src/sw.ts precaches
 *      `assets/**\/*.{js,css}` plus offline.html — all same-origin — so a
 *      cross-origin stylesheet is out of its reach by construction.
 *
 * Self-hosting removes all three at once: the @font-face rules live in a local
 * stylesheet that vite inlines (so there is no second CSS request at all), and
 * the woff2 files come from our own already-warm origin.
 *
 * GENERATE ON DEMAND, COMMIT THE OUTPUT, KEEP THE NETWORK OUT OF `pnpm build` —
 * the same contract as scripts/fetch-wordlists.mjs and
 * scripts/build-insights-corpus.mjs.
 *
 * THE @font-face BLOCKS ARE GOOGLE'S OWN, WITH ONLY THE URLS REWRITTEN, AND
 * THAT IS DELIBERATE. Hand-writing them would mean hand-writing `unicode-range`,
 * which is what lets a browser skip downloading Cyrillic to render English —
 * and, in the other direction, what stops a player whose name is not latin from
 * rendering as tofu. Player names are user data; getting a range wrong would be
 * invisible here and visible only to the person whose name broke.
 *
 * WHY ALL SUBSETS ARE COMMITTED and not just latin (the owner's call,
 * 2026-09-09): the runtime cost is identical either way, because unicode-range
 * means a browser downloads only the subsets it actually needs. The difference
 * is purely repo weight — about 288 kB against 99.5 kB — bought in exchange for
 * a non-latin player name rendering correctly instead of falling back mid-table.
 *
 * A MODERN USER-AGENT IS REQUIRED. The Google CSS API serves woff2 only to
 * browsers it believes support it; with node's default UA it returns truetype
 * URLs and roughly four times the bytes. Asserted below rather than hoped for.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONT_DIR = path.join(ROOT, 'public', 'fonts')
const CSS_OUT = path.join(ROOT, 'src', 'fonts.css')

/**
 * The families and weights the app actually uses.
 *
 * Inter is --font-sans, used everywhere. Geist is --font-display and appears
 * ONLY on marketing routes (home, about, privacy, terms, maintenance,
 * login-error) — never on /app, which is where the installed PWA launches.
 * It is kept here anyway because self-hosting already takes it off the launch
 * path: a browser fetches a font file only when a glyph actually renders in it,
 * so Geist's woff2 is never requested on /app. Splitting it into a separate
 * stylesheet would save only its @font-face text, one or two kB brotli, in
 * exchange for a second stylesheet to reason about.
 */
const FAMILIES = 'family=Inter:wght@400;500;600;700&family=Geist:wght@400;500;600;700;800'
const CSS_URL = `https://fonts.googleapis.com/css2?${FAMILIES}&display=swap`

/** Chrome. See the header note: node's default UA gets truetype, not woff2. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function main() {
  const res = await fetch(CSS_URL, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Google Fonts CSS: HTTP ${res.status}`)
  const css = await res.text()

  const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))]

  // LOUD FAILURES, because every one of these degrades silently. A CSS that
  // fetched but contained no woff2 would produce a valid, empty stylesheet and
  // a site rendering entirely in system-ui — which looks like a design choice.
  if (urls.length === 0) {
    throw new Error(
      'the Google CSS contained no font URLs. The API shape changed, or the ' +
        'User-Agent was not accepted.',
    )
  }
  const notWoff2 = urls.filter((u) => !u.endsWith('.woff2'))
  if (notWoff2.length > 0) {
    throw new Error(
      `${notWoff2.length} of ${urls.length} font URLs are not woff2, e.g. ${notWoff2[0]}. ` +
        'The User-Agent was not recognised as woff2-capable; the files would be several ' +
        'times larger.',
    )
  }
  const faces = css.split('@font-face').length - 1
  const ranges = [...css.matchAll(/unicode-range:/g)].length
  if (faces === 0 || ranges !== faces) {
    throw new Error(
      `${faces} @font-face blocks but ${ranges} unicode-range declarations. Subsetting is ` +
        'what keeps a browser from downloading Cyrillic to render English, and what stops a ' +
        'non-latin player name rendering as tofu. Refusing to write a set without it.',
    )
  }

  // Nothing from a previous run survives: a family removed from FAMILIES above
  // must not leave its files behind, committed and served forever.
  await rm(FONT_DIR, { recursive: true, force: true })
  await mkdir(FONT_DIR, { recursive: true })

  let rewritten = css
  let bytes = 0
  for (const url of urls) {
    const file = url.split('/').pop()
    if (!/^[A-Za-z0-9_-]+\.woff2$/.test(file)) {
      throw new Error(`refusing to write an unexpected filename from ${url}`)
    }
    const font = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!font.ok) throw new Error(`${url}: HTTP ${font.status}`)
    const buf = Buffer.from(await font.arrayBuffer())
    await writeFile(path.join(FONT_DIR, file), buf)
    bytes += buf.byteLength
    rewritten = rewritten.split(url).join(`/fonts/${file}`)
  }

  if (rewritten.includes('https://fonts.g')) {
    throw new Error('a Google URL survived the rewrite — the output would still be third-party.')
  }

  const header = `/*
 * GENERATED BY scripts/fetch-fonts.mjs — DO NOT EDIT BY HAND.
 *
 * Google's own @font-face declarations with the URLs repointed at /fonts/.
 * The declarations are copied rather than written because unicode-range is what
 * makes subsetting work in both directions: it stops a browser downloading
 * Cyrillic to render English, and it stops a non-latin player name rendering as
 * tofu.
 *
 * Re-run \`pnpm fetch:fonts\` to refresh. src/fonts.test.ts asserts nothing here
 * points off-origin and that every file it names is committed.
 */
`
  await writeFile(CSS_OUT, header + rewritten)

  const files = (await readdir(FONT_DIR)).length
  console.log(
    `[fetch-fonts] wrote ${files} woff2 (${(bytes / 1024).toFixed(0)} kB) to public/fonts/ ` +
      `and ${faces} @font-face blocks to src/fonts.css. No third-party origin remains.`,
  )
}

main().catch((error) => {
  console.error('[fetch-fonts] FAILED:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
