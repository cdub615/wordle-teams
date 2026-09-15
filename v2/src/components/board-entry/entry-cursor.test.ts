import { describe, expect, test } from 'vitest'
import { backspace, cursorFor, moveZone, solvedRow, typeLetter, type EntryState } from './entry-cursor.ts'

const EMPTY_ROWS = ['', '', '', '', '', '']

const state = (over: Partial<EntryState> = {}): EntryState => ({
  answer: '',
  guesses: [...EMPTY_ROWS],
  zone: 'answer',
  ...over,
})

describe('typeLetter, in the answer zone', () => {
  test('appends, uppercased', () => {
    const { next, refused } = typeLetter(state(), 'c')
    expect(next.answer).toBe('C')
    expect(refused).toBeNull()
  })

  /**
   * THE HAND-OFF. This single line is the whole feature: the fifth letter of
   * the answer moves the cursor into the board with no click, which is what
   * removes the gap players were getting lost in.
   */
  test('THE FIFTH LETTER HANDS OFF TO THE BOARD', () => {
    const { next } = typeLetter(state({ answer: 'CRAN' }), 'E')
    expect(next.answer).toBe('CRANE')
    expect(next.zone).toBe('board')
  })

  test('the fourth letter does NOT hand off', () => {
    const { next } = typeLetter(state({ answer: 'CRA' }), 'N')
    expect(next.zone).toBe('answer')
  })

  test('a full answer refuses a sixth letter rather than silently dropping it', () => {
    const { next, refused } = typeLetter(state({ answer: 'CRANE' }), 'X')
    expect(next.answer).toBe('CRANE')
    expect(refused).toBe('answer-full')
    // A refusal is a no-op, in full: the zone does not move either.
    expect(next.zone).toBe('answer')
  })
})

describe('typeLetter, key validation', () => {
  /**
   * A KeyboardEvent's `key` is 'Enter', 'ArrowLeft', 'Dead' as readily as
   * 'c'. Without this guard, appending one of these whole overshoots
   * ANSWER_LENGTH in a single stroke — past the `>=` guard, which only ever
   * sees the length AFTER the fact — and produces an answer that renders
   * wrong, hands off never, and disables submit with nothing on screen to
   * say why. That is wty4.1.6 wearing a better disguise.
   */
  test('a multi-character key (e.g. Enter) is refused, and leaves answer and zone untouched', () => {
    const { next, refused } = typeLetter(state({ answer: 'CRA' }), 'Enter')
    expect(refused).toBe('not-a-letter')
    expect(next.answer).toBe('CRA')
    expect(next.zone).toBe('answer')
  })

  test('a digit is refused as not-a-letter', () => {
    const { refused } = typeLetter(state(), '5')
    expect(refused).toBe('not-a-letter')
  })

  test('punctuation is refused as not-a-letter', () => {
    const { refused } = typeLetter(state(), '-')
    expect(refused).toBe('not-a-letter')
  })
})

describe('typeLetter, in the board zone', () => {
  /**
   * THE REGRESSION THIS WHOLE CHANGE EXISTS FOR (wordle-teams-wty4.1.6).
   *
   * The applyLetter this replaced returned the guesses array UNCHANGED when the
   * answer was empty — `current === answer` is `'' === ''` — so every keystroke
   * was swallowed with no signal of any kind. Asserting "the array did not
   * change" would pass against that bug. The refusal has to be a DISTINCT, NAMED
   * outcome, which is the only shape of assertion the old behaviour cannot
   * satisfy.
   */
  test('REFUSES a letter while the answer is incomplete, nameably (this test also pins the guard ABOVE the solved check)', () => {
    const { next, refused } = typeLetter(state({ zone: 'board' }), 'C')
    expect(refused).toBe('answer-incomplete')
    expect(next.guesses).toEqual(EMPTY_ROWS)
  })

  test('types into the first row with room', () => {
    const { next, refused } = typeLetter(state({ answer: 'CRANE', zone: 'board' }), 's')
    expect(next.guesses[0]).toBe('S')
    expect(refused).toBeNull()
  })

  /**
   * The success path already returned toRows(state.guesses) (always six),
   * but a refusal used to return state.guesses raw, whatever length was
   * passed. v1's upsertBoard appends a '' sentinel to a failed six-guess
   * board (see convex/lib/board.ts), so seven-entry boards are a real shape
   * in this data — and a caller reading next.guesses.length should not get
   * a different answer depending on whether the keystroke landed.
   */
  test('a refusal normalises a seven-entry guesses array down to six rows', () => {
    const sevenRows = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    const { next, refused } = typeLetter(state({ zone: 'board', guesses: sevenRows }), 'C')
    expect(refused).toBe('answer-incomplete')
    expect(next.guesses).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  test('advances to the next row once the active one is full', () => {
    const { next } = typeLetter(
      state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', '', '', '', '', ''] }),
      'T',
    )
    expect(next.guesses[1]).toBe('T')
  })

  // v1's rule, preserved: typing past a solved row would start a seventh guess.
  test('refuses once a row equals the answer', () => {
    const { refused } = typeLetter(
      state({ answer: 'CRANE', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] }),
      'X',
    )
    expect(refused).toBe('board-solved')
  })

  test('refuses once all six rows are full', () => {
    const full = ['SLATE', 'TRAIN', 'HOUSE', 'MOUSE', 'PIVOT', 'BLIMP']
    const { refused } = typeLetter(state({ answer: 'CRANE', zone: 'board', guesses: full }), 'X')
    expect(refused).toBe('board-full')
  })
})

describe('backspace', () => {
  test('shortens the answer in the answer zone', () => {
    expect(backspace(state({ answer: 'CRAN' })).answer).toBe('CRA')
  })

  test('backspacing an empty answer is a no-op that stays put', () => {
    const next = backspace(state())
    expect(next.answer).toBe('')
    expect(next.zone).toBe('answer')
  })

  test('deletes from the last row that has content', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', 'TR', '', '', '', ''] }),
    )
    expect(next.guesses[1]).toBe('T')
  })

  test('crosses back into the previous row once the active row is empty', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', '', '', '', '', ''] }),
    )
    expect(next.guesses[0]).toBe('SLAT')
  })

  /**
   * THE WALK-BACK, which is the hand-off in reverse and the reason the stream
   * is continuous in both directions. Without it, a player who mistyped the
   * answer and has not yet typed a guess is stranded in a zone where backspace
   * does nothing.
   */
  /**
   * THE WALK-BACK DELETES AS WELL AS MOVING — an OWNER DECISION taken once the
   * wiring was on screen, and the reason this expectation changed from 'CRANE'
   * to 'CRAN'.
   *
   * The old rule moved the zone and deleted nothing, so the commonest correction
   * there is — type 'SPEED', the caret hands itself to the board, press Backspace
   * to fix the 'D' — cost two dead keystrokes: the walk-back did nothing visible,
   * and the replacement letter was then refused 'answer-full' and did nothing
   * either. One press now removes exactly one thing, here as everywhere else.
   */
  test('BACKSPACING AN EMPTY BOARD RETURNS TO THE ANSWER, AND EATS ITS LAST LETTER', () => {
    const next = backspace(state({ answer: 'CRANE', zone: 'board' }))
    expect(next.zone).toBe('answer')
    expect(next.answer).toBe('CRAN')
  })

  // The edge of that rule: there is nothing behind the cursor to delete, so the
  // move happens on its own rather than the whole thing being skipped.
  test('the walk-back still moves when the answer is empty, and deletes nothing', () => {
    const next = backspace(state({ answer: '', zone: 'board' }))
    expect(next.zone).toBe('answer')
    expect(next.answer).toBe('')
  })

  /**
   * Same discipline typeLetter's review established (wordle-teams-wty4.1.6
   * follow-up): a seven-entry guesses array — the real shape v1's upsertBoard
   * produces when it appends a '' sentinel to a failed board, see
   * convex/lib/board.ts — must come back as six rows regardless of which exit
   * backspace takes. Both early returns (the answer-zone branch and the
   * walk-back) used to spread the raw, unnormalised state; this pins both.
   */
  test('normalises a seven-entry guesses array down to six rows, on the answer-zone exit', () => {
    const sevenRows = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    const next = backspace(state({ answer: 'CRAN', guesses: sevenRows }))
    expect(next.guesses).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  test('normalises a seven-entry guesses array down to six rows, on the walk-back exit', () => {
    const sevenRows = ['', '', '', '', '', '', '']
    const next = backspace(state({ answer: 'CRANE', zone: 'board', guesses: sevenRows }))
    expect(next.zone).toBe('answer')
    expect(next.guesses).toEqual(['', '', '', '', '', ''])
  })

  // The branch itself is already covered by 'BACKSPACING AN EMPTY BOARD RETURNS
  // TO THE ANSWER'. What this adds is the PAIRING with typeLetter's
  // 'answer-incomplete' refusal: landing in the board zone with a short answer
  // is a dead end for typing and an EXIT for backspace, so the state typeLetter
  // refuses to act on is one backspace recovers from. Documentation of how the
  // two compose, not new coverage.
  test('the walk-back is the recovery from a short answer', () => {
    const next = backspace(state({ answer: 'CRA', zone: 'board' }))
    expect(next.zone).toBe('answer')
    // 'CRA' minus its last letter: the walk-back deletes, as everywhere else.
    expect(next.answer).toBe('CR')
  })

  /**
   * CASE 1, the board-full branch, which nothing else in this file reaches:
   * when every row is full `nextSlot` returns null, so there is no cursor to
   * delete behind and the last letter of the last row is the only sensible
   * target. Mutating that branch to `erase(0)` left the whole suite green
   * before this test existed — four tests for five cases, and this was the
   * case with none.
   *
   * THE FIRST ASSERTION IS THE ONE THAT KILLS THAT MUTANT: under `erase(0)`,
   * row 5 is still 'BLIMP' and the expectation on it fails there, before the
   * row-0 line is ever evaluated (vitest stops at the first failing expect).
   * The second assertion is a guard against a different implementation — one
   * that gets row 5 right but erases from BOTH rows — and it is deliberately
   * kept even though the observed mutation never reaches it.
   */
  test('on a full board, backspace deletes from the LAST row', () => {
    const full = ['SLATE', 'TRAIN', 'HOUSE', 'MOUSE', 'PIVOT', 'BLIMP']
    const next = backspace(state({ answer: 'CRANE', zone: 'board', guesses: full }))
    expect(next.guesses[5]).toBe('BLIM')
    expect(next.guesses[0]).toBe('SLATE')
  })
})

describe('a gapped board, which is what an import with an unread row produces', () => {
  /**
   * wordle-teams-lz3w. import-prefill.ts assembles by ROW INDEX, so a parse
   * that could not read rows 0-1 yields ['', '', 'SLATE', '', '', ''] — a board
   * where "the first row with room" (row 0) and "the last row with content"
   * (row 2) are different rows. Typing used the first; backspace used the
   * second; so backspace ate a row the player never touched.
   */
  test('backspace deletes behind the CURSOR, not from the last row with content', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['A', '', 'SLATE', '', '', ''] }),
    )
    expect(next.guesses).toEqual(['', '', 'SLATE', '', '', ''])
  })

  test('with nothing typed, backspace leaves an imported row alone entirely', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['', '', 'SLATE', '', '', ''] }),
    )
    expect(next.guesses).toEqual(['', '', 'SLATE', '', '', ''])
  })

  // The walk-back must NOT fire here: there is a board with content on it, so
  // the answer is not the only thing behind the cursor.
  test('and does not walk back to the answer while the board has content', () => {
    const next = backspace(
      state({ answer: 'CRANE', zone: 'board', guesses: ['', '', 'SLATE', '', '', ''] }),
    )
    expect(next.zone).toBe('board')
  })
})

describe('moveZone', () => {
  // The escape hatch: a player on row five who spots a typo in the answer must
  // not have to backspace thirty times to reach it.
  test('clicking the answer returns the cursor there from the board', () => {
    const { next, refused } = moveZone(
      state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', 'TR', '', '', '', ''] }),
      'answer',
    )
    expect(next.zone).toBe('answer')
    expect(refused).toBeNull()
  })

  test('clicking the board with a complete answer moves there', () => {
    const { next, refused } = moveZone(state({ answer: 'CRANE' }), 'board')
    expect(next.zone).toBe('board')
    expect(refused).toBeNull()
  })

  /**
   * The early click, and the reason the board needs no lock or dim: a click it
   * cannot honour is REFUSED BY NAME, so the coach line can answer the click
   * instead of the grid having to look disabled to prevent it.
   */
  test('clicking the board with an incomplete answer is refused and the cursor stays', () => {
    const { next, refused } = moveZone(state({ answer: 'CRA' }), 'board')
    expect(next.zone).toBe('answer')
    expect(refused).toBe('answer-incomplete')
  })
})

describe('cursorFor', () => {
  test('points at the next empty answer slot', () => {
    expect(cursorFor(state({ answer: 'CR' }))).toEqual({ zone: 'answer', index: 2 })
  })

  /**
   * INDEX 5 IS A LEGAL INSERTION POINT with only five slots to render it in.
   * It is reachable by clicking the slots to correct a complete answer, and
   * answer-slots.tsx renders it as a trailing caret on the last slot, the way
   * an OTP input does. Returning null here instead would take the cursor off
   * the screen at exactly the moment the player asked to edit.
   */
  test('a complete answer still has a cursor, one past the end', () => {
    expect(cursorFor(state({ answer: 'CRANE' }))).toEqual({ zone: 'answer', index: 5 })
  })

  test('points at the next empty tile in the board zone', () => {
    expect(
      cursorFor(state({ answer: 'CRANE', zone: 'board', guesses: ['SLATE', 'TR', '', '', '', ''] })),
    ).toEqual({ zone: 'board', row: 1, index: 2 })
  })

  test('there is no cursor once a row equals the answer', () => {
    expect(
      cursorFor(state({ answer: 'CRANE', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] })),
    ).toBeNull()
  })

  test('there is no cursor once all six rows are full', () => {
    const full = ['SLATE', 'TRAIN', 'HOUSE', 'MOUSE', 'PIVOT', 'BLIMP']
    expect(cursorFor(state({ answer: 'CRANE', zone: 'board', guesses: full }))).toBeNull()
  })

  /**
   * THE PROPERTY nextSlot EXISTS FOR (wordle-teams-lz3w). On a gapped board —
   * what an import with an unread row produces — the rendered cursor and the
   * row a keystroke fills MUST be the same place. They were not, once.
   */
  test('on a gapped board the cursor is where the next letter actually lands', () => {
    const gapped = state({ answer: 'CRANE', zone: 'board', guesses: ['', '', 'SLATE', '', '', ''] })
    const cursor = cursorFor(gapped)
    const typed = typeLetter(gapped, 'A').next
    expect(cursor).toEqual({ zone: 'board', row: 0, index: 0 })
    expect(typed.guesses[0]).toBe('A')
  })
})

describe('the empty-answer collision, which this module has hit three times', () => {
  // A row that solved the board is a five-letter row. An empty row against an
  // empty answer is the collision, not a solved board.
  test('an empty board with no answer is NOT solved, so the caret survives', () => {
    expect(cursorFor(state({ answer: '', zone: 'board' }))).toEqual({
      zone: 'board',
      row: 0,
      index: 0,
    })
  })

  test('and typing into it still refuses by name rather than reporting a solve', () => {
    expect(typeLetter(state({ answer: '', zone: 'board' }), 'C').refused).toBe('answer-incomplete')
  })
})

describe('backspace stays live where there is no caret', () => {
  /**
   * THE ONE PLACE THE "all three derive from nextSlot" RULE DOES NOT HOLD, and it
   * is deliberate. cursorFor short-circuits on isSolved; backspace never asks it.
   * So a solved board has NO caret while backspace is still live, which is how a
   * player edits a board they mistyped into a solve.
   *
   * ONLY AN EXPLICIT TEST CAN STATE THIS. Branch mutation cannot reach it — the
   * solved case falls through a branch the other tests already cover — and a
   * component author reading `cursorFor() === null` as "nothing to type, don't
   * route the key" would strand the player on a board they cannot edit.
   */
  test('a solved board has no cursor, yet backspace deletes and brings it back', () => {
    const solved = state({ answer: 'CRANE', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] })
    expect(cursorFor(solved)).toBeNull()

    const next = backspace(solved)
    expect(next.guesses[0]).toBe('CRAN')
    expect(cursorFor(next)).toEqual({ zone: 'board', row: 0, index: 4 })
  })
})

describe('normalise canonicalises the answer, not only the rows', () => {
  /**
   * A LOWERCASE ANSWER DEFEATED isSolved OUTRIGHT. 'crane' is not the string
   * 'CRANE', so a solved board did not read as solved and typing ran on into row
   * 1. Nothing upstream guarantees the case: convex/schema.ts stores the answer as
   * an unconstrained optional string and form.tsx reads it straight into state.
   */
  test('a lowercase answer still solves the board', () => {
    const solved = state({ answer: 'crane', zone: 'board', guesses: ['CRANE', '', '', '', '', ''] })
    expect(typeLetter(solved, 'X').refused).toBe('board-solved')
    expect(cursorFor(solved)).toBeNull()
  })

  /**
   * A six-letter answer is corrupt data — a player's own typing caps at five — and
   * leaving it uncanonical put the caret at index 6 with only five slots to render
   * it in, breaking the 0..ANSWER_LENGTH range Cursor's doc promises.
   */
  test('a too-long answer is clamped, so the caret stays renderable', () => {
    expect(cursorFor(state({ answer: 'CRANES' }))).toEqual({ zone: 'answer', index: 5 })
  })

  /**
   * And the refusal stops lying. Both typeLetter and moveZone reported
   * 'answer-incomplete' for an answer that was too LONG, which Task 4 would have
   * turned into copy telling the player to finish an answer they had overfilled.
   */
  test('a clamped answer is complete, not incomplete', () => {
    expect(moveZone(state({ answer: 'CRANES' }), 'board').refused).toBeNull()
    expect(typeLetter(state({ answer: 'CRANES', zone: 'board' }), 'S').refused).not.toBe(
      'answer-incomplete',
    )
  })
})

/**
 * `solvedRow` — the only query here that exists for COPY rather than for a
 * transition (wordle-teams-x7ds). entry-coach.ts needs to say which rows sit
 * above the solving row, and the alternative was a second `row === answer` scan
 * over there, which the module header calls out as the mistake that produced both
 * of this file's founding bugs.
 *
 * WHAT THESE TESTS DEFEND IS THE NORMALISATION, because that is the half a local
 * scan in entry-coach.ts would silently lose: coachFor is the one consumer that
 * reads form.tsx's RAW state, straight off an unconstrained convex/schema.ts
 * field. `isSolved` is pinned through typeLetter and cursorFor above; this is the
 * exported index.
 */
describe('solvedRow says WHICH row solved the board', () => {
  test('null when no row does', () => {
    expect(solvedRow(state({ answer: 'CRANE', guesses: ['SLATE', '', '', '', '', ''] }))).toBeNull()
  })

  test('the index of the row that does, not merely that one did', () => {
    expect(solvedRow(state({ answer: 'CRANE', guesses: ['SLATE', 'CRANE', '', '', '', ''] }))).toBe(1)
  })

  /**
   * THE FIRST ONE, when a corrupt board somehow holds two. An index has to be a
   * single answer, and "the row that ended the game" is the earlier one.
   */
  test('the FIRST such row when more than one matches', () => {
    expect(solvedRow(state({ answer: 'CRANE', guesses: ['CRANE', 'CRANE', '', '', '', ''] }))).toBe(0)
  })

  /**
   * wty4.1.6's collision, at the one site that now owns the length check: an
   * empty row against an empty answer must NOT read as a solve. Without this,
   * coachFor would announce a solved board for every fresh entry form.
   */
  test('an empty answer solves nothing, however empty the rows are', () => {
    expect(solvedRow(state())).toBeNull()
  })

  test('a short answer solves nothing either', () => {
    expect(solvedRow(state({ answer: 'CRAN', guesses: ['CRAN', '', '', '', '', ''] }))).toBeNull()
  })

  /** It normalises, which is the whole reason it is exported rather than inlined. */
  test('a lowercase stored answer still finds its row', () => {
    expect(solvedRow(state({ answer: 'crane', guesses: ['SLATE', 'CRANE', '', '', '', ''] }))).toBe(1)
  })

  test('an over-long stored answer is clamped, so its row is still found', () => {
    expect(solvedRow(state({ answer: 'CRANES', guesses: ['CRANE', '', '', '', '', ''] }))).toBe(0)
  })

  /**
   * A SHORT `guesses` IS PADDED, not read past the end — form.tsx holds whatever
   * Convex returned, and `toRows` is what makes the index mean the same thing to
   * entry-coach.ts's scan as it does here.
   */
  test('a guesses array shorter than the board still yields a real index', () => {
    expect(solvedRow({ answer: 'CRANE', guesses: ['', '', 'CRANE'], zone: 'board' })).toBe(2)
  })
})
