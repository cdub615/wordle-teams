import { describe, expect, test } from 'vitest'
import { backspace, typeLetter, type EntryState } from './entry-cursor.ts'

const EMPTY_ROWS = ['', '', '', '', '', '']

const state = (over: Partial<EntryState> = {}): EntryState => ({
  answer: '',
  guesses: [...EMPTY_ROWS],
  zone: 'answer',
  ...over,
})

describe('typeLetter, in the answer zone', () => {
  test('appends, uppercased', () => {
    const { state: next, refused } = typeLetter(state(), 'c')
    expect(next.answer).toBe('C')
    expect(refused).toBeNull()
  })

  /**
   * THE HAND-OFF. This single line is the whole feature: the fifth letter of
   * the answer moves the cursor into the board with no click, which is what
   * removes the gap players were getting lost in.
   */
  test('THE FIFTH LETTER HANDS OFF TO THE BOARD', () => {
    const { state: next } = typeLetter(state({ answer: 'CRAN' }), 'E')
    expect(next.answer).toBe('CRANE')
    expect(next.zone).toBe('board')
  })

  test('the fourth letter does NOT hand off', () => {
    const { state: next } = typeLetter(state({ answer: 'CRA' }), 'N')
    expect(next.zone).toBe('answer')
  })

  test('a full answer refuses a sixth letter rather than silently dropping it', () => {
    const { state: next, refused } = typeLetter(state({ answer: 'CRANE' }), 'X')
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
    const { state: next, refused } = typeLetter(state({ answer: 'CRA' }), 'Enter')
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
   * Today's applyLetter returns the guesses array UNCHANGED when the answer is
   * empty — `current === answer` is `'' === ''` — so every keystroke is
   * swallowed with no signal of any kind. Asserting "the array did not change"
   * would pass against that bug. The refusal has to be a DISTINCT, NAMED
   * outcome, which is the only shape of assertion the old behaviour cannot
   * satisfy.
   */
  test('REFUSES a letter while the answer is incomplete, nameably (this test also pins the guard ABOVE the solved check)', () => {
    const { state: next, refused } = typeLetter(state({ zone: 'board' }), 'C')
    expect(refused).toBe('answer-incomplete')
    expect(next.guesses).toEqual(EMPTY_ROWS)
  })

  test('types into the first row with room', () => {
    const { state: next, refused } = typeLetter(state({ answer: 'CRANE', zone: 'board' }), 's')
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
    const { state: next, refused } = typeLetter(state({ zone: 'board', guesses: sevenRows }), 'C')
    expect(refused).toBe('answer-incomplete')
    expect(next.guesses).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  test('advances to the next row once the active one is full', () => {
    const { state: next } = typeLetter(
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
  test('BACKSPACING AN EMPTY BOARD RETURNS TO THE ANSWER', () => {
    const next = backspace(state({ answer: 'CRANE', zone: 'board' }))
    expect(next.zone).toBe('answer')
    expect(next.answer).toBe('CRANE')
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
})
