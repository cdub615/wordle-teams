import { describe, expect, it } from 'vitest'
import { createBitmap, fillRect, setPixel } from '../bitmap.ts'
import type { Bitmap, Rect, Rgb } from '../bitmap.ts'
import templates from '../data/glyph-templates.json'
import { TEMPLATE_SIZE, largestInkBounds, normaliseGlyph, similarity, tightBounds } from './glyph-shape.ts'
import { expectedTemplateSize, readGlyph, readRow, templateGeometry } from './glyphs.ts'

/**
 * WHAT THESE TESTS ARE FOR, AND WHAT THEY ARE NOT.
 *
 * Every glyph here is painted FROM THE TEMPLATE TABLE, so nothing below says
 * anything whatsoever about whether Stage 3 can read NYT's typeface. Templates
 * derived from a font and scored against renders of the same font measure
 * exactly nothing, and the plan draws its line here on purpose.
 *
 * What they do pin is the MECHANISM: that ink is found against a tile of any
 * colour, that the normalisation survives a round trip through arbitrary tile
 * sizes, that confidences are a distribution rather than a ranking, that a
 * genuine near-tie is REPORTED as one, and that a tile with no letter on it
 * comes back empty. Stage 4 can repair a doubt it was told about; it cannot
 * repair one it never heard.
 *
 * The accuracy number lives on wordle-teams-418, measured on the real corpus.
 */

type TemplateFile = {
  width: number
  height: number
  fonts: Array<string>
  letters: Record<string, Array<Array<number>>>
}
const DATA = templates as unknown as TemplateFile

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** Paints a template into a tile, scaled to fill it the way real text does. */
function paintGlyph(bitmap: Bitmap, tile: Rect, cells: Array<number>, ink: Rgb, coverage = 0.62): void {
  const height = tile.height * coverage
  const width = height * (DATA.width / DATA.height)
  const left = tile.x + (tile.width - width) / 2
  const top = tile.y + (tile.height - height) / 2

  for (let y = 0; y < Math.round(height); y++) {
    for (let x = 0; x < Math.round(width); x++) {
      const sx = Math.min(DATA.width - 1, Math.floor((x / width) * DATA.width))
      const sy = Math.min(DATA.height - 1, Math.floor((y / height) * DATA.height))
      if (cells[sy * DATA.width + sx] > 128) setPixel(bitmap, Math.round(left + x), Math.round(top + y), ink)
    }
  }
}

function tileWith(letter: string | null, fill: Rgb, tileSize = 62, variant = 0): { bitmap: Bitmap; tile: Rect } {
  const bitmap = createBitmap(tileSize * 2, tileSize * 2, [255, 255, 255])
  const tile: Rect = { x: tileSize / 2, y: tileSize / 2, width: tileSize, height: tileSize }
  fillRect(bitmap, tile, fill)
  if (letter !== null) paintGlyph(bitmap, tile, DATA.letters[letter][variant], [255, 255, 255])
  return { bitmap, tile }
}

const GREY: Rgb = [120, 124, 126]
const GREEN: Rgb = [106, 170, 100]
const ORANGE: Rgb = [245, 121, 58]

describe('the committed template table', () => {
  it('agrees with the reader about its own geometry', () => {
    expect(templateGeometry.width * templateGeometry.height).toBe(expectedTemplateSize)
    expect(expectedTemplateSize).toBe(TEMPLATE_SIZE)
  })

  it('holds all 26 letters, in every font, and none of them blank', () => {
    expect(Object.keys(DATA.letters).sort()).toEqual(LETTERS)
    expect(DATA.fonts.length).toBeGreaterThanOrEqual(1)
    for (const letter of LETTERS) {
      expect(DATA.letters[letter]).toHaveLength(DATA.fonts.length)
      for (const variant of DATA.letters[letter]) {
        expect(variant).toHaveLength(TEMPLATE_SIZE)
        expect(Math.max(...variant)).toBeGreaterThan(200)
      }
    }
  })

  // Two letters that normalise to the same grid can never be told apart, and
  // the failure is silent: the reader just picks whichever came first.
  it('keeps every letter distinguishable from every other', () => {
    for (let i = 0; i < LETTERS.length; i++) {
      for (let j = i + 1; j < LETTERS.length; j++) {
        const a = Float32Array.from(DATA.letters[LETTERS[i]][0], (v) => v / 255)
        const b = Float32Array.from(DATA.letters[LETTERS[j]][0], (v) => v / 255)
        expect(similarity(a, b), `${LETTERS[i]} vs ${LETTERS[j]}`).toBeLessThan(0.99)
      }
    }
  })

  // Cap height is shared, so the WIDTH is what separates I from H and W from V.
  // Squashing each glyph into a square would throw exactly that away.
  it('preserves relative width, which is what a square template would lose', () => {
    const inkWidth = (letter: string) => {
      const cells = DATA.letters[letter][0]
      let min = DATA.width
      let max = -1
      for (let y = 0; y < DATA.height; y++) {
        for (let x = 0; x < DATA.width; x++) {
          if (cells[y * DATA.width + x] < 100) continue
          if (x < min) min = x
          if (x > max) max = x
        }
      }
      return max - min + 1
    }
    expect(inkWidth('I')).toBeLessThan(inkWidth('H'))
    expect(inkWidth('H')).toBeLessThan(inkWidth('W'))
  })
})

describe('readGlyph', () => {
  it('returns a distribution, not a ranking', () => {
    const { bitmap, tile } = tileWith('A', GREY)
    const scores = readGlyph(bitmap, tile)
    const total = Object.values(scores).reduce((sum, value) => sum + value, 0)

    expect(Object.keys(scores).length).toBeGreaterThan(0)
    expect(Object.keys(scores).length).toBeLessThanOrEqual(5)
    expect(total).toBeCloseTo(1, 5)
    for (const value of Object.values(scores)) expect(value).toBeGreaterThan(0)
  })

  // Mechanism only — the ink was painted from this very table. What it pins is
  // that the tile is found, the mask is taken against the tile's own colour,
  // and the normalisation round-trips.
  it('recovers the letter it was painted with, on any tile colour', () => {
    for (const fill of [GREY, GREEN, ORANGE]) {
      for (const letter of ['A', 'E', 'I', 'S', 'W', 'Q']) {
        const { bitmap, tile } = tileWith(letter, fill)
        const scores = readGlyph(bitmap, tile)
        const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
        expect(best?.[0], `${letter} on ${fill.join(',')}`).toBe(letter)
      }
    }
  })

  it('reads the same letter at any tile size', () => {
    for (const tileSize of [30, 62, 120, 186]) {
      const { bitmap, tile } = tileWith('R', GREEN, tileSize)
      const best = Object.entries(readGlyph(bitmap, tile)).sort((a, b) => b[1] - a[1])[0]
      expect(best?.[0], `tile ${tileSize}`).toBe('R')
    }
  })

  // HIGH CONTRAST, at the glyph level. The text is white on green, white on
  // grey and white on orange; the mask is taken against the tile's own median
  // so none of those needs to be known in advance.
  it('needs no idea what colour the tile is', () => {
    const odd: Rgb = [17, 99, 200]
    const { bitmap, tile } = tileWith('M', odd)
    const best = Object.entries(readGlyph(bitmap, tile)).sort((a, b) => b[1] - a[1])[0]
    expect(best?.[0]).toBe('M')
  })

  // THE HONESTY REQUIREMENT. A confident wrong letter is far more damaging than
  // an admitted doubt, because Stage 4 can repair the one and not the other.
  it('reports several letters when the ink is genuinely between two', () => {
    const { bitmap, tile } = tileWith(null, GREY)
    const blended = DATA.letters.O[0].map((value, i) => (value + DATA.letters.Q[0][i]) / 2)
    paintGlyph(bitmap, tile, blended, [255, 255, 255])

    const scores = readGlyph(bitmap, tile)
    expect(Object.keys(scores).length).toBeGreaterThan(1)
    expect(Object.keys(scores)).toEqual(expect.arrayContaining(['O', 'Q']))
  })

  it('is more confident about a clean glyph than a blended one', () => {
    const clean = readGlyph(...Object.values(tileWith('O', GREY)) as [Bitmap, Rect])
    const { bitmap, tile } = tileWith(null, GREY)
    const blended = DATA.letters.O[0].map((value, i) => (value + DATA.letters.Q[0][i]) / 2)
    paintGlyph(bitmap, tile, blended, [255, 255, 255])

    expect(clean.O).toBeGreaterThan(readGlyph(bitmap, tile).O ?? 0)
  })

  // A SHARE CARD IS A LATTICE OF COLOURED SQUARES WITH NO TEXT AT ALL. Empty
  // is the right answer, not a failure, and is how Task 5 tells that apart
  // from a board it merely misread.
  it('returns nothing for a tile with no letter on it', () => {
    const { bitmap, tile } = tileWith(null, GREEN)
    expect(readGlyph(bitmap, tile)).toEqual({})
  })

  it('returns nothing for a tile with no contrast to speak of', () => {
    const { bitmap, tile } = tileWith(null, GREY)
    // A letter painted in almost the tile's own colour is not a letter.
    paintGlyph(bitmap, tile, DATA.letters.A[0], [124, 128, 130])
    expect(readGlyph(bitmap, tile)).toEqual({})
  })

  it('returns nothing for a tile that is entirely off the image', () => {
    const bitmap = createBitmap(50, 50, GREY)
    expect(readGlyph(bitmap, { x: -200, y: 0, width: 62, height: 62 })).toEqual({})
  })
})

describe('readRow', () => {
  it('reads tiles left to right and keeps their order', () => {
    const word = ['C', 'R', 'A', 'N', 'E']
    const tileSize = 62
    const bitmap = createBitmap(tileSize * 6, tileSize * 3, [255, 255, 255])
    const tiles = word.map((_letter, i) => ({
      x: tileSize * (i + 0.5),
      y: tileSize,
      width: tileSize,
      height: tileSize,
    }))
    tiles.forEach((tile, i) => {
      fillRect(bitmap, tile, GREY)
      paintGlyph(bitmap, tile, DATA.letters[word[i]][0], [255, 255, 255])
    })

    const read = readRow(bitmap, tiles)
    expect(read).toHaveLength(5)
    expect(read.map((scores) => Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0])).toEqual(word)
  })
})

describe('largestInkBounds', () => {
  // MEASURED ON THE REAL CORPUS, and it cost a whole screenshot. Every
  // uppercase letter is one connected shape, so a second blob in the tile is
  // never part of it — but the box round ALL the ink stretches to include it,
  // and the letter is then squashed sideways and centred wrong. One stray speck
  // at the right of a tile turned a clean T into a confident F, and took every
  // row of that screenshot with it.
  it('ignores a speck that the box round all the ink would have swallowed', () => {
    const tile = tileWith('T', GREY)
    const clean = readGlyph(tile.bitmap, tile.tile)

    const speck = tileWith('T', GREY)
    const { x, y, width, height } = speck.tile
    fillRect(speck.bitmap, { x: x + width * 0.82, y: y + height * 0.45, width: 4, height: 4 }, [255, 255, 255])

    const withSpeck = readGlyph(speck.bitmap, speck.tile)
    expect(Object.entries(withSpeck).sort((a, b) => b[1] - a[1])[0][0]).toBe('T')
    expect(withSpeck.T).toBeCloseTo(clean.T, 1)
  })

  it('is eight-connected, so a diagonal join does not cut a letter in half', () => {
    // Two blocks meeting only at a corner, as the strokes of K and X do.
    const data = new Float32Array(100)
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) data[y * 10 + x] = 1
    for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) data[y * 10 + x] = 1
    expect(largestInkBounds({ width: 10, height: 10, data })).toEqual({ x: 0, y: 0, width: 6, height: 6 })
  })

  it('takes the larger of two separate shapes', () => {
    const data = new Float32Array(400)
    data[0] = 1
    for (let y = 5; y < 12; y++) for (let x = 5; x < 12; x++) data[y * 20 + x] = 1
    expect(largestInkBounds({ width: 20, height: 20, data })).toEqual({ x: 5, y: 5, width: 7, height: 7 })
  })
})

describe('normaliseGlyph', () => {
  it('finds nothing in a blank mask', () => {
    expect(normaliseGlyph({ width: 10, height: 10, data: new Float32Array(100) })).toBeNull()
    expect(tightBounds({ width: 10, height: 10, data: new Float32Array(100) })).toBeNull()
  })

  it('boxes the ink and nothing else', () => {
    const data = new Float32Array(100)
    data[3 * 10 + 2] = 1
    data[6 * 10 + 7] = 1
    expect(tightBounds({ width: 10, height: 10, data })).toEqual({ x: 2, y: 3, width: 6, height: 4 })
  })

  // The same shape at two sizes must normalise to the same grid, or a template
  // set could only ever read one screenshot scale.
  it('is scale invariant', () => {
    const box = (size: number, thickness: number) => {
      const data = new Float32Array(size * size)
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const edge = x < thickness || y < thickness || x >= size - thickness || y >= size - thickness
          data[y * size + x] = edge ? 1 : 0
        }
      }
      return { width: size, height: size, data }
    }
    const small = normaliseGlyph(box(20, 2))
    const large = normaliseGlyph(box(100, 10))
    expect(small).not.toBeNull()
    expect(large).not.toBeNull()
    if (small !== null && large !== null) expect(similarity(small, large)).toBeGreaterThan(0.97)
  })
})
