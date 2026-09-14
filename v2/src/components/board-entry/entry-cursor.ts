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
export type Refusal = 'answer-full' | 'answer-incomplete' | 'board-solved' | 'board-full'

export type EntryResult = { state: EntryState; refused: Refusal | null }

export const ANSWER_LENGTH = 5

const kept = (state: EntryState, refused: Refusal): EntryResult => ({ state, refused })

export function typeLetter(state: EntryState, key: string): EntryResult {
  const letter = key.toUpperCase()

  if (state.zone === 'answer') {
    if (state.answer.length >= ANSWER_LENGTH) return kept(state, 'answer-full')
    const answer = state.answer + letter
    return {
      // THE HAND-OFF, and it is one expression. The fifth letter moves the
      // cursor into the board, which is what makes this continuous.
      state: { ...state, answer, zone: answer.length === ANSWER_LENGTH ? 'board' : 'answer' },
      refused: null,
    }
  }

  // Unreachable through the transitions below — nothing sets zone to 'board'
  // while the answer is short — and checked anyway, because this is an exported
  // pure function and a future caller may construct state directly.
  if (state.answer.length !== ANSWER_LENGTH) return kept(state, 'answer-incomplete')

  const rows = toRows(state.guesses)
  if (rows.some((row) => row === state.answer)) return kept(state, 'board-solved')

  const index = rows.findIndex((row) => row.length < ANSWER_LENGTH)
  if (index === -1) return kept(state, 'board-full')

  const guesses = [...rows]
  guesses[index] = guesses[index] + letter
  return { state: { ...state, guesses }, refused: null }
}
