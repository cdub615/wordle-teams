import type { Bitmap } from './bitmap.ts'

/**
 * The only file in board import that touches a browser API.
 *
 * Everything else — Stages 1 to 3, the repair, the orchestration — is pure over
 * plain pixel data and runs in this repo's edge-runtime vitest environment.
 * Keeping the browser confined to this one module is what bought that, so the
 * seam is worth defending: nothing below returns anything but a `Bitmap`, and
 * nothing above this line has ever heard of a canvas.
 *
 * THE CANVAS ALSO DISPOSES OF A TRAP, quietly and for free. A 16-bit PNG is a
 * real input — there is one in the corpus, and it cost the spike a silent index
 * shift when read raw. Drawing anything into a 2D context and reading it back
 * gives 8-bit RGBA whatever went in, so the whole class of problem never
 * reaches Stage 1.
 */

/**
 * Structural, not nominal, and deliberately.
 *
 * A real ClipboardEvent carries a real DataTransfer, and neither exists in
 * jsdom — so typing these against the DOM classes would make the paste path
 * untestable anywhere but a browser. What the code actually needs is two
 * properties, so that is what it asks for, and a test can hand it an object
 * literal.
 */
export type DataTransferItemLike = {
  readonly kind: string
  readonly type: string
  getAsFile(): File | null
}

export type DataTransferLike = {
  readonly files?: ArrayLike<File> | null
  readonly items?: ArrayLike<DataTransferItemLike> | null
}

export type PasteLike = { readonly clipboardData?: DataTransferLike | null }
export type DropLike = { readonly dataTransfer?: DataTransferLike | null }

function isImage(file: File | null): file is File {
  return file !== null && file.type.startsWith('image/')
}

/**
 * The image out of a DataTransfer, from `items` first and then `files`.
 *
 * ITEMS FIRST BECAUSE OF PASTE. A screenshot on the clipboard arrives as a
 * DataTransferItem with no entry in `files` at all in some browsers, while a
 * dropped or chosen file always has one. Reading items first covers both; the
 * other order silently does not handle a paste.
 */
function imageIn(transfer: DataTransferLike | null | undefined): File | null {
  if (transfer === null || transfer === undefined) return null

  const items = transfer.items
  if (items != null) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (isImage(file)) return file
    }
  }

  const files = transfer.files
  if (files != null) {
    for (let i = 0; i < files.length; i++) {
      if (isImage(files[i])) return files[i]
    }
  }

  return null
}

/** The pasted image, or null when the clipboard held something else. */
export function imageFromPaste(event: PasteLike): File | null {
  return imageIn(event.clipboardData)
}

/** The dropped image, or null when what landed was not one. */
export function imageFromDrop(event: DropLike): File | null {
  return imageIn(event.dataTransfer)
}

/** The chosen image. Takes a FileList so it works with or without an element. */
export function imageFromFiles(files: ArrayLike<File> | null | undefined): File | null {
  if (files == null) return null
  for (let i = 0; i < files.length; i++) {
    if (isImage(files[i])) return files[i]
  }
  return null
}

/**
 * WHY THERE IS A CLIPBOARD READ AT ALL, WHEN THERE IS ALREADY A PASTE LISTENER.
 *
 * On iOS there is no route into the paste listener. There is no Cmd-V, and the
 * only way to fire a paste event is a long-press "Paste" on an editable
 * element — but board-input.tsx and the answer field both preventDefault every
 * paste that reaches them, deliberately, to stop a native insertion corrupting
 * the React-owned board. So the listener can never fire there.
 *
 * That is not an edge case. Screenshots taken with iOS's "Copy and Delete" go
 * to the clipboard and are never written to Photos at all, so for that workflow
 * the clipboard is the ONLY place the image exists and the file picker reaches
 * nothing. This is the primary path on a phone, not a convenience.
 */
export type ClipboardImage =
  | { readonly ok: true; readonly blob: Blob }
  | {
      readonly ok: false
      /**
       * Separated because each one wants a different sentence, and none of them
       * is really an error — they are all things a person does.
       */
      readonly reason:
        /** This browser cannot read images off the clipboard. Firefox, today. */
        | 'unsupported'
        /** Dismissed the system paste prompt, or the permission is denied. */
        | 'refused'
        /** The clipboard has something on it, but not an image. */
        | 'no-image'
        | 'failed'
    }

/** Whether to offer a Paste control at all. False on Firefox and on plain http. */
export function canReadClipboard(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function'
}

/**
 * The image on the clipboard.
 *
 * MUST BE REACHED WITH THE USER GESTURE STILL LIVE, which is why this calls
 * `navigator.clipboard.read()` before it awaits anything at all. Safari drops
 * transient activation across an await and the call then rejects with
 * NotAllowedError however the person got here. A caller must likewise not await
 * anything between the click and this call — synchronous setState is fine, an
 * await is not.
 *
 * Safari answers with its own native paste confirmation. That is expected, and
 * dismissing it arrives here as 'refused'.
 */
export async function imageFromClipboard(): Promise<ClipboardImage> {
  if (!canReadClipboard()) return { ok: false, reason: 'unsupported' }

  let items: ReadonlyArray<ClipboardItem>
  try {
    items = await navigator.clipboard.read()
  } catch (error) {
    // By NAME rather than instanceof: a DOMException that crossed a realm —
    // which is exactly what a browser throws here — fails an instanceof check.
    const refused =
      error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
    return { ok: false, reason: refused ? 'refused' : 'failed' }
  }

  for (const item of items) {
    const type = item.types.find((candidate) => candidate.startsWith('image/'))
    if (type === undefined) continue
    try {
      return { ok: true, blob: await item.getType(type) }
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }

  return { ok: false, reason: 'no-image' }
}

/**
 * A phone screenshot is about three megapixels and parses in under 200ms, so
 * this passes one through untouched. It is there for the desktop screenshot of
 * a 5K display, where the cost is quadratic and the extra detail buys nothing:
 * Stage 3 normalises every glyph to 24x20 regardless.
 */
export const MAX_PIXELS = 4_000_000

export type DecodeOptions = {
  readonly maxPixels?: number
}

/**
 * The size to rasterise at. Pure, so the rule is testable without a browser.
 *
 * NEVER UPSCALES. A small crop is small because that is all the user has, and
 * inventing pixels would hand Stage 3 a blurrier glyph than the one it was
 * given while costing four times the work.
 */
export function plannedSize(
  width: number,
  height: number,
  maxPixels: number = MAX_PIXELS,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error(`cannot rasterise a ${width}x${height} image`)
  const pixels = width * height
  if (pixels <= maxPixels) return { width: Math.round(width), height: Math.round(height) }

  const scale = Math.sqrt(maxPixels / pixels)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Anything a 2D context will draw. Narrowed so the module needs no lib.dom pun. */
type Drawable = CanvasImageSource & { readonly width: number; readonly height: number }

async function decode(blob: Blob): Promise<Drawable> {
  // createImageBitmap decodes off the main thread and hands back exactly what
  // drawImage wants. Every browser this app supports has it; the <img> path
  // below is the fallback for the ones that do not, and for a decode it
  // refuses (some animated or exotic formats).
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      // Fall through to the element path rather than failing the paste.
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return image
  } finally {
    // AFTER decode resolves, not after draw: the bitmap is in memory by then
    // and holding the URL open leaks one per paste.
    URL.revokeObjectURL(url)
  }
}

/**
 * An image file as a `Bitmap`, downscaled if it is very large.
 *
 * The returned value is the ImageData itself. That is not a shortcut — `Bitmap`
 * was defined to be structurally compatible with ImageData precisely so this
 * hand-off costs nothing and copies nothing.
 */
export async function bitmapFromBlob(blob: Blob, options: DecodeOptions = {}): Promise<Bitmap> {
  const source = await decode(blob)
  const { width, height } = plannedSize(source.width, source.height, options.maxPixels ?? MAX_PIXELS)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  // willReadFrequently, because getImageData is the entire point of this canvas
  // and without the hint a browser may keep it on the GPU and pay a readback.
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('this browser gave us no 2D canvas context')

  context.drawImage(source, 0, 0, width, height)
  const data = context.getImageData(0, 0, width, height)

  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close()
  return data
}

/** The pasted screenshot as a Bitmap, or null if the clipboard held no image. */
export async function bitmapFromPaste(event: PasteLike, options: DecodeOptions = {}): Promise<Bitmap | null> {
  const file = imageFromPaste(event)
  return file === null ? null : bitmapFromBlob(file, options)
}

/** The dropped screenshot as a Bitmap, or null if what landed was not an image. */
export async function bitmapFromDrop(event: DropLike, options: DecodeOptions = {}): Promise<Bitmap | null> {
  const file = imageFromDrop(event)
  return file === null ? null : bitmapFromBlob(file, options)
}

/** The chosen screenshot as a Bitmap, or null if nothing usable was chosen. */
export async function bitmapFromFiles(
  files: ArrayLike<File> | null | undefined,
  options: DecodeOptions = {},
): Promise<Bitmap | null> {
  const file = imageFromFiles(files)
  return file === null ? null : bitmapFromBlob(file, options)
}
