import { describe, expect, test } from 'vitest'
import {
  MIN_GLOBAL_CONTRIBUTORS,
  contributorsOf,
  sliceIsVisible,
  visibleSlice,
} from './globalThreshold.ts'

/** `n` boards spread across `players` distinct people. */
const boards = (players: number, each = 1) =>
  Array.from({ length: players * each }, (_, i) => ({ playerId: `p${i % players}` }))

describe('the threshold itself', () => {
  test('is 30, the value the owner accepted', () => {
    expect(MIN_GLOBAL_CONTRIBUTORS).toBe(30)
  })

  /**
   * BOTH DIRECTIONS. The spec is explicit that a threshold tested one way is
   * vacuous — a rule that always returned false would pass a below-only test, and
   * one that always returned true would pass an at-only test.
   */
  test('one below the boundary is not visible', () => {
    expect(sliceIsVisible(MIN_GLOBAL_CONTRIBUTORS - 1)).toBe(false)
  })

  test('exactly at the boundary IS visible', () => {
    expect(sliceIsVisible(MIN_GLOBAL_CONTRIBUTORS)).toBe(true)
  })

  test('and above it stays visible', () => {
    expect(sliceIsVisible(MIN_GLOBAL_CONTRIBUTORS + 1)).toBe(true)
  })

  test('an empty slice is not visible', () => {
    expect(sliceIsVisible(0)).toBe(false)
  })
})

describe('contributorsOf', () => {
  /**
   * The definition the whole rule rests on. Counting BOARDS instead would light a
   * slice up for one prolific player — which is exactly the re-identification and
   * the meaninglessness the threshold exists to prevent.
   */
  test('counts distinct players, not boards', () => {
    expect(contributorsOf(boards(3, 100))).toBe(3)
  })

  test('so one player with hundreds of boards is one contributor', () => {
    const prolific = Array.from({ length: 400 }, () => ({ playerId: 'solo' }))
    expect(contributorsOf(prolific)).toBe(1)
    expect(sliceIsVisible(contributorsOf(prolific))).toBe(false)
  })

  test('an empty slice has no contributors', () => {
    expect(contributorsOf([])).toBe(0)
  })
})

describe('visibleSlice', () => {
  test('withholds the value below the threshold, and does not even compute it', () => {
    // If the number is never computed it cannot be leaked by a caller that
    // mishandles a flag — which is why this returns null rather than
    // `{ value, visible: false }`.
    let computed = false
    const result = visibleSlice(boards(MIN_GLOBAL_CONTRIBUTORS - 1), () => {
      computed = true
      return 87
    })
    expect(result.value).toBeNull()
    expect(computed).toBe(false)
    expect(result.contributors).toBe(MIN_GLOBAL_CONTRIBUTORS - 1)
  })

  test('returns the value at exactly the threshold', () => {
    const result = visibleSlice(boards(MIN_GLOBAL_CONTRIBUTORS), () => 87)
    expect(result.value).toBe(87)
    expect(result.contributors).toBe(MIN_GLOBAL_CONTRIBUTORS)
  })

  test('a slice of many boards from too few players is still withheld', () => {
    // The failure mode a board count would miss entirely.
    const result = visibleSlice(boards(5, 200), () => 87)
    expect(result.value).toBeNull()
    expect(result.contributors).toBe(5)
  })

  test('reports the contributor count either way, so a caller can explain itself', () => {
    expect(visibleSlice(boards(4), () => 1).contributors).toBe(4)
    expect(visibleSlice(boards(40), () => 1).contributors).toBe(40)
  })
})
