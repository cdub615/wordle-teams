// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// is the one module in board import that touches a browser. `.hook.test.ts`
// matches the existing precedents in this repo.
//
// WHAT JSDOM DOES AND DOES NOT GIVE US, because it shapes the file. File and
// Blob are real. ClipboardEvent, DragEvent, DataTransfer and ImageData are not
// implemented at all, and `canvas.getContext('2d')` returns null — jsdom has no
// rasteriser without the optional `canvas` package.
//
// So the paste, drop and choose paths are tested against object literals, which
// is exactly why adapter.ts types them structurally instead of against the DOM
// classes. The rasterisation is covered by standing in for the canvas, which
// pins the wiring — the size it draws at, the region it reads back — and leaves
// the drawing itself to `pnpm e2e` in a real browser.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PIXELS,
  bitmapFromBlob,
  bitmapFromPaste,
  imageFromDrop,
  imageFromFiles,
  imageFromPaste,
  plannedSize,
} from './adapter.ts'
import type { DataTransferItemLike } from './adapter.ts'

const png = (name = 'shot.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
const text = () => new File(['hello'], 'note.txt', { type: 'text/plain' })

const asItem = (file: File | null, kind = 'file'): DataTransferItemLike => ({
  kind,
  type: file?.type ?? 'text/plain',
  getAsFile: () => file,
})

describe('imageFromPaste', () => {
  // THE PATH THE FEATURE IS NAMED AFTER. A screenshot on the clipboard arrives
  // as a DataTransferItem with NO entry in `files` at all in some browsers, so
  // reading `files` first silently fails to handle a paste.
  it('finds a screenshot that is only in items', () => {
    const file = png()
    expect(imageFromPaste({ clipboardData: { items: [asItem(file)], files: [] } })).toBe(file)
  })

  it('finds a screenshot that is only in files', () => {
    const file = png()
    expect(imageFromPaste({ clipboardData: { files: [file] } })).toBe(file)
  })

  it('ignores pasted text', () => {
    expect(imageFromPaste({ clipboardData: { items: [asItem(null, 'string')], files: [] } })).toBeNull()
    expect(imageFromPaste({ clipboardData: { items: [asItem(text())] } })).toBeNull()
    expect(imageFromPaste({ clipboardData: { files: [text()] } })).toBeNull()
  })

  it('survives a clipboard with nothing on it', () => {
    expect(imageFromPaste({})).toBeNull()
    expect(imageFromPaste({ clipboardData: null })).toBeNull()
    expect(imageFromPaste({ clipboardData: {} })).toBeNull()
    expect(imageFromPaste({ clipboardData: { items: [], files: [] } })).toBeNull()
  })

  it('takes the first image when several are on the clipboard', () => {
    const first = png('a.png')
    const second = png('b.png')
    expect(imageFromPaste({ clipboardData: { files: [first, second] } })).toBe(first)
  })
})

describe('imageFromDrop and imageFromFiles', () => {
  it('finds a dropped image, and skips the text dropped with it', () => {
    const file = png()
    expect(imageFromDrop({ dataTransfer: { items: [asItem(text()), asItem(file)] } })).toBe(file)
  })

  it('survives a drop of nothing', () => {
    expect(imageFromDrop({})).toBeNull()
    expect(imageFromDrop({ dataTransfer: null })).toBeNull()
  })

  it('finds a chosen image and rejects a chosen document', () => {
    const file = png()
    expect(imageFromFiles([file])).toBe(file)
    expect(imageFromFiles([text()])).toBeNull()
    expect(imageFromFiles(null)).toBeNull()
    expect(imageFromFiles(undefined)).toBeNull()
  })
})

describe('plannedSize', () => {
  it('leaves a phone screenshot exactly alone', () => {
    // 1179x2556 is an iPhone at 3x, and every screenshot in the real corpus.
    expect(plannedSize(1179, 2556)).toEqual({ width: 1179, height: 2556 })
    expect(1179 * 2556).toBeLessThan(MAX_PIXELS)
  })

  it('shrinks an oversized image under the cap, keeping its shape', () => {
    const planned = plannedSize(8000, 6000)
    expect(planned.width * planned.height).toBeLessThanOrEqual(MAX_PIXELS)
    expect(planned.width / planned.height).toBeCloseTo(8000 / 6000, 2)
  })

  // NEVER UPSCALES. A small crop is small because that is all the user has, and
  // inventing pixels hands Stage 3 a blurrier glyph at four times the cost.
  it('never makes an image bigger', () => {
    expect(plannedSize(100, 80)).toEqual({ width: 100, height: 80 })
    expect(plannedSize(100, 80, 10_000_000)).toEqual({ width: 100, height: 80 })
  })

  it('keeps at least one pixel in each direction', () => {
    const planned = plannedSize(10_000, 1, 100)
    expect(planned.height).toBeGreaterThanOrEqual(1)
    expect(planned.width).toBeGreaterThanOrEqual(1)
  })

  it('refuses a degenerate image rather than dividing by zero', () => {
    expect(() => plannedSize(0, 10)).toThrow()
    expect(() => plannedSize(10, -1)).toThrow()
  })
})

describe('bitmapFromBlob', () => {
  afterEach(() => vi.restoreAllMocks())

  /** Stands in for the canvas jsdom does not have, and records what it was asked. */
  function stubCanvas() {
    const calls: { drew: Array<Array<number>>; read: Array<Array<number>> } = { drew: [], read: [] }
    const context = {
      drawImage: (_source: unknown, ...rest: Array<number>) => calls.drew.push(rest),
      getImageData: (x: number, y: number, width: number, height: number) => {
        calls.read.push([x, y, width, height])
        return { width, height, data: new Uint8ClampedArray(width * height * 4) }
      },
    }
    const canvas = { width: 0, height: 0, getContext: () => context }
    vi.spyOn(document, 'createElement').mockImplementation(
      () => canvas as unknown as HTMLCanvasElement,
    )
    return { calls, canvas }
  }

  function stubDecoder(width: number, height: number) {
    vi.stubGlobal('createImageBitmap', async () => ({ width, height, close: () => {} }))
  }

  it('yields a Bitmap the parser can read straight off', async () => {
    stubDecoder(300, 200)
    stubCanvas()
    const bitmap = await bitmapFromBlob(png())

    expect(bitmap.width).toBe(300)
    expect(bitmap.height).toBe(200)
    expect(bitmap.data).toBeInstanceOf(Uint8ClampedArray)
    expect(bitmap.data.length).toBe(300 * 200 * 4)
  })

  it('rasterises an oversized screenshot at the reduced size, not the original', async () => {
    stubDecoder(8000, 6000)
    const { calls, canvas } = stubCanvas()
    const bitmap = await bitmapFromBlob(png())

    const expected = plannedSize(8000, 6000)
    expect([canvas.width, canvas.height]).toEqual([expected.width, expected.height])
    expect(calls.drew[0]).toEqual([0, 0, expected.width, expected.height])
    expect(calls.read[0]).toEqual([0, 0, expected.width, expected.height])
    expect(bitmap.width).toBe(expected.width)
  })

  it("honours a caller's own pixel budget", async () => {
    stubDecoder(2000, 2000)
    stubCanvas()
    const bitmap = await bitmapFromBlob(png(), { maxPixels: 40_000 })
    expect(bitmap.width * bitmap.height).toBeLessThanOrEqual(40_000)
  })

  it('says so plainly when the browser gives no context', async () => {
    stubDecoder(100, 100)
    vi.spyOn(document, 'createElement').mockImplementation(
      () => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement,
    )
    await expect(bitmapFromBlob(png())).rejects.toThrow(/2D canvas context/)
  })

  it('takes a paste all the way to a Bitmap', async () => {
    stubDecoder(120, 90)
    stubCanvas()
    const bitmap = await bitmapFromPaste({ clipboardData: { items: [asItem(png())] } })
    expect(bitmap).not.toBeNull()
    expect([bitmap?.width, bitmap?.height]).toEqual([120, 90])
  })

  it('returns null for a paste with no image, rather than throwing at the user', async () => {
    expect(await bitmapFromPaste({ clipboardData: { items: [asItem(null, 'string')] } })).toBeNull()
  })
})
