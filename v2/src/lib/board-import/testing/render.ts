import { createBitmap, cropBitmap, fillRect, strokeRect } from '../bitmap.ts'
import type { Bitmap, Rect, Rgb } from '../bitmap.ts'
import type { Mark } from '../types.ts'

/**
 * A Wordle board drawn into a Bitmap with no canvas, no font and no browser.
 *
 * WHY SYNTHESIS IS ALLOWED HERE WHEN THE SPIKE REFUSED IT. The spike was
 * measuring whether the approach works on REAL input; a hit rate against images
 * we rendered would have measured our own renderer and produced a GO with
 * nothing behind it. This file exists for the other job — REGRESSION TESTING
 * GEOMETRY AND COLOUR, where we generate the ground truth and are therefore
 * entitled to assert an exact round-trip.
 *
 * THE LINE IS DRAWN AT STAGE 3, and that is why there are no letters here.
 * Templates derived from a font, tested against renders of the same font,
 * measure nothing at all — so glyph accuracy is measured on the real 25-image
 * corpus by a hand-run script, never here. Tiles are solid; Task 4 owns glyphs.
 *
 * Everything is deterministic, noise included, so a failure is reproducible
 * from the options alone.
 */

export type ThemeName = 'light' | 'dark' | 'high-contrast'

/**
 * Named for what each colour MEANS, never for the colour itself — the same
 * reason `Mark` is. High contrast paints `correct` orange and `present` blue,
 * so a field called `green` would be a lie on a real player's screenshot.
 */
export type Palette = {
  readonly background: Rgb
  readonly emptyFill: Rgb
  readonly emptyBorder: Rgb
  readonly absent: Rgb
  readonly present: Rgb
  readonly correct: Rgb
}

/**
 * NYT's three palettes, as sampled from the shipped game.
 *
 * HARDCODED HERE AND NOWHERE ELSE. Stage 2 classifies by RELATION — cluster the
 * observed colours, take the unsaturated cluster as `absent`, try both mappings
 * for the rest — precisely so that it never needs this table and does not break
 * when NYT re-tints. A palette in the renderer is ground truth for a test; a
 * palette in the classifier is a bug waiting for a redesign.
 */
export const THEMES: Readonly<Record<ThemeName, Palette>> = Object.freeze({
  light: {
    background: [255, 255, 255],
    emptyFill: [255, 255, 255],
    emptyBorder: [211, 214, 218],
    absent: [120, 124, 126],
    present: [201, 180, 88],
    correct: [106, 170, 100],
  },
  dark: {
    background: [18, 18, 19],
    emptyFill: [18, 18, 19],
    emptyBorder: [58, 58, 60],
    absent: [58, 58, 60],
    present: [181, 159, 59],
    correct: [83, 141, 78],
  },
  'high-contrast': {
    background: [18, 18, 19],
    emptyFill: [18, 18, 19],
    emptyBorder: [58, 58, 60],
    absent: [58, 58, 60],
    present: [133, 192, 249],
    correct: [245, 121, 58],
  },
})

/** One tile of the board. `null` is an unplayed tile: ground, plus a border. */
export type TileSpec = Mark | null

export type RenderOptions = {
  /** Row-major marks. Defaults to an unplayed 6x5 board — the cleanest lattice there is. */
  readonly rows?: ReadonlyArray<ReadonlyArray<TileSpec>>
  readonly theme?: ThemeName
  readonly tileSize?: number
  readonly gap?: number
  /** Top-left of the board within the image. Defaults to centring it under any status bar. */
  readonly origin?: { readonly x: number; readonly y: number }
  /** Image size before cropping. Defaults to the board plus a margin of one tile all round. */
  readonly canvas?: { readonly width: number; readonly height: number }
  /** Unplayed-tile border thickness. Defaults to NYT's 2px at a 62px tile, scaled. */
  readonly borderWidth?: number
  /** A band across the top, standing in for a phone's status bar. */
  readonly statusBar?: { readonly height: number; readonly colour?: Rgb }
  /** Taken LAST, so a box cutting through the outer columns severs real tiles. */
  readonly crop?: Rect
  /** Additive per-channel noise, +/- this many levels. */
  readonly noise?: number
  readonly seed?: number
}

export type RenderedBoard = {
  readonly bitmap: Bitmap
  /**
   * Where every tile ended up, IN THE RETURNED BITMAP'S COORDINATE SPACE. A
   * severed crop leaves outer tiles partly or wholly outside it, with negative
   * or past-the-edge coordinates — which is the ground truth Task 2 needs, and
   * would be lost if these were reported in uncropped space.
   */
  readonly tiles: ReadonlyArray<ReadonlyArray<Rect>>
  readonly palette: Palette
  /** What the caller actually got after the defaults were applied. */
  readonly layout: {
    readonly rows: number
    readonly columns: number
    readonly tileSize: number
    readonly gap: number
    readonly origin: { readonly x: number; readonly y: number }
  }
}

const DEFAULT_ROWS = 6
const DEFAULT_COLUMNS = 5
const DEFAULT_TILE = 62

/**
 * mulberry32. Thirty-two bits of state and no dependency, which is all noise
 * needs — the point is only that a failing case is reproducible from its seed.
 */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function unplayedGrid(rows: number, columns: number): Array<Array<TileSpec>> {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => null))
}

function colourFor(spec: TileSpec, palette: Palette): Rgb {
  switch (spec) {
    case 'absent':
      return palette.absent
    case 'present':
      return palette.present
    case 'correct':
      return palette.correct
    case null:
      return palette.emptyFill
  }
}

export function renderBoard(options: RenderOptions = {}): RenderedBoard {
  const grid = options.rows ?? unplayedGrid(DEFAULT_ROWS, DEFAULT_COLUMNS)
  if (grid.length === 0) throw new Error('a board needs at least one row')
  const columns = grid[0].length
  if (columns === 0) throw new Error('a row needs at least one tile')
  if (grid.some((row) => row.length !== columns)) throw new Error('every row must be the same width')

  const palette = THEMES[options.theme ?? 'light']
  const tileSize = options.tileSize ?? DEFAULT_TILE
  const gap = options.gap ?? Math.max(1, Math.round(tileSize / 12))
  const borderWidth = options.borderWidth ?? Math.max(1, Math.round(tileSize / 31))
  const statusBarHeight = options.statusBar?.height ?? 0

  const boardWidth = columns * tileSize + (columns - 1) * gap
  const boardHeight = grid.length * tileSize + (grid.length - 1) * gap
  const canvas = options.canvas ?? {
    width: boardWidth + tileSize * 2,
    height: boardHeight + tileSize * 2 + statusBarHeight,
  }
  const origin = options.origin ?? {
    x: Math.round((canvas.width - boardWidth) / 2),
    y: statusBarHeight + Math.round((canvas.height - statusBarHeight - boardHeight) / 2),
  }

  const full = createBitmap(canvas.width, canvas.height, palette.background)

  if (options.statusBar !== undefined && statusBarHeight > 0) {
    // A DIFFERENT COLOUR FROM THE GROUND, or the band would be indistinguishable
    // from the page and would not stand in for anything. Dark on light and light
    // on dark, which is what a real status bar does.
    const fallback: Rgb = palette.background[0] > 127 ? [0, 0, 0] : [235, 235, 235]
    fillRect(full, { x: 0, y: 0, width: canvas.width, height: statusBarHeight }, options.statusBar.colour ?? fallback)
  }

  const tiles: Array<Array<Rect>> = []
  for (let row = 0; row < grid.length; row++) {
    const rects: Array<Rect> = []
    for (let column = 0; column < columns; column++) {
      const rect: Rect = {
        x: origin.x + column * (tileSize + gap),
        y: origin.y + row * (tileSize + gap),
        width: tileSize,
        height: tileSize,
      }
      const spec = grid[row][column]
      fillRect(full, rect, colourFor(spec, palette))
      // The unplayed tile's border is not decoration: it is the ONLY edge an
      // empty tile has against an identically coloured ground, and the spike
      // measured empty rows as the strongest lattice in the image because of it.
      if (spec === null) strokeRect(full, rect, palette.emptyBorder, borderWidth)
      rects.push(rect)
    }
    tiles.push(rects)
  }

  const crop = options.crop
  const bitmap = crop === undefined ? full : cropBitmap(full, crop)
  const shifted =
    crop === undefined
      ? tiles
      : tiles.map((row) => row.map((rect) => ({ ...rect, x: rect.x - crop.x, y: rect.y - crop.y })))

  // AFTER the crop, so cropping a noisy render and rendering a crop noisily are
  // not silently different images.
  if (options.noise !== undefined && options.noise > 0) {
    const next = random(options.seed ?? 1)
    const amplitude = options.noise
    for (let i = 0; i < bitmap.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        // Uint8ClampedArray clamps and rounds on assignment, so 0..255 is free.
        bitmap.data[i + channel] = bitmap.data[i + channel] + (next() * 2 - 1) * amplitude
      }
    }
  }

  return {
    bitmap,
    tiles: shifted,
    palette,
    layout: { rows: grid.length, columns, tileSize, gap, origin },
  }
}

/** The centre of a tile, which is the pixel a colour assertion should sample. */
export function centreOf(rect: Rect): { x: number; y: number } {
  return { x: Math.floor(rect.x + rect.width / 2), y: Math.floor(rect.y + rect.height / 2) }
}
