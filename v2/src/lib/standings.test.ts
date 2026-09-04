import { describe, expect, test } from 'vitest'
import { rankWithTies } from './standings.ts'

/** The shape under test is just `{ total }`; the real rows carry much more. */
const rows = (...totals: Array<number>) => totals.map((total, i) => ({ id: `p${i}`, total }))
const ranks = (...totals: Array<number>) => rankWithTies(rows(...totals)).map((r) => r.rank)

describe('rankWithTies', () => {
  test('distinct totals rank 1, 2, 3', () => {
    expect(ranks(10, 8, 6)).toEqual([1, 2, 3])
  })

  // THE DECIDED RULE, and the reason this function exists rather than an
  // index+1 in the component. Dense ranking would give [1, 2, 2, 3] and tell
  // the fourth-placed player they came third.
  test('STANDARD COMPETITION RANKING — a tie for 2nd is followed by 4th, not 3rd', () => {
    expect(ranks(10, 8, 8, 6)).toEqual([1, 2, 2, 4])
  })

  test('a tie at the top is followed by 3rd', () => {
    expect(ranks(10, 10, 6)).toEqual([1, 1, 3])
  })

  test('a three-way tie skips two places', () => {
    expect(ranks(10, 8, 8, 8, 6)).toEqual([1, 2, 2, 2, 5])
  })

  test('everyone level is all 1st', () => {
    expect(ranks(4, 4, 4)).toEqual([1, 1, 1])
  })

  test('a tie in last place still ranks', () => {
    expect(ranks(10, 6, 6)).toEqual([1, 2, 2])
  })

  // Totals go negative: sixGuesses is -1 and failed is -3 in DEFAULT_SYSTEM,
  // so a bad month is a negative number and 0 is not the floor.
  test('negative and zero totals compare like any other number', () => {
    expect(ranks(0, -1, -1, -3)).toEqual([1, 2, 2, 4])
  })

  test('a single row is 1st', () => {
    expect(ranks(5)).toEqual([1])
  })

  test('no rows is no rows, not a crash', () => {
    expect(rankWithTies([])).toEqual([])
  })

  test('every input property is carried through beside the rank', () => {
    expect(rankWithTies([{ id: 'a', total: 3, firstName: 'Ada' }])).toEqual([
      { id: 'a', total: 3, firstName: 'Ada', rank: 1 },
    ])
  })

  test('the input array is not mutated', () => {
    const input = rows(10, 8)
    rankWithTies(input)
    expect(input).toEqual([{ id: 'p0', total: 10 }, { id: 'p1', total: 8 }])
  })
})
