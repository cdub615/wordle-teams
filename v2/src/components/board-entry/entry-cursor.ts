import { toRows } from '../../../convex/lib/board.ts'

/**
 * The pure state machine behind manual board entry: one keystroke stream that
 * runs from the answer into the board and back, with no click in between.
 *
 * WHY THIS SHAPE. Two bugs dictated it and they are the same mistake — a question
 * about the state answered at each call site instead of in one place. wty4.1.6:
 * "has a row solved the board?" as a bare `row === answer` is TRUE for an empty
 * row against an empty answer, which swallowed every keystroke in the original
 * applyLetter with no signal at all. lz3w: "where does the next letter go?" asked
 * twice — forwards in typeLetter, backwards in backspace — which agree on a
 * prefix board and disagree on a gapped one. Hence `Refusal`, `isSolved`,
 * `nextSlot` and `normalise`: one site per question, each with its own argument.
 */

/** Which half of the entry surface the next keystroke lands in. */
export type Zone = 'answer' | 'board'

export type EntryState = {
  answer: string
  guesses: Array<string>
  zone: Zone
}

/**
 * Why a keystroke did nothing, when it did nothing. Named, never silent.
 *
 * PARTITIONED, AND A CONSUMER MUST RESPECT THE SPLIT. 'answer-full',
 * 'answer-incomplete', 'board-solved' and 'board-full' are copy a player should
 * see. `not-a-letter` is the caller's to IGNORE: it fires for Shift, ArrowLeft, F5
 * and Dead as readily as for a printable mistake like '5', and the coach line is
 * aria-live="polite", so announcing it on every Shift press is worse than silence.
 * It stays ONE member because no consumer distinguishes those two cases.
 */
export type Refusal =
  | 'not-a-letter'
  | 'answer-full'
  | 'answer-incomplete'
  | 'board-solved'
  | 'board-full'

/**
 * The envelope for operations that can swallow a keystroke invisibly: the state
 * that results, plus the named reason nothing happened. `backspace` returns plain
 * EntryState instead, and its doc has the argument.
 *
 * ON A REFUSAL `next` IS THE INPUT NORMALISED, never a new position, so a caller
 * may skip the write — and should: every refusal allocates a fresh `guesses`
 * through `toRows`, so writing it back re-fires a `useEffect` keyed on `guesses`
 * on every arrow key.
 */
export type EntryResult = { next: EntryState; refused: Refusal | null }

export const ANSWER_LENGTH = 5

const kept = (state: EntryState, refused: Refusal): EntryResult => ({ next: state, refused })

/**
 * BOTH HALVES OF THE STATE, CANONICAL, before anything asks about them: six rows
 * (v1 can carry a seventh '' sentinel — convex/lib/board.ts), and an uppercase
 * answer clamped to ANSWER_LENGTH.
 *
 * THE CLAMP DISCARDS A TOO-LONG ANSWER DELIBERATELY. convex/schema.ts stores the
 * answer unconstrained, so six letters is real data — and corrupt, since a player's
 * own typing caps at five. Truncating keeps every later question honest: leaving it
 * puts the caret at index 6 with five slots to draw, and makes typeLetter and
 * moveZone answer 'answer-incomplete' for an answer that is too LONG. Uppercasing
 * likewise: a lowercase answer defeats isSolved, so typing runs past a solved row.
 */
const normalise = (state: EntryState): EntryState => ({
  ...state,
  answer: state.answer.toUpperCase().slice(0, ANSWER_LENGTH),
  guesses: toRows(state.guesses),
})

/**
 * Where the next letter lands: the first row with room, and the column in it (the
 * column too, so cursorFor need not re-derive half the query). Null when all six
 * rows are full. typeLetter, backspace and cursorFor MUST all derive from this
 * rather than scan for themselves (lz3w, above).
 */
function nextSlot(rows: Array<string>): { row: number; col: number } | null {
  const row = rows.findIndex((guess) => guess.length < ANSWER_LENGTH)
  return row === -1 ? null : { row, col: rows[row].length }
}

/**
 * Whether any row has already solved the board. THE LENGTH CHECK IS THE WHOLE
 * POINT, not belt-and-braces: it closes the `'' === ''` collision above at the one
 * site that asks the question, so no caller has to guard in order to stay correct.
 */
function isSolved(guesses: Array<string>, answer: string): boolean {
  return answer.length === ANSWER_LENGTH && guesses.some((row) => row === answer)
}

export function typeLetter(state: EntryState, key: string): EntryResult {
  // One normalisation, so every exit below returns the same canonical shape.
  const normalised = normalise(state)

  // A KeyboardEvent's `key` is 'Enter' or 'Dead' as readily as 'c', and appending
  // one whole would overshoot ANSWER_LENGTH past the `>=` guard below.
  if (key.length !== 1 || !/[a-z]/i.test(key)) return kept(normalised, 'not-a-letter')
  const letter = key.toUpperCase()

  if (normalised.zone === 'answer') {
    if (normalised.answer.length >= ANSWER_LENGTH) return kept(normalised, 'answer-full')
    const answer = normalised.answer + letter
    return {
      // THE HAND-OFF, and it is one expression. The fifth letter moves the
      // cursor into the board, which is what makes this continuous.
      next: {
        ...normalised,
        answer,
        zone: answer.length === ANSWER_LENGTH ? 'board' : 'answer',
      },
      refused: null,
    }
  }

  // Unreachable through this module's own transitions — neither the hand-off nor
  // moveZone sets zone to 'board' on a short answer — and checked anyway.
  if (normalised.answer.length !== ANSWER_LENGTH) return kept(normalised, 'answer-incomplete')

  const rows = normalised.guesses
  // Below the guard above because 'answer-incomplete' is the more useful answer
  // for a caller, NOT because the order is load-bearing: isSolved is order-safe.
  if (isSolved(rows, normalised.answer)) return kept(normalised, 'board-solved')

  const slot = nextSlot(rows)
  if (slot === null) return kept(normalised, 'board-full')

  const guesses = [...rows]
  guesses[slot.row] = guesses[slot.row] + letter
  return { next: { ...normalised, guesses }, refused: null }
}

/**
 * Delete one letter. ALWAYS ONE — the walk-back deletes too.
 *
 * DELETES BEHIND THE CURSOR, WHICH IS `nextSlot` AND NOTHING ELSE (lz3w, above).
 *
 * THE WALK-BACK DELETES THE LAST ANSWER LETTER AS WELL AS MOVING THE ZONE, and
 * that is an OWNER DECISION taken after the wiring was on screen, not an
 * implementation detail. It used to move and delete nothing, which made the most
 * natural correction gesture there is cost two dead keystrokes: type 'SPEED', the
 * caret hands itself to the board, press Backspace meaning to fix the 'D' — the
 * old rule returned to the answer zone with 'SPEED' intact, and the replacement
 * letter was then refused 'answer-full' and also did nothing. Nothing on screen
 * explained either. Deleting here makes one press do what the player expects and
 * makes "backspace removes exactly one thing" true at every position.
 *
 * AN EMPTY ANSWER STILL MOVES AND DELETES NOTHING: `slice(0, -1)` of '' is '',
 * so the zone change happens and there is simply nothing behind it to remove.
 *
 * RETURNS PLAIN STATE, NOT AN EntryResult: every way a backspace can do nothing is
 * a state `cursorFor` already draws, so there is no refusal worth naming.
 *
 * STAYS LIVE WHEN `cursorFor` IS NULL — the one place the "all three derive from
 * nextSlot" rule does not hold, since cursorFor short-circuits on `isSolved` and
 * this never asks it. A solved board has no caret yet backspace still deletes from
 * the solved row, which is how a player edits a board they mistyped into a solve.
 * Read a null cursor as "no slot that will take a LETTER", not "ignore every key".
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

  // No next slot means all six rows are full: the cursor sits past the end of the
  // last row, so the letter behind it is that row's last.
  if (slot === null) return erase(rows.length - 1)

  // Mid-row: the letter behind the cursor is the one the cursor follows.
  if (slot.col > 0) return erase(slot.row)

  // Start of a row that is not the first: cross back into the row above — on a
  // prefix board the only way a player reaches it.
  if (slot.row > 0) return erase(slot.row - 1)

  // From here the cursor is at row 0, column 0 — the two cases the old scan conflated.

  // THE WALK-BACK: the board is genuinely empty, so the only thing behind the
  // cursor is the answer's last letter — and that is what gets deleted, along
  // with the move that makes the stream continuous in reverse. See the doc above
  // for why deleting here rather than merely moving is the rule.
  // `every` is inline and used once on purpose — a "last row with content" helper
  // is exactly the abstraction that invited lz3w.
  if (rows.every((row) => row.length === 0)) {
    return { ...normalised, zone: 'answer', answer: normalised.answer.slice(0, -1) }
  }

  // A gapped board: row 0 is empty but rows below it are not, so nothing is behind
  // the cursor and nothing is deleted. Not a walk-back — there IS board content,
  // so the answer is not what the player is backing into.
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
 * Move the cursor between zones.
 *
 * A move into the board with a short answer is REFUSED rather than allowed, which
 * is what lets the board render at full strength with no lock or dim: an early
 * click is answered by the coach line, not prevented by a disabled-looking grid.
 *
 * ALSO CALLED PROGRAMMATICALLY, to set the post-import zone. A programmatic move
 * should DISCARD the refusal — the system moved, not the player, so nothing
 * should reach the coach line.
 */
export function moveZone(state: EntryState, zone: Zone): EntryResult {
  const normalised = normalise(state)
  if (zone === 'board' && normalised.answer.length !== ANSWER_LENGTH) {
    return kept(normalised, 'answer-incomplete')
  }
  return { next: { ...normalised, zone }, refused: null }
}

/**
 * THE ONE DEFINITION OF "WHERE THE NEXT LETTER GOES", consumed by both the answer
 * slots and the board so the two renderings cannot disagree about it.
 *
 * NULL MEANS "NO SLOT THAT WILL ACCEPT A LETTER", not "done" — a solved board
 * returns null while `boardIsValid` is still false, so 'SLATE' against
 * ['SLATE', 'CRANE', …] has no caret AND no submit. Null is not a cue that entry
 * is complete, and backspace stays live through it.
 */
export function cursorFor(state: EntryState): Cursor | null {
  const { answer, guesses, zone } = normalise(state)

  if (zone === 'answer') return { zone: 'answer', index: answer.length }

  if (isSolved(guesses, answer)) return null

  const slot = nextSlot(guesses)
  return slot === null ? null : { zone: 'board', row: slot.row, index: slot.col }
}
