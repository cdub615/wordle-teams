import { ANSWER_LENGTH, solvedRow } from './entry-cursor.ts'
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
 *     confirm step reading "Keep typing. Backspace goes back a letter", where
 *     `typeLetter` refuses every key ('board-solved') AND `backspace` deletes
 *     nothing — row 0 column 0 with content below is not a walk-back. Both
 *     instructions were false before a key was touched.
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
   * THE ONE STATE WHERE NEITHER TYPING NOR BACKSPACE DOES ANYTHING, so the line
   * below it — which instructs both — is false twice over. Reached by a partial
   * import: `prefillFrom` places each parsed row at its parsed position and
   * leaves an unread one BLANK, so a board solved on row 3 whose first two rows
   * the reader missed arrives as ['', '', 'CRANE'] with the answer the solve
   * supplied — and one unread row above the solve is enough.
   *
   * THE ROW IS NAMED because the player cannot act on this without knowing which
   * row is missing, and because tapping the answer is the only gesture that
   * unblocks it: editing the answer un-solves the board, which gives `nextSlot`
   * its row back. The answer-zone line above then tells them how, so the two
   * compose into a path out.
   *
   * IT FIRES ONLY WHEN THERE IS A ROW TO NAME, and the guard is the sentence
   * being true rather than defensiveness — "a later row already solves this" is
   * a claim about a blank row that PRECEDES the solve. A solved board with no
   * blank row above it keeps the old line, and is not reachable anyway: a parse
   * reads only PLAYED rows (parse.ts's `colours.rows`) and a solve ends the
   * game, so there is never content after the solving row.
   */
  const blank = blankRowBeforeSolve(state)
  if (blank !== null) {
    return `Row ${blank + 1} is blank, and a later row already solves this — tap the answer to edit it`
  }

  const started = state.guesses.some((guess) => guess.length > 0)
  return started
    ? 'Keep typing. Backspace goes back a letter'
    : 'Now type your first guess — rows advance on their own'
}

/**
 * The first blank row above the row that solved the board, or null.
 *
 * COPY ONLY, AND THAT IS A STRUCTURAL RULE rather than a description — read the
 * warning on `lastRowWithContent` in form.tsx and the header of entry-cursor.ts
 * before reusing it. It is module-private, unexported, has "blank" rather than
 * "next"/"active" in its name, and is called from exactly one place: the sentence
 * above, which has to name a row. It answers NOTHING about where a letter goes;
 * `nextSlot` is the only answer to that, and wiring a second scan into that
 * question is wordle-teams-lz3w.
 *
 * `?? ''` BECAUSE THE INDEX AND THE ARRAY COME FROM DIFFERENT SHAPES:
 * `solvedRow` normalises to six rows, `state.guesses` is whatever form.tsx holds,
 * which for a board read straight out of Convex can be shorter.
 */
const blankRowBeforeSolve = (state: EntryState): number | null => {
  const solved = solvedRow(state)
  if (solved === null) return null

  for (let row = 0; row < solved; row += 1) {
    if ((state.guesses[row] ?? '').length === 0) return row
  }
  return null
}
