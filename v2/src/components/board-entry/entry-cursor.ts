import { toRows } from '../../../convex/lib/board.ts'

/** Which half of the entry surface the next keystroke lands in. */
export type Zone = 'answer' | 'board'

export type EntryState = {
  answer: string
  guesses: Array<string>
  zone: Zone
}

/**
 * Why a keystroke did nothing, when it did nothing.
 *
 * NAMED RATHER THAN SILENT, AND THAT IS THE POINT OF THIS MODULE
 * (wordle-teams-wty4.1.6). The behaviour being replaced returned the guesses
 * array unchanged when the answer was empty, so a player who clicked the board
 * first met an application that did not respond at all — and a test asserting
 * "unchanged" passed against it happily. A refusal that can be named is a
 * refusal a test can demand and a coach line can explain.
 */
export type Refusal =
  | 'not-a-letter'
  | 'answer-full'
  | 'answer-incomplete'
  | 'board-solved'
  | 'board-full'

export type EntryResult = { state: EntryState; refused: Refusal | null }

export const ANSWER_LENGTH = 5

const kept = (state: EntryState, refused: Refusal): EntryResult => ({ state, refused })

export function typeLetter(state: EntryState, key: string): EntryResult {
  // One normalisation, so every exit — refusal or not, including the
  // not-a-letter guard right below — returns the same six-row shape. v1
  // boards can carry a seventh '' sentinel (see board.ts), and a caller
  // reading next.guesses.length should not get a different answer depending
  // on whether the keystroke landed.
  const normalised = { ...state, guesses: toRows(state.guesses) }

  // A KeyboardEvent's `key` is 'Enter', 'ArrowLeft', 'Dead' as readily as 'c',
  // and appending one whole would overshoot ANSWER_LENGTH in a single stroke —
  // past the `>=` guard below, which only ever sees the length AFTER the fact.
  // An eight-character answer renders as five slots and disables submit with
  // nothing on screen to say why, which is wty4.1.6 wearing a better disguise.
  if (key.length !== 1 || !/[a-z]/i.test(key)) return kept(normalised, 'not-a-letter')
  const letter = key.toUpperCase()

  if (normalised.zone === 'answer') {
    if (normalised.answer.length >= ANSWER_LENGTH) return kept(normalised, 'answer-full')
    const answer = normalised.answer + letter
    return {
      // THE HAND-OFF, and it is one expression. The fifth letter moves the
      // cursor into the board, which is what makes this continuous.
      state: {
        ...normalised,
        answer,
        zone: answer.length === ANSWER_LENGTH ? 'board' : 'answer',
      },
      refused: null,
    }
  }

  // Unreachable through the transitions below — nothing sets zone to 'board'
  // while the answer is short — and checked anyway, because this is an exported
  // pure function and a future caller may construct state directly.
  if (normalised.answer.length !== ANSWER_LENGTH) return kept(normalised, 'answer-incomplete')

  const rows = normalised.guesses
  // ORDER IS LOAD-BEARING, not stylistic: this must stay BELOW the guard above.
  // With an empty answer every empty row satisfies `row === state.answer`
  // ('' === ''), so run first it would tell a player their blank board was
  // solved — wty4.1.6's collision in a new costume. The guard above is what
  // makes this comparison safe, and the 'REFUSES a letter while the answer is
  // incomplete' test is what keeps it above.
  if (rows.some((row) => row === normalised.answer)) return kept(normalised, 'board-solved')

  const index = rows.findIndex((row) => row.length < ANSWER_LENGTH)
  if (index === -1) return kept(normalised, 'board-full')

  const guesses = [...rows]
  guesses[index] = guesses[index] + letter
  return { state: { ...normalised, guesses }, refused: null }
}
