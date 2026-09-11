import { describe, expect, it } from 'vitest'
import { createBitmap, fillRect } from '../bitmap.ts'
import type { Rect } from '../bitmap.ts'
import type { Mark } from '../types.ts'
import { renderBoard } from '../testing/render.ts'
import type { ThemeName, TileSpec } from '../testing/render.ts'
import { detectLattice } from './lattice.ts'

const THEME_NAMES: Array<ThemeName> = ['light', 'dark', 'high-contrast']
const SCALES = [24, 62, 120]

const marks = (...row: Array<Mark>): Array<TileSpec> => row
const EMPTY: Array<TileSpec> = [null, null, null, null, null]

const PLAYED: Array<Array<TileSpec>> = [
  marks('absent', 'present', 'absent', 'absent', 'correct'),
  marks('absent', 'correct', 'present', 'absent', 'correct'),
  marks('correct', 'correct', 'correct', 'correct', 'correct'),
  EMPTY,
  EMPTY,
  EMPTY,
]

/** Rects agree if every corner is within a pixel — the fit is sub-pixel. */
function expectTilesNear(found: ReadonlyArray<ReadonlyArray<Rect>>, truth: ReadonlyArray<ReadonlyArray<Rect>>) {
  expect(found.length).toBe(truth.length)
  for (let row = 0; row < truth.length; row++) {
    for (let column = 0; column < truth[row].length; column++) {
      const a = found[row][column]
      const b = truth[row][column]
      expect(Math.abs(a.x - b.x), `tile ${row},${column} x`).toBeLessThanOrEqual(1)
      expect(Math.abs(a.y - b.y), `tile ${row},${column} y`).toBeLessThanOrEqual(1)
      expect(Math.abs(a.width - b.width), `tile ${row},${column} width`).toBeLessThanOrEqual(1)
      expect(Math.abs(a.height - b.height), `tile ${row},${column} height`).toBeLessThanOrEqual(1)
    }
  }
}

describe('detectLattice on a whole board', () => {
  for (const theme of THEME_NAMES) {
    for (const tileSize of SCALES) {
      it(`finds a played board in ${theme} at ${tileSize}px`, () => {
        const board = renderBoard({ rows: PLAYED, theme, tileSize })
        const found = detectLattice(board.bitmap)

        expect(found.ok).toBe(true)
        if (!found.ok) return
        expect(found.lattice.columns).toBe(5)
        expect(found.lattice.rows).toBe(6)
        expectTilesNear(found.lattice.tiles, board.tiles)
      })
    }
  }

  // THE MEASURED FINDING, AS A TEST. An unplayed row yields a CLEANER lattice
  // than a filled one, because a filled tile's glyph interrupts the flat colour.
  // A detector that ranked candidates by how populated they looked would find
  // this board hardest; it is in fact the easiest.
  it('finds a board that has not been played at all', () => {
    const board = renderBoard({ theme: 'dark', tileSize: 62 })
    const found = detectLattice(board.bitmap)
    expect(found.ok).toBe(true)
    if (found.ok) expectTilesNear(found.lattice.tiles, board.tiles)
  })

  it('finds a board after a single guess', () => {
    const board = renderBoard({
      rows: [marks('absent', 'absent', 'present', 'absent', 'absent'), EMPTY, EMPTY, EMPTY, EMPTY, EMPTY],
      tileSize: 62,
    })
    const found = detectLattice(board.bitmap)
    expect(found.ok).toBe(true)
    if (found.ok) expect(found.lattice.rows).toBe(6)
  })

  // A crop down to the played rows alone. There is no vertical pitch to measure
  // from one row, so the column pitch has to carry it.
  it('finds a one-row board, where there is no row pitch to vote on', () => {
    const board = renderBoard({ rows: [marks('correct', 'correct', 'correct', 'correct', 'correct')], tileSize: 62 })
    const found = detectLattice(board.bitmap)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.lattice.rows).toBe(1)
    expectTilesNear(found.lattice.tiles, board.tiles)
  })

  it('is not distracted by a status bar', () => {
    const board = renderBoard({ rows: PLAYED, tileSize: 62, statusBar: { height: 44 } })
    const found = detectLattice(board.bitmap)
    expect(found.ok).toBe(true)
    if (found.ok) expectTilesNear(found.lattice.tiles, board.tiles)
  })

  it('survives additive noise', () => {
    const board = renderBoard({ rows: PLAYED, theme: 'dark', tileSize: 62, noise: 6, seed: 11 })
    const found = detectLattice(board.bitmap)
    expect(found.ok).toBe(true)
    if (found.ok) expectTilesNear(found.lattice.tiles, board.tiles)
  })

  it('reports a pitch wider than the tile, because Wordle leaves a gap', () => {
    const board = renderBoard({ rows: PLAYED, tileSize: 62, gap: 5 })
    const found = detectLattice(board.bitmap)
    expect(found.ok).toBe(true)
    if (found.ok) expect(found.lattice.pitch.x).toBeCloseTo(67, 0)
  })
})

describe('detectLattice on a severed crop', () => {
  /** A crop through the middle of the first and last columns. */
  function severed(rows: Array<Array<TileSpec>>, tileSize: number, gap: number) {
    const whole = renderBoard({ rows, tileSize, gap })
    const half = Math.floor(tileSize / 2)
    const left = whole.tiles[0][0].x + half
    const crop: Rect = {
      x: left,
      y: whole.tiles[0][0].y,
      width: whole.tiles[0][4].x + half - left,
      height: whole.tiles[rows.length - 1][0].y + tileSize - whole.tiles[0][0].y,
    }
    return renderBoard({ rows, tileSize, gap, crop })
  }

  // BOTH OF THE SPIKE'S TWO MISSES WERE THIS INPUT. A severed tile fails the
  // near-square filter, which is the correct call — so the lattice is fitted
  // from the interior three and extended outward on the evidence of a clipped,
  // tile-height region at the edge.
  it('recovers all five columns from the interior three', () => {
    const board = severed(PLAYED, 62, 5)
    const found = detectLattice(board.bitmap)

    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.lattice.columns).toBe(5)
    expect(found.lattice.rows).toBe(6)
    expectTilesNear(found.lattice.tiles, board.tiles)
  })

  it('keeps a severed tile at its TRUE geometry rather than shrinking it', () => {
    const board = severed(PLAYED, 62, 5)
    const found = detectLattice(board.bitmap)
    expect(found.ok).toBe(true)
    if (!found.ok) return

    // Stage 2 has to know the tile is only half there, not be handed a
    // half-sized tile it would happily sample the middle of.
    expect(found.lattice.tiles[0][0].x).toBeLessThan(0)
    expect(found.lattice.tiles[0][0].width).toBe(found.lattice.tileSize)
    expect(found.lattice.tiles[0][4].x + found.lattice.tiles[0][4].width).toBeGreaterThan(board.bitmap.width)
  })

  it('recovers a board severed on one side only', () => {
    const tileSize = 62
    const whole = renderBoard({ rows: PLAYED, tileSize, gap: 5 })
    const crop: Rect = {
      x: whole.tiles[0][0].x + 31,
      y: whole.tiles[0][0].y,
      width: whole.tiles[0][4].x + tileSize + 20 - (whole.tiles[0][0].x + 31),
      height: whole.tiles[5][0].y + tileSize - whole.tiles[0][0].y,
    }
    const board = renderBoard({ rows: PLAYED, tileSize, gap: 5, crop })
    const found = detectLattice(board.bitmap)

    expect(found.ok).toBe(true)
    if (found.ok) expectTilesNear(found.lattice.tiles, board.tiles)
  })

  it('finds a severed unplayed board, where every tile is a cut ring', () => {
    const board = severed([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY], 62, 5)
    const found = detectLattice(board.bitmap)
    expect(found.ok).toBe(true)
    if (found.ok) expect(found.lattice.columns).toBe(5)
  })

  // The margin around a fully visible board also touches the image edge and
  // also overlaps where a sixth column would be. Nothing may be extended into
  // it, which is why the evidence has to be TILE-HEIGHT and clipped rather
  // than merely present.
  it('does not invent a sixth column out of the margin beside a whole board', () => {
    const board = renderBoard({ rows: PLAYED, tileSize: 62, gap: 5 })
    const found = detectLattice(board.bitmap)
    expect(found.ok).toBe(true)
    if (found.ok) expect(found.lattice.tiles[0]).toHaveLength(5)
  })
})

describe('detectLattice rejects what is not a board', () => {
  it('rejects a blank image', () => {
    const blank = createBitmap(300, 300, [255, 255, 255])
    const found = detectLattice(blank)
    expect(found).toMatchObject({ ok: false, reason: 'no-tile-candidates' })
  })

  /** A grid of squares, `columns` wide and `rows` deep, on a plain ground. */
  function grid(columns: number, rows: number, tile: number, gap: number) {
    const bitmap = createBitmap(columns * (tile + gap) + tile, rows * (tile + gap) + tile, [255, 255, 255])
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        fillRect(
          bitmap,
          { x: tile / 2 + column * (tile + gap), y: tile / 2 + row * (tile + gap), width: tile, height: tile },
          [90, 90, 90],
        )
      }
    }
    return bitmap
  }

  // MAXIMALITY, which is the second and independent defence against the
  // on-screen keyboard. This is a stand-in for its GEOMETRY only — the claim
  // that a real keyboard is rejected is measured on the real corpus and
  // recorded on wordle-teams-gcyx, never asserted against anything rendered
  // here.
  it('rejects a ten-wide lattice instead of matching five of its columns', () => {
    const found = detectLattice(grid(10, 3, 60, 8))
    expect(found).toMatchObject({ ok: false, reason: 'not-five-columns' })
    if (!found.ok) expect(found.diagnostics.columnSpan).toBe(10)
  })

  it('rejects a lattice deeper than six rows', () => {
    const found = detectLattice(grid(5, 8, 60, 8))
    expect(found).toMatchObject({ ok: false, reason: 'too-many-rows' })
  })

  it('rejects a lattice narrower than five columns with no severed evidence', () => {
    const found = detectLattice(grid(3, 6, 60, 8))
    expect(found).toMatchObject({ ok: false, reason: 'not-five-columns' })
  })

  // THE NEAR-SQUARE FILTER, against the MEASURED geometry of a real NYT key.
  // Keys come out at 100x176 in a 3x iOS screenshot — squareness 0.57 against a
  // threshold of 0.82 — so not one of them is a tile candidate. The measurement
  // that the real keyboard is rejected is on wordle-teams-gcyx; this pins the
  // filter that does it.
  it('rejects a lattice of key-shaped rectangles', () => {
    const bitmap = createBitmap(1179, 400, [255, 255, 255])
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 10; column++) {
        fillRect(bitmap, { x: 20 + column * 115, y: 10 + row * 190, width: 100, height: 176 }, [211, 214, 218])
      }
    }
    const found = detectLattice(bitmap)
    expect(found.ok).toBe(false)
    if (!found.ok) expect(found.diagnostics.candidates).toBe(0)
  })

  it('counts what it saw even when it fails, so a miss can be diagnosed', () => {
    const found = detectLattice(grid(10, 3, 60, 8))
    expect(found.diagnostics.regions).toBeGreaterThan(0)
    expect(found.diagnostics.candidates).toBeGreaterThan(0)
  })
})
