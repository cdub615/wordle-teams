import { AVATAR_SIZE } from '../../convex/lib/avatar.ts'

/**
 * The square source rectangle to take from an image of these dimensions —
 * the largest centred square that fits.
 *
 * SPLIT OUT FROM THE CANVAS CALL DELIBERATELY. jsdom has no canvas, so
 * resizeToSquare below cannot be unit-tested at all; the arithmetic that can
 * actually be wrong lives here, where it runs in the suite's default
 * edge-runtime.
 */
export function cropRectFor(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height)
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
  }
}

/**
 * A centre-cropped, AVATAR_SIZE-square WebP of the chosen file.
 *
 * NO CROP UI, WHICH IS A DECISION AND NOT AN OMISSION: the result is shown at
 * 32px in the header and ~20px in chat, where nobody can see where the crop
 * landed. A cropper would mean a library and a modal in service of that.
 *
 * THE SERVER DOES NOT TRUST ANY OF THIS. players.setAvatar re-checks the type
 * and the byte count, because this function runs on the player's machine and
 * the upload URL accepts whatever is sent to it.
 */
export async function resizeToSquare(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const { sx, sy, side } = cropRectFor(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not read this image.')
    context.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    )
    if (!blob) throw new Error('Could not read this image.')
    return blob
  } finally {
    // Frees the decoded bitmap rather than waiting for GC — a 12MP source is
    // tens of megabytes of memory on a phone.
    bitmap.close()
  }
}
