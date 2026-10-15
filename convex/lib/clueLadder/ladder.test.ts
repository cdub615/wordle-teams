import { describe, expect, test } from 'vitest'
import type { Clue } from './clues.ts'
import { ladderProblem, MAX_CLUES, MIN_CLUES, remainingAfter, survivors } from './ladder.ts'
import type { Order } from './orders.ts'

const ANSWER: Order = ['triangle', 'square', 'circle', 'diamond', 'star']
const slot = (shape: Order[number], s: number): Clue => ({ kind: 'inSlot', shape, slot: s, negated: false })

// Fixing slots one at a time: 120 → 24 → 6 → 2 → 1.
const VALID: Clue[] = [slot('triangle', 0), slot('square', 1), slot('circle', 2), slot('diamond', 3)]

describe('remainingAfter', () => {
  test('counts the orders still possible after each clue', () => {
    expect(remainingAfter(VALID)).toEqual([24, 6, 2, 1])
  })

  test('is empty for no clues', () => {
    expect(remainingAfter([])).toEqual([])
  })
})

describe('survivors', () => {
  test('returns exactly the orders consistent with every clue', () => {
    expect(survivors(VALID.slice(0, 3))).toEqual([
      ['triangle', 'square', 'circle', 'diamond', 'star'],
      ['triangle', 'square', 'circle', 'star', 'diamond'],
    ])
  })
})

describe('ladderProblem', () => {
  test('accepts a valid ladder', () => {
    expect(MIN_CLUES).toBe(4)
    expect(MAX_CLUES).toBe(6)
    expect(ladderProblem(ANSWER, VALID)).toBeNull()
  })

  test('rejects a ladder that is too short or too long', () => {
    // Two clues that do pin the answer: still too short.
    const two: Clue[] = [
      { kind: 'between', shape: 'circle', a: 'square', b: 'diamond' },
      slot('triangle', 0),
    ]
    expect(ladderProblem(ANSWER, two)).toBe('length')
    const seven: Clue[] = [...VALID, ...VALID.slice(0, 3)]
    expect(ladderProblem(ANSWER, seven)).toBe('length')
  })

  test('rejects a clue that is false for the answer', () => {
    const lying: Clue[] = [slot('star', 0), ...VALID.slice(1)]
    expect(ladderProblem(ANSWER, lying)).toBe('false-clue')
  })

  test('rejects a clue that removes nothing', () => {
    const wasted: Clue[] = [slot('triangle', 0), slot('triangle', 0), ...VALID.slice(1)]
    expect(ladderProblem(ANSWER, wasted)).toBe('no-progress')
  })

  test('rejects a ladder that does not end on one order', () => {
    // 24 → 6 → 3 → 2: four true, useful clues, but two orders remain.
    const open: Clue[] = [
      slot('triangle', 0),
      slot('square', 1),
      { kind: 'leftOf', a: 'circle', b: 'diamond' },
      { kind: 'nextTo', a: 'circle', b: 'diamond', negated: false },
    ]
    expect(remainingAfter(open)).toEqual([24, 6, 3, 2])
    expect(ladderProblem(ANSWER, open)).toBe('not-unique')
  })
})
