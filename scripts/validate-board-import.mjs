/**
 * Measures board import against the REAL screenshot corpus.
 *
 *   node scripts/validate-board-import.mjs            # accuracy against labels
 *   node scripts/validate-board-import.mjs --sheet    # glyph sheets, to label by hand
 *
 * RUN BY HAND. NEVER IN CI. The corpus in v2/screenshots.local/ is gitignored
 * and must stay that way — this repository is public and those are real phone
 * screenshots, carrying status bars, carriers, wallpapers and timestamps that
 * place somebody. CI has no corpus to run against and must never be given one.
 *
 * IT REPORTS NUMBERS AND WORDS. NEVER AN IMAGE. Nothing here writes a file, and
 * the only thing it prints from a screenshot is the five-letter words on the
 * board. Do not add a "save the failing crop" flag; that is how a real
 * screenshot ends up in a public git history, and history is not something you
 * can take back.
 *
 * WHY THIS EXISTS WHEN THE SUITE IS ALREADY GREEN. The CI tests run against
 * SYNTHESISED boards, which is right for geometry and colour — we generate the
 * ground truth there and are entitled to assert exact round trips. It is
 * worthless for Stage 3: templates derived from a font, scored against renders
 * of the same font, measure nothing at all. Glyph accuracy has exactly one
 * honest source and this is it.
 *
 * WHY CHROMIUM RATHER THAN A DECODER LIBRARY, which is a real decision and not
 * a convenience:
 *
 *   1. It is THE PRODUCTION PATH. adapter.ts decodes through a canvas, so
 *      measuring through the same canvas measures what players will get,
 *      including the downscale and the 8-bit normalisation of a 16-bit PNG.
 *   2. It reads JPEG. The corpus has three, and nothing in this repo's
 *      dependencies decodes one.
 *   3. NO SHARP. scripts/build-splash-screens.mjs already records why: sharp's
 *      native build breaks a clean install, which is a lived problem here and
 *      not a hypothetical. It was added and removed twice during the spike;
 *      this is the decision that stops that happening a third time. upng-js is
 *      the repo's PNG decoder and it cannot read a JPEG, so neither is enough
 *      on its own — and Chromium is already a devDependency for e2e.
 *
 * LABELS ARE HAND-WRITTEN AND LIVE WITH THE CORPUS, at
 * v2/screenshots.local/labels.json, so they are gitignored alongside the images
 * they describe. Shape:
 *
 *   { "IMG_0001.PNG": { "answer": "DRYLY", "guesses": ["SLATE", "DRYLY"] } }
 *
 * `--sheet` prints each board as ASCII glyphs so a person can read the letters
 * off and write that file. Labelling from this script's own parse would make
 * the measurement circular and the number meaningless.
 */
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const CORPUS = path.join(root, 'screenshots.local')
const LABELS = path.join(CORPUS, 'labels.json')

const IMAGE = /\.(png|jpe?g|webp)$/i
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

/**
 * The whole parser, bundled for the browser.
 *
 * esbuild rather than an import, for the same reason scripts/build-sw.mjs
 * bundles src/sw.ts: glyphs.ts imports a JSON file the way vite resolves it,
 * which plain Node refuses without an import attribute.
 */
async function bundleParser() {
  const esbuild = await import('esbuild')
  const out = await esbuild.build({
    stdin: {
      contents: `
        import { bitmapFromBlob } from './src/lib/board-import/adapter.ts'
        import { parseBoard } from './src/lib/board-import/parse.ts'
        import { detectLattice } from './src/lib/board-import/stages/lattice.ts'
        import { classifyColours } from './src/lib/board-import/stages/colour.ts'
        import { glyphMask, largestInkBounds } from './src/lib/board-import/stages/glyph-shape.ts'
        globalThis.boardImport = { bitmapFromBlob, parseBoard, detectLattice, classifyColours, glyphMask, largestInkBounds }
      `,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    write: false,
    loader: { '.json': 'json' },
  })
  return out.outputFiles[0].text
}

async function openPage() {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent('<body></body>', { waitUntil: 'load' })
  await page.addScriptTag({ content: await bundleParser() })
  return { browser, page }
}

/** The file as a data URL, which is how it reaches the page. */
async function asDataUrl(file) {
  const bytes = await readFile(file)
  const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/**
 * Parses one screenshot IN THE PAGE and returns only the result.
 *
 * The bitmap never crosses back out. Three megapixels is twelve megabytes, and
 * moving that over the devtools bridge for twenty-five images would dominate
 * the run — but more to the point, the parse belongs where the pixels are,
 * which is exactly where it runs in production.
 */
async function parseInPage(page, dataUrl, answer = null) {
  return await page.evaluate(async ({ url, answer }) => {
    const blob = await (await fetch(url)).blob()
    const started = performance.now()
    const bitmap = await globalThis.boardImport.bitmapFromBlob(blob)
    const parse = globalThis.boardImport.parseBoard(bitmap, { answer })
    return {
      ms: Math.round(performance.now() - started),
      width: bitmap.width,
      height: bitmap.height,
      outcome: parse.outcome,
      answer: parse.answer,
      guesses: parse.guesses.map((guess) => ({ row: guess.row, word: guess.word })),
      unresolved: parse.unresolved.map((row) => ({ row: row.row, letters: row.letters })),
    }
  }, { url: dataUrl, answer })
}

/** ASCII glyphs for hand-labelling. Letters only; nothing else is rendered. */
async function sheetInPage(page, dataUrl) {
  return await page.evaluate(async (url) => {
    const { bitmapFromBlob, detectLattice, classifyColours, glyphMask, largestInkBounds } = globalThis.boardImport
    const blob = await (await fetch(url)).blob()
    const bitmap = await bitmapFromBlob(blob)
    const lattice = detectLattice(bitmap)
    if (!lattice.ok) return { error: `no lattice (${lattice.reason})` }
    const colours = classifyColours(bitmap, lattice.lattice)
    if (!colours.ok) return { error: `no colours (${colours.reason})` }

    const W = 13
    const H = 9
    const rows = colours.rows.map((row, index) => {
      const cells = lattice.lattice.tiles[row].map((tile) => {
        const mask = glyphMask(bitmap, tile)
        const bounds = mask === null ? null : largestInkBounds(mask)
        return Array.from({ length: H }, (_unused, y) =>
          Array.from({ length: W }, (_u, x) => {
            if (mask === null || bounds === null) return ' '
            const sx = Math.floor(bounds.x + ((x + 0.5) * bounds.width) / W)
            const sy = Math.floor(bounds.y + ((y + 0.5) * bounds.height) / H)
            return mask.data[sy * mask.width + sx] > 0.5 ? '#' : '.'
          }).join(''),
        )
      })
      const marks = colours.readings[0][index]
        .map((mark) => (mark === 'correct' ? 'C' : mark === 'present' ? 'p' : '.'))
        .join('')
      return { row, marks, lines: Array.from({ length: H }, (_u, y) => cells.map((cell) => cell[y]).join(' | ')) }
    })
    return { rows, unreadable: colours.unreadable }
  }, dataUrl)
}

function compare(label, result) {
  const expected = label.guesses.map((word) => word.toUpperCase())
  const got = result.guesses.map((guess) => guess.word.toUpperCase())

  let rowsRight = 0
  let lettersRight = 0
  let lettersTotal = 0
  for (let i = 0; i < expected.length; i++) {
    const mine = got[i] ?? ''
    if (mine === expected[i]) rowsRight++
    for (let c = 0; c < expected[i].length; c++) {
      lettersTotal++
      if (mine[c] === expected[i][c]) lettersRight++
    }
  }

  const answerExpected = (label.answer ?? '').toUpperCase()
  return {
    rowsRight,
    rowsTotal: expected.length,
    rowsRead: got.length,
    lettersRight,
    lettersTotal,
    answerRight: answerExpected === '' ? null : (result.answer ?? '').toUpperCase() === answerExpected,
    perfect: rowsRight === expected.length && got.length === expected.length,
    expected,
    got,
  }
}

async function main() {
  const sheetMode = process.argv.includes('--sheet')

  if (!existsSync(CORPUS)) {
    console.error(`No corpus at ${path.relative(root, CORPUS)}. It is gitignored on purpose; put the real screenshots there.`)
    process.exit(1)
  }

  const files = (await readdir(CORPUS)).filter((file) => IMAGE.test(file)).sort()
  if (files.length === 0) {
    console.error(`No images in ${path.relative(root, CORPUS)}.`)
    process.exit(1)
  }

  const labels = existsSync(LABELS) ? JSON.parse(await readFile(LABELS, 'utf8')) : {}
  const { browser, page } = await openPage()

  try {
    if (sheetMode) {
      for (const file of files) {
        const sheet = await sheetInPage(page, await asDataUrl(path.join(CORPUS, file)))
        console.log(`\n### ${file}`)
        if (sheet.error !== undefined) {
          console.log(`  ${sheet.error}`)
          continue
        }
        if (sheet.unreadable.length > 0) console.log(`  unreadable rows: ${sheet.unreadable.join(', ')}`)
        for (const row of sheet.rows) {
          console.log(`row ${row.row} [${row.marks}]`)
          for (const line of row.lines) console.log(`  ${line}`)
        }
      }
      return
    }

    const totals = {
      images: 0,
      labelled: 0,
      perfect: 0,
      rowsRight: 0,
      rowsTotal: 0,
      lettersRight: 0,
      lettersTotal: 0,
      answersRight: 0,
      answersTotal: 0,
      ms: 0,
      // THE SHIPPING CONFIGURATION. The entry form asks the player for the
      // day's answer, so the blind figure above is the pessimistic one: without
      // an answer Stage 4 loses its second constraint entirely and a row is
      // carried by the word list alone. `knownAnswer` in a label is what the
      // PLAYER knows, which is not always what the crop shows.
      toldRowsRight: 0,
      toldRowsTotal: 0,
      toldPerfect: 0,
      toldImages: 0,
    }
    const unlabelled = []

    for (const file of files) {
      const result = await parseInPage(page, await asDataUrl(path.join(CORPUS, file)))
      totals.images++
      totals.ms += result.ms

      const label = labels[file]
      if (label === undefined) {
        unlabelled.push(file)
        console.log(
          `${file.padEnd(42)} ${String(result.ms).padStart(5)}ms ${result.outcome.padEnd(18)} ` +
            `${result.guesses.map((guess) => guess.word).join(' ')}   (no label)`,
        )
        continue
      }

      const score = compare(label, result)
      totals.labelled++
      totals.rowsRight += score.rowsRight
      totals.rowsTotal += score.rowsTotal
      totals.lettersRight += score.lettersRight
      totals.lettersTotal += score.lettersTotal
      if (score.perfect) totals.perfect++
      if (score.answerRight !== null) {
        totals.answersTotal++
        if (score.answerRight) totals.answersRight++
      }

      const known = (label.knownAnswer ?? label.answer ?? '').toUpperCase()
      if (known !== '') {
        const told = compare(label, await parseInPage(page, await asDataUrl(path.join(CORPUS, file)), known))
        totals.toldImages++
        totals.toldRowsRight += told.rowsRight
        totals.toldRowsTotal += told.rowsTotal
        if (told.perfect) totals.toldPerfect++
      }

      const verdict = score.perfect ? 'OK  ' : 'MISS'
      console.log(
        `${file.padEnd(42)} ${String(result.ms).padStart(5)}ms ${verdict} ` +
          `${score.rowsRight}/${score.rowsTotal} rows, ${score.lettersRight}/${score.lettersTotal} letters` +
          `${score.answerRight === false ? ', answer WRONG' : ''}`,
      )
      if (!score.perfect) {
        for (let i = 0; i < score.expected.length; i++) {
          if (score.got[i] === score.expected[i]) continue
          console.log(`${' '.repeat(44)}row ${i}: read ${score.got[i] ?? '(nothing)'}, actually ${score.expected[i]}`)
        }
      }
    }

    const pct = (part, whole) => (whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(1)}%`)
    console.log(`\n${'='.repeat(64)}`)
    console.log(`images parsed          ${totals.images}   (${Math.round(totals.ms / Math.max(1, totals.images))}ms mean)`)
    console.log(`labelled               ${totals.labelled}`)
    console.log(`boards entirely right  ${totals.perfect}/${totals.labelled}   ${pct(totals.perfect, totals.labelled)}`)
    console.log(`guesses right          ${totals.rowsRight}/${totals.rowsTotal}   ${pct(totals.rowsRight, totals.rowsTotal)}`)
    console.log(`letters right          ${totals.lettersRight}/${totals.lettersTotal}   ${pct(totals.lettersRight, totals.lettersTotal)}`)
    console.log(`answers right          ${totals.answersRight}/${totals.answersTotal}   ${pct(totals.answersRight, totals.answersTotal)}`)
    console.log(`\n--- told the answer, which is what the entry form does ---`)
    console.log(`boards entirely right  ${totals.toldPerfect}/${totals.toldImages}   ${pct(totals.toldPerfect, totals.toldImages)}`)
    console.log(`guesses right          ${totals.toldRowsRight}/${totals.toldRowsTotal}   ${pct(totals.toldRowsRight, totals.toldRowsTotal)}`)
    if (unlabelled.length > 0) {
      console.log(`\n${unlabelled.length} image(s) carry no label and are NOT in the figures above:`)
      for (const file of unlabelled) console.log(`  ${file}`)
      console.log(`Run with --sheet to read their letters off and add them to ${path.relative(root, LABELS)}.`)
    }
  } finally {
    await browser.close()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { compare }
