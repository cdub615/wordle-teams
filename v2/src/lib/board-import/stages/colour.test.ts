import { describe, expect, it } from 'vitest'
import colourSource from './colour.ts?raw'
import { createBitmap, fillRect } from '../bitmap.ts'
import type { Rect } from '../bitmap.ts'
import type { Mark } from '../types.ts'
import { renderBoard } from '../testing/render.ts'
import type { ThemeName, TileSpec } from '../testing/render.ts'
import { detectLattice } from './lattice.ts'
import { classifyColours } from './colour.ts'

const THEME_NAMES: Array<ThemeName> = ['light', 'dark', 'high-contrast']
const marks = (...row: Array<Mark>): Array<TileSpec> => row
const EMPTY: Array<TileSpec> = [null, null, null, null, null]

const GUESSES: Array<Array<Mark>> = [
  ['absent', 'present', 'absent', 'absent', 'correct'],
  ['absent', 'correct', 'present', 'absent', 'correct'],
  ['correct', 'correct', 'correct', 'correct', 'correct'],
]
const PLAYED: Array<Array<TileSpec>> = [...GUESSES, EMPTY, EMPTY, EMPTY]

function classify(options: Parameters<typeof renderBoard>[0]) {
  const board = renderBoard(options)
  const lattice = detectLattice(board.bitmap)
  expect(lattice.ok).toBe(true)
  if (!lattice.ok) throw new Error('no lattice')
  return classifyColours(board.bitmap, lattice.lattice)
}

describe('classifyColours', () => {
  // THE POINT OF THE STAGE. High contrast paints 'correct' orange and
  // 'present' blue; a module that knew green and yellow would mislabel every
  // tile on such a board and come back confidently wrong rather than crashing.
  for (const theme of THEME_NAMES) {
    it(`reads the marks on a ${theme} board`, () => {
      const result = classify({ rows: PLAYED, theme, tileSize: 62 })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.rows).toEqual([0, 1, 2])
      expect(result.readings).toContainEqual(GUESSES)
    })
  }

  it('reads the marks at three scales', () => {
    for (const tileSize of [24, 62, 120]) {
      const result = classify({ rows: PLAYED, theme: 'dark', tileSize })
      expect(result.ok, `tile ${tileSize}`).toBe(true)
      if (result.ok) expect(result.readings, `tile ${tileSize}`).toContainEqual(GUESSES)
    }
  })

  // The solved board's last row is all one colour, and that colour can only be
  // 'correct'. Stage 4 would work it out anyway; this just saves it a pass.
  it('offers the reading a solved board implies first', () => {
    const result = classify({ rows: PLAYED, theme: 'light', tileSize: 62 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.readings[0]).toEqual(GUESSES)
  })

  it('returns both mappings, because colour alone cannot settle them', () => {
    const result = classify({ rows: PLAYED, theme: 'light', tileSize: 62 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.readings).toHaveLength(2)
    // The second reading is the first with present and correct exchanged.
    const swapped = result.readings[0].map((row) =>
      row.map((mark) => (mark === 'present' ? 'correct' : mark === 'correct' ? 'present' : mark)),
    )
    expect(result.readings[1]).toEqual(swapped)
  })

  // THE DARK-MODE CASE THAT NEEDS THE PAGE COLOUR. An unplayed tile is
  // near-black and an 'absent' tile is a slightly lighter near-black; nothing
  // but the page behind them tells the two apart.
  it('keeps unplayed rows out of the reading, in dark mode where it is hardest', () => {
    const result = classify({
      rows: [marks('absent', 'absent', 'absent', 'absent', 'absent'), EMPTY, EMPTY, EMPTY, EMPTY, EMPTY],
      theme: 'dark',
      tileSize: 62,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual([0])
    expect(result.readings[0]).toEqual([['absent', 'absent', 'absent', 'absent', 'absent']])
  })

  it('says so when no row has been played at all', () => {
    expect(classify({ theme: 'light', tileSize: 62 })).toEqual({ ok: false, reason: 'no-played-rows' })
  })

  it('reads a board with no colour on it at all', () => {
    const allAbsent: Array<Mark> = ['absent', 'absent', 'absent', 'absent', 'absent']
    const result = classify({ rows: [allAbsent, allAbsent, EMPTY, EMPTY, EMPTY, EMPTY], tileSize: 62 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.readings).toHaveLength(1)
    expect(result.readings[0]).toEqual([allAbsent, allAbsent])
  })

  it('survives noise', () => {
    const result = classify({ rows: PLAYED, theme: 'high-contrast', tileSize: 62, noise: 6, seed: 4 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.readings).toContainEqual(GUESSES)
  })

  it('reads a board severed through its outer columns', () => {
    const tileSize = 62
    const whole = renderBoard({ rows: PLAYED, tileSize, gap: 5 })
    const crop: Rect = {
      x: whole.tiles[0][0].x + 31,
      y: whole.tiles[0][0].y,
      width: whole.tiles[0][4].x + 31 - (whole.tiles[0][0].x + 31),
      height: whole.tiles[5][0].y + tileSize - whole.tiles[0][0].y,
    }
    const result = classify({ rows: PLAYED, tileSize, gap: 5, crop })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.readings).toContainEqual(GUESSES)
  })

  // MEASURED ON THE REAL CORPUS. One screenshot has a tile that comes out 60%
  // white on a dark board — not a third mark, Wordle has only three, but
  // something the image did that we do not understand. Refusing the whole board
  // for it would have cost five good rows.
  it('loses the row an unexplainable tile is in, not the board', () => {
    const board = renderBoard({ rows: PLAYED, theme: 'dark', tileSize: 62 })
    const odd = board.tiles[1][2]
    fillRect(board.bitmap, odd, [248, 248, 248])

    const lattice = detectLattice(board.bitmap)
    expect(lattice.ok).toBe(true)
    if (!lattice.ok) return
    const result = classifyColours(board.bitmap, lattice.lattice)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.unreadable).toEqual([1])
    expect(result.rows).toEqual([0, 2])
    expect(result.readings).toContainEqual([GUESSES[0], GUESSES[2]])
  })

  it('refuses rather than choosing two of three colours', () => {
    // Three chromatic fills in one row is not a Wordle board, whatever it is.
    const bitmap = createBitmap(400, 200, [255, 255, 255])
    const fills: Array<[number, number, number]> = [
      [200, 60, 60],
      [60, 200, 60],
      [60, 60, 200],
      [200, 200, 60],
      [60, 200, 200],
    ]
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 5; column++) {
        fillRect(bitmap, { x: 20 + column * 70, y: 20 + row * 70, width: 62, height: 62 }, fills[column])
      }
    }
    const lattice = detectLattice(bitmap)
    expect(lattice.ok).toBe(true)
    if (!lattice.ok) return
    expect(classifyColours(bitmap, lattice.lattice)).toEqual({ ok: false, reason: 'too-many-colours' })
  })
})

describe('the no-palette rule', () => {
  // THE CONSTRAINT IS THE FEATURE, so it is asserted rather than remembered.
  // A hex literal here would mean the stage had started recognising NYT's
  // particular colours, which silently mislabels a high-contrast board.
  it('has no colour literal anywhere in the module', () => {
    // Guards the guard: a ?raw import that resolved to nothing would pass
    // every assertion below without reading a line of the module.
    expect(colourSource).toContain('export function classifyColours')
    expect(colourSource.length).toBeGreaterThan(4000)
    expect(colourSource).not.toMatch(/#[0-9a-f]{6}/i)
    expect(colourSource).not.toMatch(/#[0-9a-f]{3}\b/i)
    expect(colourSource).not.toMatch(/\brgba?\s*\(/i)
  })
})
