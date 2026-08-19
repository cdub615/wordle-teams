import { describe, expect, test } from 'vitest'
import { monthTotal, pointsFor, winnerOf, type ScoringSystem } from './scoring'

// v1's default system: src/lib/types.ts defaultSystem.
const system: ScoringSystem = {
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
}

describe('pointsFor', () => {
  test('maps each attempt count to its configured value', () => {
    expect(pointsFor(1, system)).toBe(5)
    expect(pointsFor(4, system)).toBe(1)
    expect(pointsFor(6, system)).toBe(-1)
    expect(pointsFor(7, system)).toBe(-3)
  })

  test('zero attempts scores the N/A value', () => {
    expect(pointsFor(0, system)).toBe(0)
  })

  test('is total — an impossible count cannot throw', () => {
    // v1's getScore throws "No score value found for number of attempts" on a
    // miss. This runs inside the board-entry transaction, where a throw would
    // fail the user's board, so it must not be reachable.
    expect(pointsFor(99, system)).toBe(0)
  })
})

describe('monthTotal', () => {
  const played = (puzzleDay: string, guesses: Array<string>, answer: string) => ({
    puzzleDay,
    guesses,
    answer,
  })

  test('sums the days that were played', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [
        played('2026-08-03', ['SPEED'], 'SPEED'), // 1 attempt -> 5
        played('2026-08-04', ['CRANE', 'SPEED'], 'SPEED'), // 2 -> 3
      ],
      system,
      playWeekends: true,
      today: '2026-08-05',
    })
    // The 1st and 2nd are a weekend but playWeekends is on, so they are missed
    // days before today: 0 each. The 3rd and 4th score 5 and 3.
    expect(total).toBe(8)
  })

  test('a missed day before today scores the N/A value', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [],
      system: { ...system, nA: -2 },
      playWeekends: true,
      today: '2026-08-04',
    })
    // The 1st, 2nd and 3rd are past; the 4th onward is not.
    expect(total).toBe(-6)
  })

  test('days from today onward contribute nothing', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [],
      system: { ...system, nA: -2 },
      playWeekends: true,
      today: '2026-08-01',
    })
    expect(total).toBe(0)
  })

  test('weekends are skipped entirely when the team does not play them', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [],
      system: { ...system, nA: -2 },
      playWeekends: false,
      today: '2026-08-04',
    })
    // 2026-08-01 is a Saturday and the 2nd a Sunday, so only the 3rd counts.
    expect(total).toBe(-2)
  })

  test('N/A must never score: a weekend contributes nothing even when the team\'s nA is non-zero', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [],
      system: { ...system, nA: -999 },
      playWeekends: false,
      today: '2026-08-02',
    })
    // The only day before today is 2026-08-01, a Saturday. monthTotal must
    // skip it outright rather than falling through to the "missed day"
    // branch and consulting nA — if it ever did, this would be -999, not 0.
    expect(total).toBe(0)
  })

  test('a failed board scores the failure value', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [played('2026-08-01', ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC'], 'SPEED')],
      system,
      playWeekends: true,
      today: '2026-08-02',
    })
    expect(total).toBe(-3)
  })

  test('when a day holds duplicate rows the first one wins, as v1 renders it', () => {
    const total = monthTotal({
      month: '2026-08',
      scores: [
        played('2026-08-01', ['SPEED'], 'SPEED'), // 5
        played('2026-08-01', ['CRANE', 'SLATE', 'SPEED'], 'SPEED'), // 2
      ],
      system,
      playWeekends: true,
      today: '2026-08-02',
    })
    expect(total).toBe(5)
  })
})

describe('winnerOf', () => {
  test('picks the highest total', () => {
    expect(winnerOf([{ playerId: 'a', total: 3 }, { playerId: 'b', total: 9 }])).toBe('b')
  })

  test('breaks a tie in favour of the first player, as v1 does', () => {
    // v1 compares with a strict > while walking players in team order, so the
    // incumbent keeps the crown on a tie.
    expect(winnerOf([{ playerId: 'a', total: 9 }, { playerId: 'b', total: 9 }])).toBe('a')
  })

  test('handles negative totals rather than defaulting to nobody', () => {
    expect(winnerOf([{ playerId: 'a', total: -8 }, { playerId: 'b', total: -3 }])).toBe('b')
  })

  test('returns null when there is nobody to win', () => {
    expect(winnerOf([])).toBeNull()
  })
})
