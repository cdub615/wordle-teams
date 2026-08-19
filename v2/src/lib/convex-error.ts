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
    code === 'INVALID_BOARD' ||
    code === 'NOT_TEAM_CREATOR' ||
    code === 'INVALID_TEAM' ||
    code === 'INVALID_DATE' ||
    code === 'CREATOR_NOT_REMOVABLE' ||
    code === 'INVALID_SYSTEM'
  ) {
    return code
  }
  return null
}

/**
 * Copy for the typed codes, shared by every screen that surfaces a
 * ConvexError. `boardErrorMessage` and `dashboardErrorMessage` below differ
 * only in what they say when `error` is NOT one of these — that fallback
 * depends on whether the user was submitting something or just loading a
 * page, but the typed cases themselves don't.
 *
 * Exhaustive over AccessCode on purpose: if access.ts's AccessCode ever grows
 * a member, the `default` branch's `never` assignment stops compiling —
 * for BOTH callers below, since both delegate here — instead of silently
 * routing the new code to a generic message. See the comment on AccessCode
 * itself.
 */
function typedCodeMessage(code: AccessCode): string {
  switch (code) {
    case 'UNAUTHENTICATED':
    case 'NO_PLAYER':
      return 'Your session expired. Please sign in again.'
    case 'NOT_A_MEMBER':
      return 'You are not on that team any more.'
    case 'INVALID_BOARD':
      return 'That board is not complete. Check the answer and your guesses.'
    case 'NOT_TEAM_CREATOR':
      return 'Only the person who created this team can change it.'
    case 'INVALID_TEAM':
      return 'A team needs a name.'
    case 'INVALID_DATE':
      // Fires when the client's `today` is more than a day off the server
      // clock — a wrong device clock or a hostile client, never a timezone
      // difference. "Refresh and try again" would not fix a genuinely wrong
      // clock, so this points at the actual cause instead.
      return "Your device's clock looks off. Check your date and time settings and try again."
    case 'CREATOR_NOT_REMOVABLE':
      return "The person who created this team can't be removed as a member."
    case 'INVALID_SYSTEM':
      return 'Points must be whole numbers between -100 and 100.'
    default: {
      const _exhaustive: never = code
      return _exhaustive
    }
  }
}

/**
 * What to tell the user after a failed board-submission MUTATION (upsertBoard).
 *
 * Do not touch the null-branch wording: it is the a335ae8 message, quoted
 * verbatim, and it earns its specificity — there really is a typed board still
 * on screen for the user to be reassured about.
 */
export function boardErrorMessage(error: unknown): string {
  const code = convexErrorCode(error)
  if (code === null) {
    return 'Could not save your board. Your entry is still here — please try again.'
  }
  return typedCodeMessage(code)
}

/**
 * What to tell the user after a failed page-load QUERY (e.g. getTeamMonth via
 * ScoresTable's useSuspenseQuery).
 *
 * The null case here is NOT an edge case — it's everything that isn't one of
 * our typed codes, which in practice means a dropped connection or a
 * platform 5xx, and it is the single most likely real failure. Unlike
 * boardErrorMessage, nothing was submitted and there is no board to reassure
 * anyone about, so that copy would be actively wrong here.
 */
export function dashboardErrorMessage(error: unknown): string {
  const code = convexErrorCode(error)
  if (code === null) {
    return 'Something went wrong loading this page. Please try again.'
  }
  return typedCodeMessage(code)
}
