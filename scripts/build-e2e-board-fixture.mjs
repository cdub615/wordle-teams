/**
 * Renders the board screenshot e2e/board-entry.spec.ts imports, to
 * e2e/fixtures/board-speed.png.
 *
 * RUN ON DEMAND, OUTPUT COMMITTED, NOT PART OF `pnpm build` — the same shape as
 * build-glyph-templates.mjs and fetch-wordlists.mjs.
 *
 *   pnpm exec node scripts/build-e2e-board-fixture.mjs
 *
 * THIS FIXTURE IS SYNTHESISED, AND THAT IS WHY IT CAN BE COMMITTED AT ALL. It
 * comes out of the Task 1 renderer: solid tiles and letters drawn from the
 * committed glyph templates, on a blank ground. There is no status bar, no
 * carrier, no wallpaper and no timestamp, because there was never a phone. The
 * REAL screenshot corpus stays in v2/screenshots.local/, gitignored, and must
 * never be reached for here — this repository is public and a real screenshot
 * in git history cannot be taken back.
 *
 * What it is for is the ONE THING the unit tests cannot reach: a real browser
 * decoding a real PNG through a real canvas, and the parse that follows. jsdom
 * has no rasteriser at all, so every unit test of the adapter stands in for the
 * canvas. This is the only place that path runs for real.
 *
 * It does NOT measure glyph accuracy and cannot: the letters are painted from
 * the same templates that read them. That number comes from
 * scripts/validate-board-import.mjs against the real corpus, and nowhere else.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const OUT = path.join(root, 'e2e', 'fixtures', 'board-speed.png')

/** The board the spec expects to read back, and the one it would otherwise type. */
const ANSWER = 'SPEED'
const GUESSES = ['CRANE', 'SPEED']

async function main() {
  const esbuild = await import('esbuild')
  const bundle = await esbuild.build({
    stdin: {
      contents: `export { renderPlayedBoard } from './src/lib/board-import/testing/board-fixture.ts'`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
    loader: { '.json': 'json' },
  })

  const module_ = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  )
  const board = module_.renderPlayedBoard({ answer: ANSWER, guesses: GUESSES, tileSize: 62 })

  const UPNG = require('upng-js')
  // 0 colours means lossless. upng-js rather than sharp for the reason
  // build-splash-screens.mjs records: sharp's native build breaks a clean
  // install here, which is a lived problem and not a hypothetical.
  const png = UPNG.encode([board.bitmap.data.buffer], board.bitmap.width, board.bitmap.height, 0)

  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, Buffer.from(png))
  console.log(
    `[build-e2e-board-fixture] wrote ${path.relative(root, OUT)} — ` +
      `${board.bitmap.width}x${board.bitmap.height}, ${(png.byteLength / 1024).toFixed(1)} kB, ` +
      `${ANSWER}: ${GUESSES.join(' ')}`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
