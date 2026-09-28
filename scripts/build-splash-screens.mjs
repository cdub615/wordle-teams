/**
 * Renders the iOS launch-screen matrix to public/splash/, from ONE template.
 *
 * RUN ON DEMAND, OUTPUT COMMITTED, AND DELIBERATELY NOT PART OF `pnpm build`.
 * Same shape as scripts/build-insights-corpus.mjs and scripts/fetch-wordlists.mjs:
 * the artifacts are checked in, so a normal build neither needs a browser nor
 * touches the network. This script needs both, which is exactly why it is not
 * in the build.
 *
 * WHY PLAYWRIGHT RATHER THAN AN SVG RASTERISER. The wordmark is CSS — a
 * gradient clipped to text in Inter — not a drawing. Rendering it in the same
 * engine the app runs in is what keeps the splash from drifting away from the
 * header it precedes; re-drawing it as SVG would mean maintaining a second copy
 * of the brand mark and having no way to notice when they diverge. Playwright is
 * already a devDependency for e2e, so this costs nothing new.
 *
 * WHY upng-js. The screenshots are a flat ground plus a small mark, and
 * Chromium only emits 24/32-bit PNG. Palette-quantising to 256 colours cuts
 * roughly 70% — measured 46.6 -> 13.8 kB on an iPhone frame and 107.2 -> 32.6 kB
 * on an iPad Pro landscape frame — and is visually lossless on this artwork,
 * checked at 1:1 on the gradient where banding would show. upng-js was chosen
 * over sharp because it is pure JS with NO INSTALL SCRIPTS AT ALL: v1's clean
 * install fails on sharp's native build, which is a lived problem, not a
 * hypothetical.
 *
 * THE MATRIX IS NOT DEFINED HERE. It lives in src/lib/splash-screens.ts,
 * because routes/__root.tsx has to emit one <link> per entry and the two must
 * never disagree — a link whose file was never generated is a query iOS matches
 * and finds nothing behind, which looks exactly like shipping no splash at all.
 * That module is TypeScript, so it is bundled with esbuild and imported, the
 * same way scripts/build-sw.mjs reaches src/sw.ts.
 *
 * THE ASSERTIONS ARE THE POINT OF THIS FILE, and there are five, because every
 * way this can fail is SILENT:
 *
 *   1. a target with no file          -> iOS matches a query, finds nothing,
 *                                        blank hold on that device only.
 *   2. wrong pixel dimensions         -> iOS ignores a startup image that does
 *                                        not match the screen exactly. A
 *                                        one-pixel error is invisible in CI and
 *                                        total in the field.
 *   3. a solid-colour file            -> the template failed to render (font,
 *                                        CSS, or the inlined SVG). Valid PNG,
 *                                        right size, no branding on it.
 *   4. a stray file no target claims  -> a renamed or removed device leaves its
 *                                        old image committed and served, so the
 *                                        directory stops describing the matrix.
 *   5. the webfont never loaded       -> Chromium falls back to system-ui and
 *                                        the wordmark is subtly the wrong
 *                                        typeface. Passes 1-4 cleanly.
 *
 * `assertSplashBuild` is pure over already-gathered facts so each of those can
 * be exercised without breaking a real build to watch the guard fire.
 * scripts/build-splash-screens.test.mjs does exactly that.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MATRIX_SRC = path.join(ROOT, 'src', 'lib', 'splash-screens.ts')
const STYLES = path.join(ROOT, 'src', 'styles.css')
const ICON = path.join(ROOT, 'public', 'wt-icon.svg')
const OUT_DIR = path.join(ROOT, 'public', 'splash')

/**
 * Inter, at the one weight the wordmark uses.
 *
 * INJECTED AS A STYLESHEET RATHER THAN @import'ed FROM THE TEMPLATE. An
 * `@import` inside an inline <style> on an about:blank document does not
 * reliably resolve, and `waitUntil: 'load'` does not wait for a webfont even
 * when it does — the first run of this script rendered every wordmark in
 * system-ui and was caught only by the fontsLoaded guard. addStyleTag resolves
 * when the sheet has loaded, and document.fonts.load() then makes the face
 * itself an awaited promise rather than a hope.
 *
 * The family and weight must stay in step with --font-sans in src/styles.css
 * and the `font-bold` the header's wordmark uses.
 */
const FONT_CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@700&display=block'
const FONT_FACE = '700 100px Inter'

/**
 * Below this many distinct colours, the render is treated as blank.
 *
 * Not 1. A genuinely failed render is a single flat colour, but a PNG of one is
 * not guaranteed to sample as exactly one value once Chromium has touched it,
 * and the real artwork samples in the dozens at minimum. Two is the smallest
 * threshold that cannot be tripped by the artwork and cannot be passed by a
 * flat fill.
 */
export const MIN_DISTINCT_COLOURS = 2

/**
 * Every problem, not just the first, so one run tells you everything that is
 * wrong. Pure on purpose: it takes facts, not a filesystem or a browser.
 *
 * @param {{ targets: Array<{file: string, pixels: {width: number, height: number}}>,
 *           produced: Array<{file: string, width: number, height: number, distinctColours: number}>,
 *           strays: string[], fontsLoaded: boolean }} facts
 * @returns {string[]} human-readable problems; empty means the build is sound
 */
export function assertSplashBuild({ targets, produced, strays, fontsLoaded }) {
  const problems = []
  const byFile = new Map(produced.map((p) => [p.file, p]))

  for (const target of targets) {
    const actual = byFile.get(target.file)

    // 1. Nothing was written for this entry.
    if (!actual) {
      problems.push(
        `${target.file} was never written. src/lib/splash-screens.ts lists it, so ` +
          `routes/__root.tsx will emit a <link> pointing at a file that does not exist — ` +
          `iOS will match that query and then find nothing, which is the blank hold again ` +
          `on exactly the devices this entry covers.`,
      )
      continue
    }

    // 2. Written, but the wrong shape.
    if (actual.width !== target.pixels.width || actual.height !== target.pixels.height) {
      problems.push(
        `${target.file} is ${actual.width}x${actual.height} but its entry requires ` +
          `${target.pixels.width}x${target.pixels.height}. iOS ignores a startup image whose ` +
          `pixels do not match the screen EXACTLY and shows nothing instead, so this is ` +
          `indistinguishable in the field from having shipped no image at all.`,
      )
    }

    // 3. Right shape, no artwork on it.
    if (actual.distinctColours < MIN_DISTINCT_COLOURS) {
      problems.push(
        `${target.file} is a solid colour — the template rendered nothing. The file is a ` +
          `valid PNG at the right size, so every other check here passes; what would ship ` +
          `is a branded launch screen with no branding on it. Suspect the inlined SVG, the ` +
          `webfont, or a CSS error in the template.`,
      )
    }
  }

  // 4. Files nothing claims.
  for (const stray of strays) {
    problems.push(
      `${stray} is in the output directory but no entry in src/lib/splash-screens.ts ` +
        `claims it. A renamed or deleted device leaves its old image behind, committed and ` +
        `served, and the directory stops being a description of the matrix.`,
    )
  }

  // 5. The typeface.
  if (!fontsLoaded) {
    problems.push(
      `the Inter webfont never loaded, so the wordmark was rendered in a fallback face. ` +
        `src/styles.css pulls Inter from Google Fonts, which means this script needs the ` +
        `network; the images would be the right size and richly coloured and still subtly ` +
        `the wrong typeface from the header they precede.`,
    )
  }

  return problems
}

/**
 * Reads a CSS custom property out of src/styles.css.
 *
 * WHY THE TOKENS ARE READ RATHER THAN RESTATED HERE. The splash ground and the
 * wordmark gradient are the app's own `--background` and `--brand-*`, and a
 * palette change that left the splash behind would be invisible until someone
 * launched the installed app and saw the old colours flash. Note the values
 * DIFFER BY THEME — `--brand-via` is #22c55e light and #86efac dark — so each
 * theme is read from its own block.
 *
 * Throws rather than defaulting: a silent fallback colour is precisely the class
 * of failure this file exists to make loud.
 *
 * SCOPED TO REAL BLOCKS, NOT TO A SPLIT ON THE TEXT `.dark`. The first version
 * did `css.split('.dark')[0]` for the light theme, and src/styles.css line 7 is
 * `@custom-variant dark (&:is(.dark *));` — a `.dark` outside any block, 160
 * lines above `:root`. That truncated the stylesheet before the tokens existed
 * and every light colour went missing. Requiring a `{` is what distinguishes a
 * selector from a mention.
 */
export function readToken(css, token, theme) {
  const selector = theme === 'dark' ? '\\.dark' : ':root'
  // Every matching block, because CSS lets a later definition win and because
  // the tokens are not guaranteed to live in the first one.
  const blocks = [...css.matchAll(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g'))].map(
    (m) => m[1],
  )
  const declaration = new RegExp(`--${token}:\\s*([^;]+);`)
  let match = null
  for (const block of blocks) {
    const found = declaration.exec(block)
    if (found) match = found
  }
  if (!match) {
    throw new Error(
      `could not read --${token} for the ${theme} theme from src/styles.css. The template ` +
        `reads the app's own tokens so the splash cannot drift from the palette; it will not ` +
        `fall back to a hardcoded colour.`,
    )
  }
  return match[1].trim()
}

/**
 * The app icon with its container disc removed.
 *
 * public/wt-icon.svg is the HOME-SCREEN icon, so it carries a #0a0a0a disc
 * behind the gradient mark. That belongs in an icon slot and not on a
 * full-screen launch image, where it reads as an icon pasted onto a page — and
 * it was consistent only BY COINCIDENCE: the disc is invisible on the dark
 * splash because it happens to equal --background, and rendered as a black
 * badge on the light one. A change to the dark --background would have faded a
 * disc into view on every dark launch screen with nothing to catch it.
 *
 * The <defs> gradient and the <use> that draws the mark are left alone; only
 * the container goes.
 */
export function bareMark(svg) {
  return svg.replace(/\s*<circle\b[^>]*\/>/g, '')
}

/** The one template. Everything visual about the splash is here. */
function template({ icon, background, from, via, to }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: ${background};
    display: grid;
    place-items: center;
    font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
  }
  .stack { display: flex; flex-direction: column; align-items: center; gap: 6vmin; }
  .stack svg { width: 22vmin; height: 22vmin; }
  .wordmark {
    font-weight: 700;
    font-size: 7vmin;
    letter-spacing: -0.02em;
    background: linear-gradient(90deg, ${from}, ${via}, ${to});
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
</style></head>
<body><div class="stack">${icon}<div class="wordmark">Wordle Teams</div></div></body></html>`
}

/** Distinct RGBA values over a subsample — enough to tell artwork from a flat fill. */
function countDistinctColours(rgba, width, height) {
  const seen = new Set()
  const pixels = width * height
  // ~20k samples regardless of size: a 2752x2064 frame is 5.7M pixels and
  // counting every one of them buys nothing this check needs.
  const step = Math.max(1, Math.floor(pixels / 20000))
  for (let i = 0; i < pixels; i += step) {
    const o = i * 4
    seen.add((rgba[o] << 24) | (rgba[o + 1] << 16) | (rgba[o + 2] << 8) | rgba[o + 3])
    if (seen.size >= 64) break
  }
  return seen.size
}

async function loadMatrix() {
  const esbuild = await import('esbuild')
  const dir = await mkdtemp(path.join(tmpdir(), 'wt-splash-'))
  const outfile = path.join(dir, 'splash-screens.mjs')
  await esbuild.build({
    entryPoints: [MATRIX_SRC],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'warning',
  })
  const mod = await import(outfile)
  await rm(dir, { recursive: true, force: true })
  return mod
}

async function main() {
  const { splashTargets } = await loadMatrix()
  const targets = splashTargets()
  const css = await readFile(STYLES, 'utf8')
  const icon = await readFile(ICON, 'utf8')

  const palette = {}
  for (const theme of ['light', 'dark']) {
    palette[theme] = {
      icon: bareMark(icon),
      background: readToken(css, 'background', theme),
      from: readToken(css, 'brand-from', theme),
      via: readToken(css, 'brand-via', theme),
      to: readToken(css, 'brand-to', theme),
    }
  }

  // A previous run's files must not survive into this one: a renamed entry
  // would otherwise leave a stale image behind that `strays` reports but that
  // nobody removed.
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })

  // FROM @playwright/test, NOT 'playwright'. Only the former is a declared
  // dependency of this package; the bare 'playwright' package is present in the
  // store as its transitive dep and resolving it from here worked by accident
  // in some layouts and not at all in this one.
  const { chromium } = await import('@playwright/test')
  const UPNG = (await import('upng-js')).default
  const browser = await chromium.launch()
  const produced = []
  let fontsLoaded = true

  try {
    for (const target of targets) {
      const page = await browser.newPage({
        viewport: { width: target.pixels.width, height: target.pixels.height },
        deviceScaleFactor: 1,
      })
      await page.setContent(template(palette[target.theme]), { waitUntil: 'load' })
      await page.addStyleTag({ url: FONT_CSS_URL })

      // The font guard. `document.fonts.load` returns the faces it actually
      // resolved, and `check` then confirms the family is available — a
      // resolved promise on its own is not evidence of that, which is the
      // mistake the first version of this made.
      const loaded = await page.evaluate(async (face) => {
        await document.fonts.load(face)
        await document.fonts.ready
        return document.fonts.check(face)
      }, FONT_FACE)
      if (!loaded) fontsLoaded = false

      const shot = await page.screenshot({ type: 'png' })
      await page.close()

      const decoded = UPNG.decode(shot)
      const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0])
      const quantised = UPNG.encode([rgba.buffer], decoded.width, decoded.height, 256)

      const outPath = path.join(ROOT, 'public', target.file.replace(/^\//, ''))
      await writeFile(outPath, Buffer.from(quantised))

      produced.push({
        file: target.file,
        width: decoded.width,
        height: decoded.height,
        distinctColours: countDistinctColours(rgba, decoded.width, decoded.height),
      })
    }
  } finally {
    await browser.close()
  }

  const claimed = new Set(targets.map((t) => path.basename(t.file)))
  const strays = existsSync(OUT_DIR)
    ? (await readdir(OUT_DIR)).filter((f) => !claimed.has(f)).map((f) => `/splash/${f}`)
    : []

  const problems = assertSplashBuild({ targets, produced, strays, fontsLoaded })

  if (problems.length > 0) {
    // Nothing shippable stays on disk, for build-sw.mjs's reason: a hand-run
    // deploy after a failed generate must not pick up half a matrix.
    await rm(OUT_DIR, { recursive: true, force: true })
    console.error('[build-splash] SPLASH BUILD FAILED:')
    for (const problem of problems) console.error(`[build-splash]   - ${problem}`)
    console.error('[build-splash]   (public/splash/ has been removed — nothing partial remains)')
    process.exitCode = 1
    return
  }

  const bytes = produced.length
  console.log(
    `[build-splash] wrote ${bytes} image${bytes === 1 ? '' : 's'} to public/splash/ ` +
      `from ${targets.length} matrix entries. Inter loaded: yes.`,
  )
}

// Only when run as a program. Importing this module (the assertion tests do)
// must not render anything.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    await rm(OUT_DIR, { recursive: true, force: true }).catch(() => {})
    console.error('[build-splash] SPLASH BUILD FAILED:')
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    process.exitCode = 1
  })
}
