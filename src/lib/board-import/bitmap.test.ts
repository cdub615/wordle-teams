import { describe, expect, it } from 'vitest'
import { contains, createBitmap, cropBitmap, fillRect, offsetOf, pixelAt, setPixel, strokeRect } from './bitmap.ts'

const RED = [255, 0, 0] as const
const BLUE = [0, 0, 255] as const

describe('createBitmap', () => {
  it('is RGBA, row-major and unpadded — the canvas layout', () => {
    const bitmap = createBitmap(3, 2)
    expect(bitmap.data.length).toBe(3 * 2 * 4)
    expect(offsetOf(bitmap, 2, 1)).toBe((1 * 3 + 2) * 4)
  })

  // The zero buffer is transparent black, so a fill that forgets alpha reads
  // back as nothing at all.
  it('writes alpha whatever the fill, including the default', () => {
    expect(pixelAt(createBitmap(1, 1), 0, 0)).toEqual([0, 0, 0, 255])
    expect(pixelAt(createBitmap(1, 1, RED), 0, 0)).toEqual([255, 0, 0, 255])
  })

  it('refuses a size that is not a positive integer', () => {
    expect(() => createBitmap(0, 4)).toThrow()
    expect(() => createBitmap(4, 1.5)).toThrow()
  })
})

describe('pixelAt and setPixel', () => {
  it('reads back exactly what was written', () => {
    const bitmap = createBitmap(4, 4, RED)
    setPixel(bitmap, 2, 3, BLUE)
    expect(pixelAt(bitmap, 2, 3)).toEqual([0, 0, 255, 255])
    expect(pixelAt(bitmap, 1, 3)).toEqual([255, 0, 0, 255])
  })

  // Asymmetric on purpose: a READ off the edge is a bug in the caller and must
  // say so, while a WRITE off the edge is how clipping is expressed.
  it('throws on an out-of-bounds read and ignores an out-of-bounds write', () => {
    const bitmap = createBitmap(2, 2, RED)
    expect(() => pixelAt(bitmap, 2, 0)).toThrow()
    expect(() => pixelAt(bitmap, -1, 0)).toThrow()
    expect(() => setPixel(bitmap, 9, 9, BLUE)).not.toThrow()
    expect(contains(bitmap, 9, 9)).toBe(false)
  })
})

describe('fillRect', () => {
  it('fills the half-open box and nothing past it', () => {
    const bitmap = createBitmap(5, 5, RED)
    fillRect(bitmap, { x: 1, y: 1, width: 2, height: 2 }, BLUE)
    expect(pixelAt(bitmap, 1, 1)).toEqual([0, 0, 255, 255])
    expect(pixelAt(bitmap, 2, 2)).toEqual([0, 0, 255, 255])
    expect(pixelAt(bitmap, 3, 2)).toEqual([255, 0, 0, 255])
    expect(pixelAt(bitmap, 2, 3)).toEqual([255, 0, 0, 255])
  })

  // THE SEVERED-COLUMN CASE, at the primitive level: the renderer draws every
  // tile at its true geometry and lets the edge decide what survives.
  it('clips rather than throwing when the box runs off the edge', () => {
    const bitmap = createBitmap(4, 4, RED)
    fillRect(bitmap, { x: -2, y: -2, width: 4, height: 4 }, BLUE)
    expect(pixelAt(bitmap, 0, 0)).toEqual([0, 0, 255, 255])
    expect(pixelAt(bitmap, 2, 0)).toEqual([255, 0, 0, 255])
  })
})

describe('strokeRect', () => {
  it('draws the outline inside the box, leaving the middle alone', () => {
    const bitmap = createBitmap(6, 6, RED)
    strokeRect(bitmap, { x: 1, y: 1, width: 4, height: 4 }, BLUE, 1)
    expect(pixelAt(bitmap, 1, 1)).toEqual([0, 0, 255, 255])
    expect(pixelAt(bitmap, 4, 4)).toEqual([0, 0, 255, 255])
    expect(pixelAt(bitmap, 2, 2)).toEqual([255, 0, 0, 255])
    expect(pixelAt(bitmap, 0, 0)).toEqual([255, 0, 0, 255])
  })

  it('honours thickness and draws nothing at zero', () => {
    const bitmap = createBitmap(8, 8, RED)
    strokeRect(bitmap, { x: 0, y: 0, width: 8, height: 8 }, BLUE, 2)
    expect(pixelAt(bitmap, 1, 1)).toEqual([0, 0, 255, 255])
    expect(pixelAt(bitmap, 2, 2)).toEqual([255, 0, 0, 255])

    const untouched = createBitmap(4, 4, RED)
    strokeRect(untouched, { x: 0, y: 0, width: 4, height: 4 }, BLUE, 0)
    expect(pixelAt(untouched, 0, 0)).toEqual([255, 0, 0, 255])
  })
})

describe('cropBitmap', () => {
  it('copies the sub-rectangle, offset and all', () => {
    const source = createBitmap(4, 4, RED)
    setPixel(source, 2, 3, BLUE)
    const cropped = cropBitmap(source, { x: 1, y: 2, width: 3, height: 2 })
    expect([cropped.width, cropped.height]).toEqual([3, 2])
    expect(pixelAt(cropped, 1, 1)).toEqual([0, 0, 255, 255])
    expect(pixelAt(cropped, 0, 0)).toEqual([255, 0, 0, 255])
  })

  it('does not alias the source', () => {
    const source = createBitmap(4, 4, RED)
    const cropped = cropBitmap(source, { x: 0, y: 0, width: 2, height: 2 })
    setPixel(cropped, 0, 0, BLUE)
    expect(pixelAt(source, 0, 0)).toEqual([255, 0, 0, 255])
  })

  // Shrinking a too-large crop would hand back a bitmap whose size does not
  // match the rect that was asked for — the exact off-by-one the severed-column
  // tests exist to catch.
  it('refuses a crop that does not fit rather than shrinking it', () => {
    const source = createBitmap(4, 4, RED)
    expect(() => cropBitmap(source, { x: 2, y: 0, width: 3, height: 1 })).toThrow()
    expect(() => cropBitmap(source, { x: -1, y: 0, width: 2, height: 2 })).toThrow()
    expect(() => cropBitmap(source, { x: 0, y: 0, width: 0, height: 2 })).toThrow()
    expect(() => cropBitmap(source, { x: 0.5, y: 0, width: 2, height: 2 })).toThrow()
  })
})
