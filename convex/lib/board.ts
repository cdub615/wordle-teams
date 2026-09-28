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
 * Two ways to be valid: completely empty when a score already exists (which
 * submits a DELETE), or a complete board — five-letter answer, a first guess,
 * every guess either empty or five letters, NO GAP BETWEEN THE GUESSES, and
 * either all six rows used or a last guess equal to the answer.
 *
 * ALL OF THAT IS v1's EXCEPT THE GAP RULE (wordle-teams-5w0t), which v1 had no
 * way to need: v1 only ever had boards a player typed, and typing fills the rows
 * in order. Screenshot import does not — `prefillFrom` puts each parsed row at
 * its parsed POSITION and leaves a row the reader could not make out BLANK,
 * because the board is positional and a half-read row in the wrong place is
 * worse than an empty one.
 *
 * SO THE GAP RULE IS A SCORING RULE, NOT TIDINESS. `attemptsFor` scores a board
 * through `normalizeGuesses`, which DROPS empty rows — so a three-guess board
 * whose middle row went unread scored as TWO, one better than the player played,
 * with Submit enabled and nothing on screen to question it. The old row checks
 * could not see it: "rows[0] is full" and "every guess is 0 or 5 letters" are
 * both true of a board with a hole in the middle, and the last condition runs
 * against the filtered list, where the hole has already vanished. Measured
 * before this rule: answer CRANE with ['SLATE', '', 'CRANE'] was valid at 2
 * attempts where the player took 3, and answer PIVOT with
 * ['CRANE', '', 'SLATE', '', '', 'TRAIN'] — six guesses, three of them unread —
 * was valid at 3 where the truth is a FAILED board, which scores 7.
 *
 * REJECTING IT IS THE OWNER'S CALL, taken with the alternative in view: teaching
 * `attemptsFor` to count the hole instead would have scored the board correctly
 * while still writing a row Wordle could not have produced. A gap means a guess
 * we do not know, and a board with an unknown guess is not a board.
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
  /**
   * THE GAP, FOUND BY COUNTING RATHER THAN BY SCANNING FOR A BOUNDARY. On a
   * board filled in order the played rows occupy exactly indices
   * 0..played.length-1, so NO blank row can sit at an index below that count. A
   * hole breaks it in both directions at once: it pushes a played row out past
   * the count and leaves a blank behind, under it.
   *
   * IT SUBSUMES `rows[0].length === 5` BELOW, WHICH IS NOW DEAD AND IS KEPT
   * ANYWAY. A leading gap is just a gap: ['', '', 'CRANE'] has one played row and
   * a blank at index 0, so this catches it. CHECKED EXHAUSTIVELY rather than
   * assumed — over all 4^6 boards drawn from {empty, answer, other five-letter,
   * wrong-length} against three answers and both `hasExistingScore` values,
   * 24,576 in total, dropping that clause changes no result. It stays because it
   * is v1's own wording of "a board needs a first guess" and costs nothing, but
   * it is no longer load-bearing: a mutant that deletes it SURVIVES the suite,
   * and that is expected rather than a hole in the tests.
   */
  const hasGap = rows.some((guess, index) => guess.length === 0 && index < played.length)

  return (
    answer.length === 5 &&
    rows[0].length === 5 &&
    !hasGap &&
    rows.every((guess) => guess.length === 0 || guess.length === 5) &&
    (rows[5].length === 5 || played[played.length - 1] === answer)
  )
}
