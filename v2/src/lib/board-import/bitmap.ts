/**
 * The pixel type Stages 1-3 read, and the only thing they ever read.
 *
 * STRUCTURALLY COMPATIBLE WITH THE BROWSER'S ImageData, DELIBERATELY. A real
 * `ImageData` is assignable to `Bitmap` with no adapter and no copy, so Task 6
 * hands one straight to the parser — while the parser itself never mentions a
 * DOM type and therefore runs in this repo's edge-runtime vitest environment
 * exactly as Part 1's logic does. That seam is what keeps the risky half of
 * board import testable; see the plan's "What Part 1 left" section.
 *
 * RGBA, eight bits a channel, row-major, no padding — the canvas layout. The
 * adapter normalises everything to it, including the 16-bit PNG that is in the
 * real corpus and cost the spike a silent index shift.
 */
export type Bitmap = {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

/** A colour with no alpha. Everything synthesised here is opaque. */
export type Rgb = readonly [r: number, g: number, b: number]

/** A colour as it comes back out of a bitmap, alpha included. */
export type Rgba = readonly [r: number, g: number, b: number, a: number]

/** A half-open box: x..x+width, y..y+height. */
export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Index of the red channel of (x, y). The other three follow it. */
export function offsetOf(bitmap: Bitmap, x: number, y: number): number {
  return (y * bitmap.width + x) * 4
}

export function contains(bitmap: Bitmap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < bitmap.width && y < bitmap.height
}

export function createBitmap(width: number, height: number, fill?: Rgb): Bitmap {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`bitmap must be a positive integer size, got ${width}x${height}`)
  }

  const data = new Uint8ClampedArray(width * height * 4)
  const bitmap: Bitmap = { width, height, data }

  // Opaque black is the zero value of the buffer only for RGB; alpha has to be
  // written whatever the fill, or every pixel reads back transparent.
  const [r, g, b] = fill ?? [0, 0, 0]
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }

  return bitmap
}

export function pixelAt(bitmap: Bitmap, x: number, y: number): Rgba {
  if (!contains(bitmap, x, y)) throw new Error(`(${x}, ${y}) is outside a ${bitmap.width}x${bitmap.height} bitmap`)
  const at = offsetOf(bitmap, x, y)
  return [bitmap.data[at], bitmap.data[at + 1], bitmap.data[at + 2], bitmap.data[at + 3]]
}

export function setPixel(bitmap: Bitmap, x: number, y: number, colour: Rgb): void {
  if (!contains(bitmap, x, y)) return
  const at = offsetOf(bitmap, x, y)
  bitmap.data[at] = colour[0]
  bitmap.data[at + 1] = colour[1]
  bitmap.data[at + 2] = colour[2]
  bitmap.data[at + 3] = 255
}

/**
 * Paints a rectangle, clipped to the bitmap.
 *
 * CLIPPING RATHER THAN THROWING is what makes a severed-column crop cheap to
 * express: the renderer draws the whole board at its true geometry and the crop
 * decides what survives, instead of every caller pre-intersecting its own rects.
 */
export function fillRect(bitmap: Bitmap, rect: Rect, colour: Rgb): void {
  const left = Math.max(0, Math.trunc(rect.x))
  const top = Math.max(0, Math.trunc(rect.y))
  const right = Math.min(bitmap.width, Math.trunc(rect.x + rect.width))
  const bottom = Math.min(bitmap.height, Math.trunc(rect.y + rect.height))

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) setPixel(bitmap, x, y, colour)
  }
}

/** Paints a rectangular outline `width` pixels thick, drawn INSIDE `rect`. */
export function strokeRect(bitmap: Bitmap, rect: Rect, colour: Rgb, width: number): void {
  const w = Math.max(0, Math.trunc(width))
  if (w === 0) return
  fillRect(bitmap, { ...rect, height: w }, colour)
  fillRect(bitmap, { ...rect, y: rect.y + rect.height - w, height: w }, colour)
  fillRect(bitmap, { ...rect, width: w }, colour)
  fillRect(bitmap, { ...rect, x: rect.x + rect.width - w, width: w }, colour)
}

/**
 * Copies a sub-rectangle out into a bitmap of its own.
 *
 * The crop must lie inside the source. A crop that runs off the edge would be a
 * bug in the caller's geometry, and silently shrinking it would hand the caller
 * a bitmap whose size does not match the rect it asked for — which is precisely
 * the kind of off-by-one that the severed-column tests exist to catch.
 */
export function cropBitmap(bitmap: Bitmap, rect: Rect): Bitmap {
  const { x, y, width, height } = rect
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('crop rect must be integral')
  }
  if (width <= 0 || height <= 0 || !contains(bitmap, x, y) || x + width > bitmap.width || y + height > bitmap.height) {
    throw new Error(
      `crop ${width}x${height} at (${x}, ${y}) does not fit a ${bitmap.width}x${bitmap.height} bitmap`,
    )
  }

  const out = createBitmap(width, height)
  for (let row = 0; row < height; row++) {
    const from = offsetOf(bitmap, x, y + row)
    out.data.set(bitmap.data.subarray(from, from + width * 4), row * width * 4)
  }
  return out
}
