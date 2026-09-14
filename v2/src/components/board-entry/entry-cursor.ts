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

/**
 * The envelope for operations that can swallow a keystroke invisibly: the
 * resulting state, plus the named reason nothing happened. An operation whose
 * every no-op is already legible on screen returns plain EntryState instead —
 * `backspace` does, and its doc comment has the argument.
 */
export type EntryResult = { state: EntryState; refused: Refusal | null }

export const ANSWER_LENGTH = 5

const kept = (state: EntryState, refused: Refusal): EntryResult => ({ state, refused })

/**
 * Every entry point opens with this. v1 boards can carry a seventh '' sentinel
 * (see convex/lib/board.ts), so a caller reading `guesses.length` must get 6
 * regardless of which function it called or which branch fired.
 */
const normalise = (state: EntryState): EntryState => ({
  ...state,
  guesses: toRows(state.guesses),
})

/**
 * Where the next letter lands: the first row with room, and the column in it.
 * Null when all six rows are full.
 *
 * typeLetter, backspace and cursorFor MUST all derive from this. If the
 * rendered cursor and the row a keystroke fills were computed separately they
 * could disagree — and they DID (wordle-teams-lz3w), on an import-prefilled
 * board with an unread middle row, where the first row with room is row 1 but
 * the last row with content is row 2.
 *
 * NOT NAMED `activeRow`. "Active row" is vague enough to invite exactly the
 * reuse that caused that bug; "next slot" says it answers one question. And it
 * returns the column as well as the row because the column is free
 * (`rows[row].length`) and cursorFor needs it — a helper that dropped it would
 * leave cursorFor hand-rolling half the query again.
 */
function nextSlot(rows: Array<string>): { row: number; col: number } | null {
  const row = rows.findIndex((guess) => guess.length < ANSWER_LENGTH)
  return row === -1 ? null : { row, col: rows[row].length }
}

export function typeLetter(state: EntryState, key: string): EntryResult {
  // One normalisation, so every exit — refusal or not, including the
  // not-a-letter guard right below — returns the same six-row shape.
  const normalised = normalise(state)

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

  const slot = nextSlot(rows)
  if (slot === null) return kept(normalised, 'board-full')

  const guesses = [...rows]
  guesses[slot.row] = guesses[slot.row] + letter
  return { state: { ...normalised, guesses }, refused: null }
}

/**
 * Delete one letter, or walk back a zone when there is nothing left to delete.
 *
 * DELETES BEHIND THE CURSOR, WHICH IS `nextSlot` AND NOTHING ELSE
 * (wordle-teams-lz3w). This used to scan BACKWARDS for the last row with any
 * content while typeLetter scanned FORWARDS for the first row with room. On a
 * prefix board — rows filled in order, which is every board a player builds by
 * hand — those two scans name the same row and the bug is invisible. On a
 * GAPPED board they do not: import-prefill.ts assembles a board by row index
 * and leaves unreadable rows empty, so ['', '', 'SLATE', '', '', ''] is a real
 * shape, and one backspace on it used to eat a letter out of row 2 while the
 * cursor sat in row 0.
 *
 * RETURNS PLAIN STATE, NOT AN EntryResult, because every way a backspace can do
 * nothing is a state the player can see for themselves — an empty answer with
 * the cursor in it, or a cursor sitting at the very start of the board with the
 * content further down. There is no refusal worth naming and nothing for a
 * coach line to explain. typeLetter's refusals are the opposite: each one is a
 * keystroke that vanished for a reason the screen does not show.
 *
 * That argument rests on a cursor being drawn: "the player can see it" is true
 * only once Task 3's `cursorFor` renders one. Until it does, the no-op in the
 * last branch below is as silent as the refusals this module exists to name, and
 * this paragraph is a claim about where the module is headed rather than about
 * what is on screen today.
 */
export function backspace(state: EntryState): EntryState {
  // Same normalisation typeLetter opens with, so every exit below — the
  // answer-zone return and the walk-back included — hands back six rows.
  const normalised = normalise(state)

  if (normalised.zone === 'answer') {
    return { ...normalised, answer: normalised.answer.slice(0, -1) }
  }

  const rows = normalised.guesses
  const slot = nextSlot(rows)

  const erase = (row: number): EntryState => {
    const guesses = [...rows]
    guesses[row] = guesses[row].slice(0, -1)
    return { ...normalised, guesses }
  }

  // All six rows full: there is no next slot, so the cursor sits past the end
  // of the last row and the letter behind it is that row's last.
  if (slot === null) return erase(rows.length - 1)

  // Mid-row: the letter behind the cursor is the one the cursor follows.
  if (slot.col > 0) return erase(slot.row)

  // Start of a row that is not the first: cross back into the row above. This
  // is the existing, correct behaviour — on a prefix board it is the only way
  // a player reaches the previous row, and the 'crosses back into the previous
  // row' test pins it.
  if (slot.row > 0) return erase(slot.row - 1)

  // From here the cursor is at row 0, column 0, and the two remaining cases are
  // what the old reverse scan conflated.

  // THE WALK-BACK: the board is genuinely empty, so the only thing behind the
  // cursor is the answer. Going there is what makes the stream continuous in
  // reverse. `every` is deliberately inline and used once — a "last row with
  // content" helper is exactly the abstraction that invited the bug.
  if (rows.every((row) => row.length === 0)) return { ...normalised, zone: 'answer' }

  // A gapped board: row 0 is empty but rows below it are not. Nothing is behind
  // the cursor, so nothing is deleted, and this is a no-op rather than a
  // walk-back on purpose — there IS board content, so the answer is not what
  // the player is backing into. Deleting the far-off content instead is
  // lz3w, and it silently damaged a row the screenshot reader got right.
  return normalised
}
