import { AVATAR_SIZE, MAX_AVATAR_BYTES, isAllowedAvatarType } from '../../convex/lib/avatar.ts'

/** Which of the server's two rules an encoded blob breaks, or null for neither. */
export type AvatarFault = 'wrong-type' | 'too-large'

/**
 * Whether what `toBlob` actually produced is something players.setAvatar will
 * accept — checked against THE SERVER'S OWN PREDICATE AND CAP, imported rather
 * than restated, so the two cannot drift.
 *
 * THIS EXISTS BECAUSE `canvas.toBlob` LIES BY OMISSION. Ask it for a type it
 * cannot encode and the HTML spec says it gives you `image/png` instead, with
 * no error and no signal. iOS Safari has historically not encoded WebP from a
 * canvas, so an iPhone produced a 256px PNG of a photograph — lossless,
 * routinely 80-180 KB — sailed past the type check because PNG IS allowed, and
 * was refused on size by a server message that deliberately does not say why.
 * The player saw "that image could not be used" for a perfectly ordinary photo.
 *
 * TYPE IS CHECKED BEFORE SIZE, because the two faults have different remedies:
 * a too-large blob can be re-encoded smaller, a wrong-typed one cannot be
 * rescued by trying harder at the same type.
 */
export function avatarEncodingFault(blob: { type: string; size: number }): AvatarFault | null {
  if (!isAllowedAvatarType(blob.type)) return 'wrong-type'
  if (blob.size > MAX_AVATAR_BYTES) return 'too-large'
  return null
}

/**
 * Thrown when no encoding this browser can perform satisfies the server.
 *
 * A DISTINCT CLASS BECAUSE THE MESSAGE HAS TO SURVIVE. `mutationErrorMessage`
 * returns its fallback for anything that is not a ConvexError, so a plain Error
 * thrown here would have its message discarded and the player would get the
 * generic copy — which is the problem this whole change exists to fix. The
 * Profile tab checks for this class specifically.
 */
export class AvatarEncodingError extends Error {
  readonly fault: AvatarFault
  constructor(fault: AvatarFault, message: string) {
    super(message)
    this.name = 'AvatarEncodingError'
    this.fault = fault
  }
}

/**
 * The encodings to try, in order, stopping at the first the server will accept.
 *
 * WEBP FIRST because it is the smallest when available. JPEG SECOND because it
 * is the one format every browser can encode, and a 256px JPEG lands around
 * 10-20 KB — comfortably inside the cap even for a photograph. THE THIRD ATTEMPT
 * exists for the pathological case where q0.85 still overshoots; dropping to
 * q0.6 at this size is invisible in a 20px chat avatar.
 *
 * PNG IS NOT ON THIS LIST AND MUST NOT BE ADDED. It is the thing `toBlob` falls
 * back to on its own, and for photographic content it is precisely what blows
 * the cap.
 */
const ENCODINGS = [
  { type: 'image/webp', quality: 0.85 },
  { type: 'image/jpeg', quality: 0.85 },
  { type: 'image/jpeg', quality: 0.6 },
] as const

const FAULT_MESSAGE: Record<AvatarFault, string> = {
  'too-large': 'That picture could not be made small enough. Try a different one.',
  'wrong-type': 'This browser could not convert that picture. Try a JPEG or PNG.',
}

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

    /**
     * TRY EACH ENCODING AND CHECK WHAT CAME BACK, rather than trusting the one
     * we asked for. `toBlob` reports nothing when it cannot honour a type — it
     * just hands over PNG — so the only way to know what this browser actually
     * did is to look at the result.
     */
    let fault: AvatarFault = 'wrong-type'
    for (const encoding of ENCODINGS) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, encoding.type, encoding.quality),
      )
      if (!blob) continue
      const problem = avatarEncodingFault(blob)
      if (problem === null) return blob
      fault = problem
    }
    // Every attempt failed, so report the LAST fault — by then the format is
    // one this browser can definitely encode, which makes size the honest
    // remaining explanation rather than the type.
    throw new AvatarEncodingError(fault, FAULT_MESSAGE[fault])
  } finally {
    // Frees the decoded bitmap rather than waiting for GC — a 12MP source is
    // tens of megabytes of memory on a phone.
    bitmap.close()
  }
}
