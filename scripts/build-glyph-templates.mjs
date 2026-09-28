/**
 * Generates src/lib/board-import/data/glyph-templates.json — the 26 letter
 * shapes Stage 3 matches a tile against.
 *
 * RUN ON DEMAND, OUTPUT COMMITTED, AND DELIBERATELY NOT PART OF `pnpm build`.
 * Same shape as scripts/build-splash-screens.mjs and scripts/fetch-wordlists.mjs:
 * the artifact is checked in, so a normal build neither needs a browser nor
 * touches the network. This script needs both, which is exactly why it is not
 * in the build.
 *
 *   pnpm exec node scripts/build-glyph-templates.mjs
 *
 * WHY A BROWSER. There is no canvas in Node and no font rasteriser in this
 * repo's dependencies. Chromium is already here for e2e and already renders
 * webfonts for the splash screens, so this costs nothing new — and rasterising
 * in a real text engine is what makes the templates look like text rather than
 * like an approximation of it.
 *
 * WHY THREE FONTS, AND WHY NOT NYT'S. Wordle sets its tiles in nyt-franklin,
 * which is licensed and not ours to ship. Libre Franklin is the same design
 * lineage and is the primary; Inter and Archivo are carried alongside it
 * because a letter is scored against the BEST of the three, so a shape one
 * grotesque draws unusually is covered by the others. This costs nothing at
 * read time beyond two more dot products per letter.
 *
 * WHY THE NORMALISATION IS IMPORTED RATHER THAN REIMPLEMENTED. Templates
 * normalised one way and tiles normalised another still produce plausible
 * scores — every reading simply comes out wrong. src/lib/board-import/stages/
 * glyph-shape.ts is the single implementation and both halves import it.
 *
 * WHAT THIS DOES NOT DO: prove that Stage 3 is accurate. Templates derived from
 * a font and tested against renders of the same font measure nothing at all.
 * The accuracy number comes from scripts/validate-board-import.mjs against the
 * real screenshot corpus, and from nowhere else.
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'src', 'lib', 'board-import', 'data', 'glyph-templates.json')

const { TEMPLATE_WIDTH, TEMPLATE_HEIGHT, TEMPLATE_SIZE, normaliseGlyph, similarity } = await import(
  path.join(here, '..', 'src', 'lib', 'board-import', 'stages', 'glyph-shape.ts')
)

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** Primary first. The order is not load-bearing; the reader takes the best. */
const FONTS = [
  { family: 'Libre Franklin', weight: 700 },
  { family: 'Inter', weight: 700 },
  { family: 'Archivo', weight: 700 },
]

/** Big enough that the 20px template is always a downsample. */
const RENDER_SIZE = 160

/**
 * Every way this can fail is silent, so each one is asserted:
 *
 *   1. a font that never loaded  -> Chromium falls back to a system face and
 *                                   the templates are quietly the wrong shapes.
 *   2. a blank template          -> the letter was never drawn. Scores against
 *                                   it are zero and that letter is unreadable.
 *   3. two identical templates   -> the normalisation collapsed something, and
 *                                   the two letters can never be told apart.
 *   4. a missing letter          -> a word containing it can never be read.
 */
export function assertTemplateBuild({ letters, fontsLoaded, templates }) {
  const problems = []

  for (const [family, loaded] of Object.entries(fontsLoaded)) {
    if (!loaded) {
      problems.push(
        `the ${family} webfont never loaded, so its glyphs were rendered in a fallback face. ` +
          `The templates would be the wrong shapes and nothing downstream could tell.`,
      )
    }
  }

  const missing = LETTERS.filter((letter) => !letters.includes(letter))
  if (missing.length > 0) problems.push(`no template for ${missing.join(', ')}`)

  for (const [key, values] of Object.entries(templates)) {
    if (values.length !== TEMPLATE_SIZE) {
      problems.push(`${key} has ${values.length} cells, expected ${TEMPLATE_SIZE}`)
      continue
    }
    if (values.every((value) => value === 0)) problems.push(`${key} is blank — the letter was never drawn`)
  }

  const keys = Object.keys(templates)
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const [a, b] = [keys[i], keys[j]]
      if (a.split(':')[1] !== b.split(':')[1]) continue
      const score = similarity(Float32Array.from(templates[a]), Float32Array.from(templates[b]))
      if (score > 0.999) problems.push(`${a} and ${b} are indistinguishable (similarity ${score.toFixed(4)})`)
    }
  }

  return problems
}

async function main() {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  const page = await browser.newPage()

  await page.setContent('<body style="margin:0"><canvas id="c"></canvas></body>', { waitUntil: 'load' })

  const fontsLoaded = {}
  for (const font of FONTS) {
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family).replace(/%20/g, '+')}:wght@${font.weight}&display=block`
    await page.addStyleTag({ url })
    // addStyleTag resolves when the SHEET has loaded, which is not the same as
    // the face being usable. fonts.load forces it; fonts.check confirms it.
    fontsLoaded[font.family] = await page.evaluate(async (face) => {
      await document.fonts.load(face)
      await document.fonts.ready
      return document.fonts.check(face)
    }, `${font.weight} 48px "${font.family}"`)
  }

  /** Raw ink masks, straight out of the rasteriser. Normalised below, in Node. */
  const masks = await page.evaluate(
    ({ fonts, letters, size }) => {
      const canvas = document.getElementById('c')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const out = {}

      for (const font of fonts) {
        for (const letter of letters) {
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, size, size)
          ctx.fillStyle = '#fff'
          ctx.font = `${font.weight} ${Math.round(size * 0.62)}px "${font.family}"`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(letter, size / 2, size / 2)

          const { data } = ctx.getImageData(0, 0, size, size)
          const coverage = new Array(size * size)
          for (let i = 0; i < size * size; i++) coverage[i] = data[i * 4] / 255
          out[`${letter}:${font.family}`] = coverage
        }
      }
      return out
    },
    { fonts: FONTS, letters: LETTERS, size: RENDER_SIZE },
  )

  await browser.close()

  const templates = {}
  for (const [key, coverage] of Object.entries(masks)) {
    const normalised = normaliseGlyph({
      width: RENDER_SIZE,
      height: RENDER_SIZE,
      data: Float32Array.from(coverage),
    })
    if (normalised === null) {
      templates[key] = new Array(TEMPLATE_SIZE).fill(0)
      continue
    }
    // Quantised to a byte. The scores are cosines of 480-dimensional vectors;
    // a 1/255 step in a cell is far below anything that changes a reading, and
    // it keeps the committed file a third of the size.
    templates[key] = Array.from(normalised, (value) => Math.round(value * 255))
  }

  const problems = assertTemplateBuild({
    letters: LETTERS.filter((letter) => Object.keys(templates).some((key) => key.startsWith(`${letter}:`))),
    fontsLoaded,
    templates,
  })
  if (problems.length > 0) {
    console.error('[build-glyph-templates] refusing to write:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  const byLetter = {}
  for (const letter of LETTERS) {
    byLetter[letter] = FONTS.map((font) => templates[`${letter}:${font.family}`])
  }

  const document_ = {
    '//': 'GENERATED by scripts/build-glyph-templates.mjs. Do not hand-edit. Cells are 0-255 coverage, row-major, TEMPLATE_WIDTH x TEMPLATE_HEIGHT, one array per font in the order listed.',
    width: TEMPLATE_WIDTH,
    height: TEMPLATE_HEIGHT,
    fonts: FONTS.map((font) => `${font.family} ${font.weight}`),
    letters: byLetter,
  }

  await writeFile(OUT, `${JSON.stringify(document_)}\n`)
  const bytes = JSON.stringify(document_).length
  console.log(
    `[build-glyph-templates] wrote ${path.relative(path.join(here, '..'), OUT)} — ` +
      `${LETTERS.length} letters x ${FONTS.length} fonts at ${TEMPLATE_WIDTH}x${TEMPLATE_HEIGHT}, ${(bytes / 1024).toFixed(1)} kB`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
