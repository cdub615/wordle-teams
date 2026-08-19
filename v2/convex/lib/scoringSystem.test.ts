import { describe, expect, test } from 'vitest'
import { DEFAULT_SYSTEM, effectiveFromOf, systemFor } from './scoringSystem.ts'
import type { ScoringSystem } from './scoring.ts'

const values = (oneGuess: number): ScoringSystem => ({
  oneGuess,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
})

const base = values(5)
const versions = [
  { effectiveFrom: '2026-06', ...values(10) },
  { effectiveFrom: '2026-08', ...values(20) },
]

describe('systemFor', () => {
  test('falls back to the base when no version precedes the month', () => {
    expect(systemFor(base, versions, '2026-05').oneGuess).toBe(5)
  })

  test('falls back to the base when there are no versions at all', () => {
    expect(systemFor(base, [], '2026-08').oneGuess).toBe(5)
  })

  test('applies a version in the month it becomes effective', () => {
    expect(systemFor(base, versions, '2026-06').oneGuess).toBe(10)
  })

  test('keeps applying a version to later months until the next one', () => {
    expect(systemFor(base, versions, '2026-07').oneGuess).toBe(10)
  })

  test('applies the latest version that precedes the month', () => {
    expect(systemFor(base, versions, '2026-09').oneGuess).toBe(20)
  })

  test('orders across a year boundary — YYYY-MM sorts lexicographically', () => {
    const acrossYears = [
      { effectiveFrom: '2025-12', ...values(11) },
      { effectiveFrom: '2026-01', ...values(12) },
    ]
    expect(systemFor(base, acrossYears, '2025-12').oneGuess).toBe(11)
    expect(systemFor(base, acrossYears, '2026-01').oneGuess).toBe(12)
    expect(systemFor(base, acrossYears, '2025-11').oneGuess).toBe(5)
  })

  test('does not depend on the input being sorted', () => {
    const shuffled = [versions[1], versions[0]]
    expect(systemFor(base, shuffled, '2026-07').oneGuess).toBe(10)
  })

  // Convex has no unique constraints, and Task 8's setScoringSystem upserts by
  // (teamId, effectiveFrom) with a read-then-write, so two rows sharing an
  // effectiveFrom are reachable under a race. Array.prototype.sort is stable,
  // so on a tie the LATER element of the input array wins — this pins that as
  // a documented contract a future refactor can't silently change.
  test('on a duplicate effectiveFrom, the later element of the input array wins', () => {
    const tied = [
      { effectiveFrom: '2026-06', ...values(10) },
      { effectiveFrom: '2026-06', ...values(30) },
    ]
    expect(systemFor(base, tied, '2026-06').oneGuess).toBe(30)
  })
})

describe('effectiveFromOf', () => {
  test('is null when the month resolves to the base', () => {
    expect(effectiveFromOf(versions, '2026-05')).toBeNull()
  })

  test('is the resolved version month otherwise', () => {
    expect(effectiveFromOf(versions, '2026-07')).toBe('2026-06')
    expect(effectiveFromOf(versions, '2026-09')).toBe('2026-08')
  })
})

describe('DEFAULT_SYSTEM', () => {
  test("is v1's defaultSystem, value for value", () => {
    expect(DEFAULT_SYSTEM).toEqual({
      oneGuess: 5,
      twoGuesses: 3,
      threeGuesses: 2,
      fourGuesses: 1,
      fiveGuesses: 0,
      sixGuesses: -1,
      failed: -3,
      nA: 0,
    })
  })
})
