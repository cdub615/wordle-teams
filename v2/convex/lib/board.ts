/**
 * What makes a board well-formed, and how many attempts it represents.
 *
 * Ported from v1's src/components/action-buttons/board-entry/utils.ts and the
 * DailyScore class in src/lib/types.ts. Shared between the submit button's
 * disabled state and the mutation's server-side check, so the two cannot
 * disagree about what "complete" means.
 */

/** Pad a guess list out to the board's six rows. Non-mutating, unlike v1's padArray. */
export function toRows(guesses: Array<string>, rows = 6): Array<string> {
  return Array.from({ length: rows }, (_, i) => guesses[i] ?? '')
}

/** Drop empty rows. v1's DailyScore constructor does this on every read. */
export function normalizeGuesses(guesses: Array<string>): Array<string> {
  return guesses.filter((guess) => guess.length > 0)
}

/**
 * Attempts a board represents: the guess count, or 7 for a failure.
 *
 * The empty-string filter is load-bearing rather than defensive. v1's
 * upsertBoard appends a '' sentinel to a failed six-guess board, so COPIED ROWS
 * CAN HOLD SEVEN ENTRIES. Counting them raw would report 7 guesses on a board
 * that had 6.
 *
 * The `>=` mirrors v1's DailyScore.attempts exactly. It reads more defensive
 * than it is: seven REAL guesses would be mis-scored, since the check reads
 * played[5] rather than the actual last guess. That shape cannot occur through
 * this app's own writes — boardIsValid and toRows both cap the board at six
 * rows — so the condition is a faithful port rather than a guard.
 */
export function attemptsFor(guesses: Array<string>, answer: string): number {
  const played = normalizeGuesses(guesses)
  if (played.length >= 6 && played[5] !== answer) return 7
  return played.length
}

/**
 * Whether a board can be submitted.
 *
 * Two ways to be valid, exactly as v1: completely empty when a score already
 * exists (which submits a DELETE), or a complete board — five-letter answer,
 * a first guess, every guess either empty or five letters, and either all six
 * rows used or a last guess equal to the answer.
 */
export function boardIsValid(
  answer: string,
  guesses: Array<string>,
  hasExistingScore: boolean,
): boolean {
  const rows = toRows(guesses)
  const isEmpty = answer.length === 0 && rows.every((guess) => guess.length === 0)
  if (isEmpty) return hasExistingScore

  const played = normalizeGuesses(rows)
  return (
    answer.length === 5 &&
    rows[0].length === 5 &&
    rows.every((guess) => guess.length === 0 || guess.length === 5) &&
    (rows[5].length === 5 || played[played.length - 1] === answer)
  )
}
