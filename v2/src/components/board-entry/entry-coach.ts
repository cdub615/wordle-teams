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

  if (state.zone === 'answer') return "Type today's answer — five letters"

  const started = state.guesses.some((guess) => guess.length > 0)
  return started
    ? 'Keep typing. Backspace goes back a letter'
    : 'Now type your first guess — rows advance on their own'
}
