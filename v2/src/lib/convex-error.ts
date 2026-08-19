import { ConvexError } from 'convex/values'
import type { AccessCode } from '../../convex/access'

/**
 * The typed code behind a thrown ConvexError, or null for anything else.
 *
 * The parent design's error-handling contract is "mutations throw ConvexError
 * with typed codes; UI maps codes to sonner toasts". Everything that is not one
 * of ours — a dropped connection, a platform 5xx — returns null and gets the
 * generic recovery message, which is the case that must never lose a board.
 */
export function convexErrorCode(error: unknown): AccessCode | null {
  if (!(error instanceof ConvexError)) return null
  const data = error.data as { code?: string } | undefined
  const code = data?.code
  if (
    code === 'UNAUTHENTICATED' ||
    code === 'NO_PLAYER' ||
    code === 'NOT_A_MEMBER' ||
    code === 'INVALID_BOARD'
  ) {
    return code
  }
  return null
}

/** What to tell the user, per the spec's error table. */
export function boardErrorMessage(error: unknown): string {
  switch (convexErrorCode(error)) {
    case 'UNAUTHENTICATED':
    case 'NO_PLAYER':
      return 'Your session expired. Please sign in again.'
    case 'NOT_A_MEMBER':
      return 'You are not on that team any more.'
    case 'INVALID_BOARD':
      return 'That board is not complete. Check the answer and your guesses.'
    default:
      // The a335ae8 message, verbatim: the entry is still on screen and the user
      // needs to know that before anything else.
      return 'Could not save your board. Your entry is still here — please try again.'
  }
}
