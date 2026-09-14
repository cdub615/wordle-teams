import { toRows } from '../../../convex/lib/board.ts'

/**
 * The pure state machine behind manual board entry: one keystroke stream that
 * runs from the answer into the board and back, with no click in between.
 *
 * WHY THIS SHAPE. Two bugs dictated it, and they are recorded here once so the
 * functions below can state their rules rather than retell the history.
 *
 * wordle-teams-wty4.1.6, THE `'' === ''` COLLISION. One bug class at three
 * sites, all from asking "has a row solved the board?" as a bare `row ===
 * answer`; `isSolved` below asks it correctly once and its doc has the history.
 * The lesson that outlived it is `Refusal`: the original applyLetter answered a
 * swallowed keystroke with an unchanged array and no signal at all, so a player
 * who clicked the board first met an application that did not respond. A no-op
 * that can be named is one a test can demand and a coach line can explain.
 *
 * wordle-teams-lz3w, TWO SCANS THAT DISAGREED. typeLetter scanned FORWARDS for
 * the first row with room while backspace scanned BACKWARDS for the last row
 * with content. On a prefix board — rows filled in order, which is every board
 * built by hand — those name the same row and the bug is invisible. On a GAPPED
 * board they do not: import-prefill.ts assembles by row index and leaves
 * unreadable rows empty, so ['', '', 'SLATE', '', '', ''] is a real shape, and
 * one backspace on it ate a letter out of row 2 while the cursor sat in row 0.
 * Hence `nextSlot`, whose doc carries the rule.
 *
 * v1 boards can also carry a seventh '' sentinel (convex/lib/board.ts), so every
 * exported function opens with `normalise` and every exit returns six rows.
 */

/** Which half of the entry surface the next keystroke lands in. */
export type Zone = 'answer' | 'board'

export type EntryState = {
  answer: string
  guesses: Array<string>
  zone: Zone
}

/** Why a keystroke did nothing, when it did nothing. Named, never silent. */
export type Refusal =
  | 'not-a-letter'
  | 'answer-full'
  | 'answer-incomplete'
  | 'board-solved'
  | 'board-full'

/**
 * The envelope for operations that can swallow a keystroke invisibly: the
 * resulting state, plus the named reason nothing happened. An operation whose
 * every no-op is already legible on screen returns plain EntryState — `backspace`
 * does, and its doc has the argument.
 */
export type EntryResult = { state: EntryState; refused: Refusal | null }

export const ANSWER_LENGTH = 5

const kept = (state: EntryState, refused: Refusal): EntryResult => ({ state, refused })

/** Six rows, whatever was passed in. Every entry point opens with this. */
const normalise = (state: EntryState): EntryState => ({
  ...state,
  guesses: toRows(state.guesses),
})

/**
 * Where the next letter lands: the first row with room, and the column in it.
 * Null when all six rows are full.
 *
 * typeLetter, backspace and cursorFor MUST all derive from this rather than scan
 * for themselves (lz3w, above).
 *
 * NOT NAMED `activeRow`: that is vague enough to invite exactly the reuse which
 * caused the bug. It returns the column too, because cursorFor needs it.
 */
function nextSlot(rows: Array<string>): { row: number; col: number } | null {
  const row = rows.findIndex((guess) => guess.length < ANSWER_LENGTH)
  return row === -1 ? null : { row, col: rows[row].length }
}

/**
 * Whether any row has already solved the board.
 *
 * THE LENGTH CHECK IS THE WHOLE POINT, not belt-and-braces. A bare
 * `row === answer` is true for an EMPTY row against an EMPTY answer, and that
 * `'' === ''` collision is this module's recurring bug: it is what made the
 * original applyLetter swallow every keystroke (wordle-teams-wty4.1.6, see the
 * top-of-file note), it is why typeLetter's refusal guard used to have to run
 * BEFORE its solved check, and it made cursorFor drop the caret entirely for a
 * directly constructed board-zone state. Asking the question correctly once
 * removes it from all three places rather than requiring each caller to guard in
 * the right order.
 */
function isSolved(guesses: Array<string>, answer: string): boolean {
  return answer.length === ANSWER_LENGTH && guesses.some((row) => row === answer)
}

export function typeLetter(state: EntryState, key: string): EntryResult {
  // One normalisation, so every exit below returns the same six-row shape.
  const normalised = normalise(state)

  // A KeyboardEvent's `key` is 'Enter', 'ArrowLeft', 'Dead' as readily as 'c',
  // and appending one whole would overshoot ANSWER_LENGTH in a single stroke —
  // past the `>=` guard below, which only ever sees the length AFTER the fact.
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

  // Unreachable through this module's own transitions — neither the hand-off
  // above nor moveZone sets zone to 'board' while the answer is short — and
  // checked anyway, because a caller may construct state directly.
  if (normalised.answer.length !== ANSWER_LENGTH) return kept(normalised, 'answer-incomplete')

  const rows = normalised.guesses
  // `isSolved` is what makes the empty-answer collision impossible, so this is
  // safe in any order now. It stays below the guard above because
  // 'answer-incomplete' is the more useful thing to tell a caller, not because
  // the ordering is load-bearing for correctness.
  if (isSolved(rows, normalised.answer)) return kept(normalised, 'board-solved')

  const slot = nextSlot(rows)
  if (slot === null) return kept(normalised, 'board-full')

  const guesses = [...rows]
  guesses[slot.row] = guesses[slot.row] + letter
  return { state: { ...normalised, guesses }, refused: null }
}

/**
 * Delete one letter, or walk back a zone when there is nothing left to delete.
 *
 * DELETES BEHIND THE CURSOR, WHICH IS `nextSlot` AND NOTHING ELSE (lz3w, above).
 *
 * RETURNS PLAIN STATE, NOT AN EntryResult, because every way a backspace can do
 * nothing is a state the player can see. `cursorFor` draws the caret, so an
 * empty answer with the cursor sitting in it, and a cursor at the very start of
 * the board with the content further down, are both on screen already. There is
 * no refusal worth naming and nothing for a coach line to explain. typeLetter's
 * refusals are the opposite: each one is a keystroke that vanished for a reason
 * the screen does not show.
 */
export function backspace(state: EntryState): EntryState {
  // Same normalisation typeLetter opens with, for the same reason.
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

  // Start of a row that is not the first: cross back into the row above. On a
  // prefix board this is the only way a player reaches the previous row, and
  // the 'crosses back into the previous row' test pins it.
  if (slot.row > 0) return erase(slot.row - 1)

  // From here the cursor is at row 0, column 0 — the two cases the old scan conflated.

  // THE WALK-BACK: the board is genuinely empty, so the only thing behind the
  // cursor is the answer. Going there is what makes the stream continuous in
  // reverse. `every` is deliberately inline and used once — a "last row with
  // content" helper is exactly the abstraction that invited the bug.
  if (rows.every((row) => row.length === 0)) return { ...normalised, zone: 'answer' }

  // A gapped board: row 0 is empty but rows below it are not. Nothing is behind
  // the cursor, so nothing is deleted, on purpose — there IS board content, so
  // the answer is not what the player is backing into. Deleting the far-off
  // content instead is lz3w, which damaged a row the reader got right.
  return normalised
}

/**
 * Where the caret renders. `index` is an INSERTION POINT, so in the answer zone
 * it ranges 0..ANSWER_LENGTH inclusive.
 */
export type Cursor =
  | { zone: 'answer'; index: number }
  | { zone: 'board'; row: number; index: number }

/**
 * Move the cursor between zones, for a click.
 *
 * A move into the board with a short answer is REFUSED rather than allowed, and
 * that refusal is what lets the board render at full strength with no lock or
 * dim: an early click is answered by the coach line instead of being prevented
 * by making half the dialog look disabled.
 */
export function moveZone(state: EntryState, zone: Zone): EntryResult {
  const normalised = normalise(state)
  if (zone === 'board' && normalised.answer.length !== ANSWER_LENGTH) {
    return kept(normalised, 'answer-incomplete')
  }
  return { state: { ...normalised, zone }, refused: null }
}

/**
 * THE ONE DEFINITION OF "WHERE THE NEXT LETTER GOES", consumed by both the
 * answer slots and the board so the two renderings cannot disagree about it.
 * Returns null only when there is genuinely nothing left to type.
 */
export function cursorFor(state: EntryState): Cursor | null {
  const { answer, guesses, zone } = normalise(state)

  if (zone === 'answer') return { zone: 'answer', index: answer.length }

  if (isSolved(guesses, answer)) return null

  const slot = nextSlot(guesses)
  return slot === null ? null : { zone: 'board', row: slot.row, index: slot.col }
}
