import { ANSWER_LENGTH, cursorFor, solvedRow } from './entry-cursor.ts'
import type { EntryState, Refusal } from './entry-cursor.ts'

/**
 * The one line of coaching under the dialog title, as a function of state.
 *
 * A MODULE RATHER THAN JSX SO THE COPY CAN BE READ WITHOUT READING A COMPONENT,
 * and so each state's line is pinned by a test. It is also what a screen reader
 * hears: form.tsx renders this into an aria-live region, which is the only way
 * the hand-off reaches somebody who cannot see the cursor move.
 *
 * `valid` is passed in rather than recomputed here so that boardIsValid stays
 * the single definition of a finished board.
 *
 * TWO OF THESE LINES ANSWER A STATE, NOT A REFUSAL, AND THAT IS THE FIX RATHER
 * THAN AN IMPLEMENTATION CHOICE (wordle-teams-x7ds). The gap this closes was
 * originally read as "three of the four player-facing refusals never reach this
 * function", but routing the refusals here would have been a quarter of a fix:
 * in BOTH misleading cases the line is already wrong with `refused` null, before
 * the player has pressed anything, and the refusal only repeats it.
 *
 *   - Tap a complete answer and the zone line said "Type today's answer — five
 *     letters". The `answer-full` refusal on the next keystroke said it again.
 *   - A partial import whose unread row sits above the solving row arrives on the
 *     confirm step with the caret in the MIDDLE of the board, which happens
 *     nowhere else. The ordinary "Keep typing" line does not account for that, and
 *     the rows below the caret being already filled makes it read like a mistake.
 *
 * THE SECOND CASE USED TO BE A DEAD END AND IS NOT ANY MORE (wordle-teams-1nvo).
 * When x7ds wrote its copy, `typeLetter` refused every key on that board and
 * `backspace` deleted nothing, so the line had to send the player to the answer
 * zone to break the solve — the only escape there was. `openSlot` now accepts a
 * letter in a gap BEFORE the solving row, so the fix is to type the row, and the
 * line says so instead.
 *
 * So the branches are keyed on the state that makes the old line untrue. The
 * refusals stay silent, which is now the whole of the partition: see the note on
 * `Refusal` in entry-cursor.ts.
 */
export function coachFor({
  state,
  refused,
  valid,
}: {
  state: EntryState
  refused: Refusal | null
  valid: boolean
}): string {
  // Validity first: a finished board should be told it can submit, never
  // scolded for a stray keystroke that the refusal below would report.
  if (valid) return 'Looks complete — press Enter or Submit'

  // Then the refusal, because it is a reply to something the player just did
  // and the screen shows no other sign of it.
  if (refused === 'answer-incomplete') return 'Answer first — then the board takes over'

  if (state.zone === 'answer') {
    /**
     * `>=`, NOT `===`, because this function is the one place that reads
     * UNNORMALISED state. Every entry point in entry-cursor.ts opens with
     * `normalise`, which clamps the answer to ANSWER_LENGTH; coachFor is handed
     * form.tsx's raw `answer`, which comes straight off a convex/schema.ts field
     * that stores it unconstrained. A six-letter stored answer is corrupt but
     * real (entry-cursor.ts's clamp note), and `===` would tell its owner to type
     * an answer while `typeLetter` refused every key as 'answer-full'.
     */
    return state.answer.length >= ANSWER_LENGTH
      ? "Answer's in — backspace to change it"
      : "Type today's answer — five letters"
  }

  /**
   * THE CARET IN THE MIDDLE OF THE BOARD, WHICH HAPPENS NOWHERE ELSE. Reached by
   * a partial import: `prefillFrom` places each parsed row at its parsed POSITION
   * and leaves an unread one BLANK, so a board solved on row 4 whose third row
   * the reader missed arrives with rows 1, 2 and 4 filled and the caret on row 3.
   *
   * WHY IT NEEDS ITS OWN LINE. "Keep typing" is true here but unhelpful: the rows
   * BELOW the caret are already filled, which looks like the form has lost its
   * place, and boardIsValid refuses the board until the gap is filled
   * (wordle-teams-5w0t) so there is no submitting past it. Naming the row says
   * both what is wrong and what to do about it.
   *
   * IT ASKS `cursorFor`, NOT THE ROWS. "Which row is active" has exactly one
   * answer in this codebase and that is it (wordle-teams-lz3w) — an earlier cut
   * of this scanned `state.guesses` for the first blank row before the solve,
   * which disagrees with the caret the moment a row is PARTIALLY typed.
   *
   * AND `index === 0` IS THE WORD "BLANK" BEING TRUE. The caret's index is the
   * row's length, so a non-zero one means the player has started the row and it
   * is no longer blank — from there the ordinary keep-typing line below is both
   * true and the right thing to say.
   *
   * The `solvedRow` check is what makes this a GAP rather than the ordinary
   * next row: `cursorFor` is `openSlot`, which returns null unless the slot
   * precedes the solving row, so a board caret on a solved board is necessarily
   * inside a gap and needs no second comparison here.
   */
  const gap = blankGapRow(state)
  if (gap !== null) return `Row ${gap + 1} is blank — type the guess that goes there`

  const started = state.guesses.some((guess) => guess.length > 0)
  return started
    ? 'Keep typing. Backspace goes back a letter'
    : 'Now type your first guess — rows advance on their own'
}

/**
 * The row the caret is on when it is sitting in a gap that is still blank, or
 * null. 0-based; the copy adds one.
 *
 * COPY ONLY, AND IT DERIVES RATHER THAN SCANS. It owns no opinion about where a
 * letter goes: `cursorFor` answers that and this reads it, which is the rule the
 * header of entry-cursor.ts exists to protect (wordle-teams-lz3w). The version
 * this replaced walked `state.guesses` looking for the first blank row before the
 * solve — a SECOND answer to "which row is active", and one that disagreed with
 * the caret as soon as a gap row was half typed.
 */
const blankGapRow = (state: EntryState): number | null => {
  // No solve means no gap: the caret is simply on the next row to play, and the
  // ordinary lines cover that.
  if (solvedRow(state) === null) return null

  const cursor = cursorFor(state)
  if (cursor === null || cursor.zone !== 'board') return null

  // The caret's index is the row's length, so anything above zero means the row
  // has been started and calling it blank would be false.
  return cursor.index === 0 ? cursor.row : null
}
