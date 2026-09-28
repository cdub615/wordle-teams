import { describe, expect, test } from 'vitest'
import {
  COMPETITIVE_SYSTEM,
  DEFAULT_SYSTEM,
  effectiveFromOf,
  scoringPresetOf,
  systemFor,
} from './scoringSystem.ts'
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

  // Not a reachable race — see systemFor's doc comment, which used to claim it
  // was. setScoringSystemFor's read-then-write upsert is the same shape as
  // upsertBoardFor's, and Convex's OCC prevents the duplicate in both (unproven
  // here either way: convex-test does not simulate OCC retries). This is pinned
  // because the comparator has to be a TOTAL order regardless — an inconsistent
  // one makes Array.prototype.sort implementation-defined whether or not ties
  // occur — and because a future second writer to this table would make ties
  // real. sort is stable, so on a tie the LATER element of the input wins.
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

describe('COMPETITIVE_SYSTEM', () => {
  // Confirmed by the owner against a real team — not re-derived here. See
  // that constant's own comment for why it is not simply "harsher".
  test('is the owner-confirmed Competitive preset, value for value', () => {
    expect(COMPETITIVE_SYSTEM).toEqual({
      oneGuess: 5,
      twoGuesses: 3,
      threeGuesses: 2,
      fourGuesses: 1,
      fiveGuesses: 0,
      sixGuesses: -1,
      failed: -2,
      nA: -2,
    })
  })

  // The two presets are not a harsh/soft pair: Competitive is gentler on a
  // failed board and harsher on a missed one. Pinned so a well-meaning
  // "simplification" that makes Competitive uniformly harsher (e.g. copying
  // Forgiving's failed: -3) cannot land unnoticed.
  test('is gentler than Forgiving on a failed board and harsher on a missed one', () => {
    expect(COMPETITIVE_SYSTEM.failed).toBeGreaterThan(DEFAULT_SYSTEM.failed)
    expect(COMPETITIVE_SYSTEM.nA).toBeLessThan(DEFAULT_SYSTEM.nA)
  })
})

describe('scoringPresetOf', () => {
  test('an exact match of DEFAULT_SYSTEM is forgiving', () => {
    expect(scoringPresetOf({ ...DEFAULT_SYSTEM })).toBe('forgiving')
  })

  test('an exact match of COMPETITIVE_SYSTEM is competitive', () => {
    expect(scoringPresetOf({ ...COMPETITIVE_SYSTEM })).toBe('competitive')
  })

  test('one field off Forgiving is custom, not forgiving', () => {
    expect(scoringPresetOf({ ...DEFAULT_SYSTEM, oneGuess: 4 })).toBe('custom')
  })

  test('one field off Competitive is custom, not competitive', () => {
    expect(scoringPresetOf({ ...COMPETITIVE_SYSTEM, sixGuesses: -2 })).toBe('custom')
  })

  // THE BOUNDARY THAT MATTERS: nA is the one field where Forgiving and
  // Competitive disagree in the harsh direction (0 vs -2). A system that is
  // Forgiving everywhere else but scores a missed day like Competitive does
  // must not be mistaken for either preset.
  test('Forgiving values with Competitive-style nA is custom, not either preset', () => {
    expect(scoringPresetOf({ ...DEFAULT_SYSTEM, nA: -2 })).toBe('custom')
  })

  test('Competitive values with Forgiving-style nA is custom, not either preset', () => {
    expect(scoringPresetOf({ ...COMPETITIVE_SYSTEM, nA: 0 })).toBe('custom')
  })
})
