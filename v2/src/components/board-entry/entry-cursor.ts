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
 *
 * AND A FIFTH, `openSlot`, ADDED BY wordle-teams-1nvo — WHICH IS NOT lz3w
 * REPEATING, and the distinction is worth having straight before changing
 * anything here. There are TWO questions, not one asked twice:
 *
 *   "where would a LETTER land?"      -> `openSlot`, read by typeLetter AND
 *                                        cursorFor, so the caret cannot be drawn
 *                                        anywhere a key would be refused.
 *   "what is BEHIND the cursor?"      -> `nextSlot` raw, read by backspace, which
 *                                        stays live where no letter is accepted.
 *
 * lz3w was the FIRST question answered twice, by two scans that disagreed. These
 * two differ on purpose, each has exactly one site, and `openSlot` is defined in
 * terms of `nextSlot` rather than rescanning — so they cannot drift apart.
 */

/** Which half of the entry surface the next keystroke lands in. */
export type Zone = 'answer' | 'board'

export type EntryState = {
  answer: string
  guesses: Array<string>
  zone: Zone
}

/**
 * Why a keystroke did nothing, when it did nothing. Named, never silent HERE —
 * which is not the same as announced, and the difference is the whole note.
 *
 * ONE MEMBER REACHES THE PLAYER AS COPY: 'answer-incomplete', because a click
 * into the board on a short answer has no other sign on screen at all — it is
 * what lets the board render at full strength with no lock and no dim.
 *
 * THE OTHER FOUR ARE THE CALLER'S TO IGNORE, and an earlier version of this note
 * claimed the opposite — that all four of the non-`not-a-letter` members were
 * "copy a player should see". THEY ARE NOT, and routing them to the coach line
 * would have been the wrong fix rather than a missing one (wordle-teams-x7ds):
 *
 *   `not-a-letter` fires for Shift, ArrowLeft, F5 and Dead as readily as for a
 *   printable mistake like '5', and the coach line is aria-live="polite", so
 *   announcing it on every Shift press is worse than silence. It stays ONE member
 *   because no consumer distinguishes those two cases.
 *
 *   'answer-full', 'board-solved' and 'board-full' are all answered by a line
 *   keyed on the STATE instead, in entry-coach.ts, and they have to be: each one
 *   describes a state the player is already sitting in, so a refusal-keyed line
 *   would arrive one wasted keystroke late and say nothing the state had not
 *   already made true. Read `coachFor` for which states those are.
 *
 * SO THE TYPE IS STILL WORTH ITS KEYSTROKES: form.tsx skips the write-back on any
 * refusal, which is what stops a no-op key re-firing the scroll effect, and
 * 'answer-incomplete' is copy. What no longer holds is that the member NAMES map
 * one-to-one onto lines of copy.
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
 * WHICH row has already solved the board, or -1. THE LENGTH CHECK IS THE WHOLE
 * POINT, not belt-and-braces: it closes the `'' === ''` collision above at the one
 * site that asks the question, so no caller has to guard in order to stay correct.
 *
 * IT RETURNS THE INDEX BECAUSE ONE CONSUMER NEEDS IT (see `solvedRow`), and it is
 * ONE function rather than two for the reason the header gives: "has a row solved
 * the board" and "which row solved the board" are the same question, and asking it
 * twice is how this module got `Refusal` in the first place.
 */
function solvedRowIn(guesses: Array<string>, answer: string): number {
  return answer.length === ANSWER_LENGTH ? guesses.findIndex((row) => row === answer) : -1
}

/** The predicate the transitions below read, in terms of the one query above. */
function isSolved(guesses: Array<string>, answer: string): boolean {
  return solvedRowIn(guesses, answer) !== -1
}

/**
 * WHICH ROW SOLVED THE BOARD, FOR COPY THAT HAS TO DESCRIBE IT — null when none
 * did. Exported, normalising like every other entry point here, because
 * entry-coach.ts needs to say which rows sit ABOVE the solving row and a second
 * `row === answer` scan over there is exactly the duplication the header warns
 * about (a lowercase answer would defeat one copy and not the other).
 *
 * A QUERY, NOT A TRANSITION, and it answers nothing about where a letter goes.
 * `nextSlot` remains the only answer to that.
 */
export function solvedRow(state: EntryState): number | null {
  const { answer, guesses } = normalise(state)
  const row = solvedRowIn(guesses, answer)
  return row === -1 ? null : row
}

/**
 * WHERE THE NEXT LETTER ACTUALLY LANDS: `nextSlot`, NARROWED BY THE SOLVE.
 *
 * `nextSlot` answers "which row has room". That is not the same question as
 * "which row will take a LETTER", because a solved board takes no further
 * guesses — and conflating the two is wordle-teams-1nvo, where a board solved on
 * row 4 with row 3 unread refused every key aimed at row 3.
 *
 * THE RULE IS "NO GUESS AFTER THE SOLVE", NOT "NO LETTERS ON A SOLVED BOARD",
 * and the difference is the whole fix. A row BEFORE the solving row is a guess
 * the player really made and we failed to read — screenshot import leaves it
 * blank in position — so it is theirs to fill, and boardIsValid now REFUSES the
 * board until they do (wordle-teams-5w0t). A row after it is a seventh guess on a
 * game that ended, which is what the refusal is for.
 *
 * ONE SITE, TWO INPUTS, AND THAT IS THE POINT. Both halves are already answered
 * once each above — `nextSlot` for the row, `solvedRowIn` for the boundary — and
 * this composes them rather than re-deriving either. typeLetter AND cursorFor
 * both read THIS, which is what keeps "the caret is drawn where the letter goes"
 * true (wordle-teams-lz3w). `backspace` deliberately does not: see its doc.
 *
 * THE SOLVING ROW IS NEVER THE TARGET, so `<` rather than `<=` is exact rather
 * than lucky: a row that equals a five-letter answer is full, and `nextSlot` only
 * ever returns a row with room. CHECKED rather than reasoned — over 62,500 boards
 * drawn from {empty, answer, other five-letter, too short, too long} against four
 * answers, `slot.row === solved` never occurs and the two spellings never
 * disagree. So a mutant that swaps `<` for `<=` SURVIVES the suite, and that is
 * expected rather than a hole in the tests; `<` stays because it is the rule
 * stated exactly.
 */
function openSlot(rows: Array<string>, answer: string): { row: number; col: number } | null {
  const slot = nextSlot(rows)
  if (slot === null) return null
  const solved = solvedRowIn(rows, answer)
  return solved === -1 || slot.row < solved ? slot : null
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
  const slot = openSlot(rows, normalised.answer)
  if (slot === null) {
    // WHICH refusal, when there is no open slot: 'board-solved' whenever a row
    // has solved it, so a full-AND-solved board still reports the solve, exactly
    // as it did when the solved check came first. `isSolved` is order-safe, so
    // this is a naming choice rather than a load-bearing sequence.
    return kept(normalised, isSolved(rows, normalised.answer) ? 'board-solved' : 'board-full')
  }

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
 * nextSlot" rule does not hold. typeLetter and cursorFor both read `openSlot`,
 * which is nextSlot NARROWED BY THE SOLVE; this reads nextSlot RAW and asks
 * nothing about the solve. So a solved board has no caret yet backspace still
 * deletes from the solved row, which is how a player edits a board they mistyped
 * into a solve. Read a null cursor as "no slot that will take a LETTER", not
 * "ignore every key".
 *
 * AND IT NEEDED NO CHANGE FOR wordle-teams-1nvo, which is worth saying because
 * that issue guessed it would. Once the caret is drawn on a gap before the solve,
 * "delete behind the cursor" already does the right thing there: the caret sits
 * at the START of the blank row, so the letter behind it is the last letter of
 * the row above, and that is the row this deletes from. It looked like a bug only
 * while the caret was absent and the deletion therefore unexplained.
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
 *
 * "SOLVED" IS NOT ENOUGH TO MAKE IT NULL, SINCE wordle-teams-1nvo. A board solved
 * on a LATER row than a blank one still has a caret, on that blank row, because
 * `openSlot` will take a letter there — the guess was made, the reader missed it,
 * and boardIsValid refuses the board until it is filled in. Null means the solve
 * is at or before every remaining slot.
 */
export function cursorFor(state: EntryState): Cursor | null {
  const { answer, guesses, zone } = normalise(state)

  if (zone === 'answer') return { zone: 'answer', index: answer.length }

  // `openSlot`, NOT `nextSlot` AND NOT A SOLVED CHECK OF ITS OWN. This used to
  // short-circuit on `isSolved` and then read `nextSlot`, which drew no caret on
  // a board solved later than an unread row — a row typeLetter now accepts, so
  // the caret would have been missing from the one place a key works. Reading
  // the same function typeLetter reads is what makes that impossible rather than
  // merely fixed (wordle-teams-1nvo, and lz3w before it).
  const slot = openSlot(guesses, answer)
  return slot === null ? null : { zone: 'board', row: slot.row, index: slot.col }
}
