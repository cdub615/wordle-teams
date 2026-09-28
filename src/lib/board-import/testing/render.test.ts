import { describe, expect, it } from 'vitest'
import { pixelAt } from '../bitmap.ts'
import type { Bitmap, Rect } from '../bitmap.ts'
import type { Mark } from '../types.ts'
import { THEMES, centreOf, renderBoard } from './render.ts'
import type { ThemeName, TileSpec } from './render.ts'

const THEME_NAMES: Array<ThemeName> = ['light', 'dark', 'high-contrast']
const SCALES = [24, 62, 120]

const rgb = (bitmap: Bitmap, x: number, y: number) => pixelAt(bitmap, x, y).slice(0, 3)

const marks = (...row: Array<Mark>): Array<TileSpec> => row

/** A plausible three-guess board: two misses, then the answer. */
const PLAYED: Array<Array<TileSpec>> = [
  marks('absent', 'present', 'absent', 'absent', 'correct'),
  marks('absent', 'correct', 'present', 'absent', 'correct'),
  marks('correct', 'correct', 'correct', 'correct', 'correct'),
  [null, null, null, null, null],
  [null, null, null, null, null],
  [null, null, null, null, null],
]

describe('renderBoard geometry and colour', () => {
  // THE ROUND TRIP the task is defined by: every tile of a 6x5 board reads back
  // the colour it was asked for, at three scales and in all three themes.
  for (const theme of THEME_NAMES) {
    for (const tileSize of SCALES) {
      it(`round-trips a 6x5 board in ${theme} at ${tileSize}px`, () => {
        const { bitmap, tiles, palette } = renderBoard({ rows: PLAYED, theme, tileSize })

        for (let row = 0; row < PLAYED.length; row++) {
          for (let column = 0; column < 5; column++) {
            const spec = PLAYED[row][column]
            const { x, y } = centreOf(tiles[row][column])
            const expected =
              spec === null
                ? palette.emptyFill
                : spec === 'absent'
                  ? palette.absent
                  : spec === 'present'
                    ? palette.present
                    : palette.correct
            expect(rgb(bitmap, x, y), `tile ${row},${column}`).toEqual([...expected])
          }
        }
      })
    }
  }

  it('defaults to an unplayed 6x5 board and leaves ground around it', () => {
    const { bitmap, tiles, layout, palette } = renderBoard()
    expect([layout.rows, layout.columns]).toEqual([6, 5])
    expect(tiles).toHaveLength(6)
    expect(tiles[0]).toHaveLength(5)
    expect(rgb(bitmap, 1, 1)).toEqual([...palette.background])
  })

  // Empty tiles are ground-coloured, so the BORDER is their only edge — and the
  // spike measured an unplayed row as the strongest lattice in the whole image
  // precisely because of it. A renderer that dropped it would make Stage 1 look
  // better than it is.
  it('gives an unplayed tile a border against an identical ground', () => {
    const { bitmap, tiles, palette } = renderBoard({ theme: 'dark', tileSize: 62 })
    const tile = tiles[0][0]
    const middle = centreOf(tile)
    expect(rgb(bitmap, tile.x + 1, tile.y + 1)).toEqual([...palette.emptyBorder])
    expect(rgb(bitmap, middle.x, middle.y)).toEqual([...palette.emptyFill])
    expect(palette.emptyFill).toEqual(palette.background)
  })

  it('honours an explicit origin, gap and canvas', () => {
    const { bitmap, tiles, layout } = renderBoard({
      tileSize: 30,
      gap: 4,
      origin: { x: 7, y: 9 },
      canvas: { width: 400, height: 400 },
    })
    expect([bitmap.width, bitmap.height]).toEqual([400, 400])
    expect(tiles[0][0]).toEqual({ x: 7, y: 9, width: 30, height: 30 })
    expect(tiles[1][2]).toEqual({ x: 7 + 2 * 34, y: 9 + 34, width: 30, height: 30 })
    expect(layout.gap).toBe(4)
  })

  it('rejects a ragged grid rather than rendering something misleading', () => {
    expect(() => renderBoard({ rows: [[null, null], [null]] })).toThrow()
    expect(() => renderBoard({ rows: [] })).toThrow()
  })
})

describe('a status-bar band', () => {
  it('is expressible, differs from the ground, and does not touch the board', () => {
    const height = 44
    const { bitmap, tiles, palette } = renderBoard({ theme: 'light', tileSize: 40, statusBar: { height } })

    expect(rgb(bitmap, 5, 5)).not.toEqual([...palette.background])
    expect(rgb(bitmap, 5, height + 1)).toEqual([...palette.background])
    // The board is pushed clear of the band rather than drawn under it.
    expect(tiles[0][0].y).toBeGreaterThanOrEqual(height)
  })

  it('takes a colour when the caller has one in mind', () => {
    const { bitmap } = renderBoard({ tileSize: 20, statusBar: { height: 10, colour: [7, 8, 9] } })
    expect(rgb(bitmap, 0, 0)).toEqual([7, 8, 9])
  })
})

describe('a severed-column crop', () => {
  // Both of the spike's two misses were crops cutting through the first and last
  // columns. This is that input, expressed exactly: the outer tiles survive only
  // in part, and the ground truth says so instead of pretending they are whole.
  it('leaves the outer tiles partly outside the image and the interior intact', () => {
    const tileSize = 62
    const gap = 5
    const whole = renderBoard({ rows: PLAYED, tileSize, gap })
    const first = whole.tiles[0][0]
    const last = whole.tiles[0][4]
    const crop: Rect = {
      x: first.x + Math.floor(tileSize / 2),
      y: whole.tiles[0][0].y,
      width: last.x + Math.floor(tileSize / 2) - (first.x + Math.floor(tileSize / 2)),
      height: whole.tiles[5][0].y + tileSize - whole.tiles[0][0].y,
    }
    const severed = renderBoard({ rows: PLAYED, tileSize, gap, crop })

    expect([severed.bitmap.width, severed.bitmap.height]).toEqual([crop.width, crop.height])

    // Column 0 starts left of the image; column 4 runs off the right of it.
    expect(severed.tiles[0][0].x).toBeLessThan(0)
    expect(severed.tiles[0][4].x + tileSize).toBeGreaterThan(severed.bitmap.width)

    // The interior three are whole, and still the colour they were asked for.
    for (const column of [1, 2, 3]) {
      const tile = severed.tiles[0][column]
      expect(tile.x).toBeGreaterThanOrEqual(0)
      expect(tile.x + tile.width).toBeLessThanOrEqual(severed.bitmap.width)
      expect(rgb(severed.bitmap, centreOf(tile).x, centreOf(tile).y)).toEqual([
        ...(PLAYED[0][column] === 'present' ? severed.palette.present : severed.palette.absent),
      ])
    }
  })

  it('reports tile positions in the cropped image, not the uncropped one', () => {
    const whole = renderBoard({ tileSize: 30, gap: 3 })
    const crop: Rect = { x: 10, y: 12, width: 100, height: 100 }
    const cropped = renderBoard({ tileSize: 30, gap: 3, crop })
    expect(cropped.tiles[0][0].x).toBe(whole.tiles[0][0].x - crop.x)
    expect(cropped.tiles[0][0].y).toBe(whole.tiles[0][0].y - crop.y)
  })
})

describe('additive noise', () => {
  it('is off by default and reproducible from its seed', () => {
    const clean = renderBoard({ tileSize: 24 })
    const again = renderBoard({ tileSize: 24 })
    expect(again.bitmap.data).toEqual(clean.bitmap.data)

    const noisy = renderBoard({ tileSize: 24, noise: 20, seed: 7 })
    const sameSeed = renderBoard({ tileSize: 24, noise: 20, seed: 7 })
    const otherSeed = renderBoard({ tileSize: 24, noise: 20, seed: 8 })
    expect(noisy.bitmap.data).not.toEqual(clean.bitmap.data)
    expect(sameSeed.bitmap.data).toEqual(noisy.bitmap.data)
    expect(otherSeed.bitmap.data).not.toEqual(noisy.bitmap.data)
  })

  it('stays within its amplitude, so a tile is still recognisably its colour', () => {
    const amplitude = 12
    const { bitmap, tiles, palette } = renderBoard({
      rows: PLAYED,
      tileSize: 40,
      noise: amplitude,
      seed: 3,
    })
    for (const column of [0, 1, 4]) {
      const { x, y } = centreOf(tiles[0][column])
      const expected =
        PLAYED[0][column] === 'present'
          ? palette.present
          : PLAYED[0][column] === 'correct'
            ? palette.correct
            : palette.absent
      const actual = rgb(bitmap, x, y)
      for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(amplitude + 1)
      }
    }
  })

  it('leaves alpha alone', () => {
    const { bitmap } = renderBoard({ tileSize: 16, noise: 40, seed: 2 })
    for (let i = 3; i < bitmap.data.length; i += 4) expect(bitmap.data[i]).toBe(255)
  })
})

describe('THEMES', () => {
  it('names colours by meaning, and high contrast is the case that proves why', () => {
    // 'correct' is orange and 'present' is blue here. Anything that assumed
    // green would be wrong on a real player's screenshot.
    expect(THEMES['high-contrast'].correct).not.toEqual(THEMES.light.correct)
    expect(THEMES['high-contrast'].present).not.toEqual(THEMES.dark.present)
  })

  it('keeps absent unsaturated in every theme, which is what Stage 2 leans on', () => {
    for (const theme of THEME_NAMES) {
      const [r, g, b] = THEMES[theme].absent
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(20)
    }
  })
})
