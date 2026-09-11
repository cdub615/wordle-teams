import { medianColour, offsetOf } from '../bitmap.ts'
import type { Bitmap, Rect, Rgb } from '../bitmap.ts'

/**
 * The shape half of Stage 3: turning ink into a fixed-size, size-normalised
 * grid. Shared, and it HAS to be.
 *
 * THE TEMPLATE GENERATOR IMPORTS THIS EXACT CODE. Templates normalised one way
 * and tiles normalised another do not compare — every score comes out plausible
 * and every reading is wrong, which is the worst kind of broken. Keeping one
 * implementation is the only thing that makes the two halves commensurable, so
 * this module holds no data and no template and can be imported by a plain
 * Node script (see scripts/build-glyph-templates.mjs).
 */

/**
 * WIDER THAN IT IS TALL, and that is the design. Every uppercase letter shares
 * a cap height, so scaling by HEIGHT and centring horizontally preserves each
 * letter's own width — which is most of what separates I from H, or W from V.
 * Squashing each glyph into a square would throw that away and is the usual
 * reason template matching confuses narrow letters.
 */
export const TEMPLATE_WIDTH = 24
export const TEMPLATE_HEIGHT = 20
/** Cap height inside the box, leaving a pixel top and bottom. */
const GLYPH_HEIGHT = TEMPLATE_HEIGHT - 2
export const TEMPLATE_SIZE = TEMPLATE_WIDTH * TEMPLATE_HEIGHT

/** Ink coverage in 0..1, row-major. */
export type Mask = { readonly width: number; readonly height: number; readonly data: Float32Array }

/** Coverage at or above this counts as ink when the bounds are measured. */
const INK = 0.4

export function tightBounds(mask: Mask): Rect | null {
  let minX = mask.width
  let minY = mask.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.data[y * mask.width + x] < INK) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * The bounding box of the LARGEST connected run of ink.
 *
 * NOT THE BOX ROUND ALL THE INK, and the difference cost a whole screenshot.
 * Every uppercase letter is one connected shape, so a second blob in the tile
 * is never part of it — but the tight box round everything stretches to include
 * it, and the letter is then squashed sideways and centred wrong. Measured on
 * the real corpus: one stray speck at the right of a tile turned a clean T into
 * a confident F, and every row of that screenshot with it.
 *
 * Eight-connected, because a diagonal stroke joins at a corner in K, X and R
 * and four-connectivity would cut the letter in half.
 */
export function largestInkBounds(mask: Mask): Rect | null {
  const seen = new Uint8Array(mask.width * mask.height)
  const stack: Array<number> = []
  let best: { area: number; bounds: Rect } | null = null

  for (let start = 0; start < seen.length; start++) {
    if (seen[start] === 1 || mask.data[start] < INK) continue
    seen[start] = 1
    stack.length = 0
    stack.push(start)

    let area = 0
    let minX = mask.width
    let minY = mask.height
    let maxX = -1
    let maxY = -1

    while (stack.length > 0) {
      const pixel = stack.pop() as number
      const x = pixel % mask.width
      const y = (pixel - x) / mask.width
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height) continue
          const at = ny * mask.width + nx
          if (seen[at] === 1 || mask.data[at] < INK) continue
          seen[at] = 1
          stack.push(at)
        }
      }
    }

    if (best === null || area > best.area) {
      best = { area, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } }
    }
  }

  return best === null ? null : best.bounds
}

/**
 * Scales a glyph to a fixed cap height, centres it horizontally, and area-
 * averages it into the template grid.
 *
 * Returns null when there is no glyph — which is not a failure. A share card is
 * a grid of coloured squares with no letters at all, and reporting "nothing
 * here" is how Task 5 tells that apart from a board it merely misread.
 */
export function normaliseGlyph(mask: Mask): Float32Array | null {
  const bounds = largestInkBounds(mask)
  if (bounds === null) return null
  // A stray speck is not a letter. A real cap fills most of the tile's height.
  if (bounds.height < 3 || bounds.width < 1) return null

  const scale = GLYPH_HEIGHT / bounds.height
  const targetWidth = Math.min(TEMPLATE_WIDTH, Math.max(1, bounds.width * scale))
  const offsetX = (TEMPLATE_WIDTH - targetWidth) / 2
  const offsetY = (TEMPLATE_HEIGHT - GLYPH_HEIGHT) / 2

  const out = new Float32Array(TEMPLATE_SIZE)
  for (let ty = 0; ty < TEMPLATE_HEIGHT; ty++) {
    const sy0 = bounds.y + ((ty - offsetY) / GLYPH_HEIGHT) * bounds.height
    const sy1 = bounds.y + ((ty + 1 - offsetY) / GLYPH_HEIGHT) * bounds.height
    for (let tx = 0; tx < TEMPLATE_WIDTH; tx++) {
      const sx0 = bounds.x + ((tx - offsetX) / targetWidth) * bounds.width
      const sx1 = bounds.x + ((tx + 1 - offsetX) / targetWidth) * bounds.width
      out[ty * TEMPLATE_WIDTH + tx] = averageOver(mask, sx0, sy0, sx1, sy1)
    }
  }
  return out
}

/** Mean coverage over a source box, clipped, with at least one sample taken. */
function averageOver(mask: Mask, x0: number, y0: number, x1: number, y1: number): number {
  const left = Math.max(0, Math.floor(Math.min(x0, x1)))
  const top = Math.max(0, Math.floor(Math.min(y0, y1)))
  const right = Math.min(mask.width, Math.max(Math.ceil(Math.max(x0, x1)), left + 1))
  const bottom = Math.min(mask.height, Math.max(Math.ceil(Math.max(y0, y1)), top + 1))
  if (right <= left || bottom <= top) return 0

  let total = 0
  let count = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      total += mask.data[y * mask.width + x]
      count++
    }
  }
  return count === 0 ? 0 : total / count
}

/**
 * How alike two normalised glyphs are, in 0..1.
 *
 * COSINE RATHER THAN A DIFFERENCE, so a boldly rendered letter and a thinner
 * one of the same shape still match. Only the direction of the ink vector
 * matters, not how much ink there is — which is what makes one template set
 * usable across a screenshot's worth of scales and anti-aliasing.
 */
export function similarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / Math.sqrt(normA * normB)
}

export type MaskOptions = {
  /** Fraction trimmed off each edge before looking for ink. */
  readonly inset?: number
  /**
   * How far from the tile's own colour a pixel must be, at its furthest, for
   * there to be a letter at all. Wordle's text is white on a filled tile, so
   * the real separation is several times this.
   */
  readonly minContrast?: number
}

const MASK_DEFAULTS = { inset: 0.12, minContrast: 60 } as const

/**
 * The ink in one tile, measured against THAT TILE'S OWN COLOUR.
 *
 * Relational for the same reason Stage 2 is: the text is white on green, white
 * on grey and white on orange, and in high contrast mode the tile underneath is
 * a colour no palette here would have predicted. Distance from the tile's
 * median is the one measure that holds in all of those.
 */
export function glyphMask(bitmap: Bitmap, tile: Rect, options: MaskOptions = {}): Mask | null {
  const settings = { ...MASK_DEFAULTS, ...options }
  const inset = settings.inset
  const left = Math.max(0, Math.round(tile.x + tile.width * inset))
  const top = Math.max(0, Math.round(tile.y + tile.height * inset))
  const right = Math.min(bitmap.width, Math.round(tile.x + tile.width * (1 - inset)))
  const bottom = Math.min(bitmap.height, Math.round(tile.y + tile.height * (1 - inset)))
  if (right - left < 4 || bottom - top < 4) return null

  const ground: Rgb | null = medianColour(bitmap, tile)
  if (ground === null) return null

  const width = right - left
  const height = bottom - top
  const distances = new Float32Array(width * height)
  let furthest = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = offsetOf(bitmap, left + x, top + y)
      const distance = Math.hypot(
        bitmap.data[at] - ground[0],
        bitmap.data[at + 1] - ground[1],
        bitmap.data[at + 2] - ground[2],
      )
      distances[y * width + x] = distance
      if (distance > furthest) furthest = distance
    }
  }

  if (furthest < settings.minContrast) return null

  // Normalised against the furthest pixel rather than an absolute level, so the
  // same code reads white-on-grey and white-on-orange without being told which.
  const data = new Float32Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = Math.min(1, distances[i] / furthest)
  return { width, height, data }
}
