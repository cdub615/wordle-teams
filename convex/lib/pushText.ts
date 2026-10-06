/**
 * Text that goes into a push notification body, and the one rule for clamping
 * user-typed text into it.
 *
 * SERVER-ONLY. Every push body is built in a Convex function, so this does not
 * belong in a client-safe module such as lib/challenge.ts. Two bodies use it
 * today: chatNotificationBody (chatNotify.ts) and challengeNotificationBody
 * (challenges.ts). ONE CLAMP, so the two can never disagree about how long a
 * team name may be.
 */

/**
 * The widest a team name may be in a push body, in CODE POINTS.
 *
 * 40, and the number is chosen to sit far above every real name rather than
 * close to it. Team names have no length limit at any layer — teams.ts's
 * requireName only rejects an empty one — so this is the first and only bound
 * on one, and its job is to stop an abnormal name producing an abnormal
 * notification. The picker's own 15-character truncation is a layout constraint
 * on a small button and is not the right comparison: a notification body has an
 * entire line, and clamping a real name that the operating system would have
 * shown in full would be this fix causing the damage it exists to prevent.
 *
 * IT DOES NOT PROMISE THE BODY FITS. No number can — what a platform shows
 * varies by device, by locale and by whether the shade is expanded. What it
 * promises is that WE choose where a long name is cut and that the cut is
 * marked, instead of the OS choosing silently and possibly eliding the words
 * that identify what the notification is about.
 */
export const MAX_NOTIFIED_TEAM_NAME = 40

/** One character, so a clamped name is exactly the budget rather than over it. */
export const ELLIPSIS = '…'

/**
 * A team name as it may appear in a push body: at most MAX_NOTIFIED_TEAM_NAME
 * code points, cut on a code point and marked with an ellipsis.
 *
 * NOT AN INJECTION DEFENCE, and it is worth saying so plainly so this is never
 * "hardened" into an escaping routine. The Notification API takes plain text,
 * not markup, and the deep link beside a body is built server-side from a team
 * id and clamped to the worker's own origin by resolveNotificationUrl. A
 * crafted team name has nowhere to go. This is about presentation, and only
 * about presentation.
 *
 * CODE POINTS, NOT `String.prototype.slice` (wordle-teams-5gm3). Slicing counts
 * UTF-16 units, so a name of emoji would be cut BETWEEN the halves of a
 * surrogate pair — a lone surrogate, which renders in the shade as the
 * replacement glyph — and would also yield half as many visible characters as
 * the budget says. Spreading into an array iterates code points, which is the
 * unit a reader actually sees.
 *
 * TRAILING WHITESPACE IS TRIMMED BEFORE THE ELLIPSIS IS APPENDED, because a cut
 * lands mid-word as often as not and "Wordle …" reads as a rendering fault
 * rather than as a deliberate truncation. The result can therefore be SHORTER
 * than the budget, which is correct: the budget is a ceiling, not a target.
 */
export function clampTeamNameForPush(name: string): string {
  const points = [...name]
  if (points.length <= MAX_NOTIFIED_TEAM_NAME) return name
  return `${points.slice(0, MAX_NOTIFIED_TEAM_NAME - 1).join('').replace(/\s+$/u, '')}${ELLIPSIS}`
}
