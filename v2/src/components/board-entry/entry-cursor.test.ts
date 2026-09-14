import { describe, expect, test } from 'vitest'
import { typeLetter, type EntryState } from './entry-cursor.ts'

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
  test('REFUSES a letter while the answer is incomplete, nameably', () => {
    const { state: next, refused } = typeLetter(state({ zone: 'board' }), 'C')
    expect(refused).toBe('answer-incomplete')
    expect(next.guesses).toEqual(EMPTY_ROWS)
  })

  test('types into the first row with room', () => {
    const { state: next } = typeLetter(state({ answer: 'CRANE', zone: 'board' }), 's')
    expect(next.guesses[0]).toBe('S')
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
