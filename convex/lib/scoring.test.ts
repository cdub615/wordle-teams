import { describe, expect, test } from 'vitest'
import { attemptsFor } from './board.ts'
import { createRng } from './clueLadder/rng.ts'
import { daysOfMonth, isWeekendDay } from './puzzleDay.ts'
import {
  monthTotal,
  pointsFor,
  winnerOf,
  wordleDays,
  type ScoredDay,
  type ScoringSystem,
} from './scoring'

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
      days: wordleDays([
        played('2026-08-03', ['SPEED'], 'SPEED'), // 1 attempt -> 5
        played('2026-08-04', ['CRANE', 'SPEED'], 'SPEED'), // 2 -> 3
      ]),
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
      days: [],
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
      days: [],
      system: { ...system, nA: -2 },
      playWeekends: true,
      today: '2026-08-01',
    })
    expect(total).toBe(0)
  })

  test('weekends are skipped entirely when the team does not play them', () => {
    const total = monthTotal({
      month: '2026-08',
      days: [],
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
      days: [],
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
      days: wordleDays([played('2026-08-01', ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC'], 'SPEED')]),
      system,
      playWeekends: true,
      today: '2026-08-02',
    })
    expect(total).toBe(-3)
  })

  test('when a day holds duplicate rows the first one wins, as v1 renders it', () => {
    const total = monthTotal({
      month: '2026-08',
      days: wordleDays([
        played('2026-08-01', ['SPEED'], 'SPEED'), // 5
        played('2026-08-01', ['CRANE', 'SLATE', 'SPEED'], 'SPEED'), // 2
      ]),
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

  test('a non-empty list where everyone totals 0 still has a winner', () => {
    // Null means an EMPTY candidate list, not "everyone scored zero" — see the
    // doc comment above. This is what removeMemberFor's recompute test in
    // teams.test.ts relies on: the sole remaining member wins at 0 rather than
    // the row being deleted.
    expect(winnerOf([{ playerId: 'a', total: 0 }, { playerId: 'b', total: 0 }])).toBe('a')
  })
})

// monthTotal as it stood before it took attempts (wordle-teams-9j7o.2.2). Frozen
// here so the refactor is measured against the old behaviour, not against itself.
function legacyMonthTotal(opts: {
  month: string
  scores: Array<ScoredDay>
  system: ScoringSystem
  playWeekends: boolean
  today: string
}): number {
  const { month, scores, system, playWeekends, today } = opts
  const byDay = new Map<string, ScoredDay>()
  for (const score of scores) {
    if (!byDay.has(score.puzzleDay)) byDay.set(score.puzzleDay, score)
  }
  return daysOfMonth(month).reduce((total, day) => {
    if (!playWeekends && isWeekendDay(day)) return total
    const score = byDay.get(day)
    if (score) return total + pointsFor(attemptsFor(score.guesses, score.answer ?? ''), system)
    if (day < today) return total + system.nA
    return total
  }, 0)
}

describe('monthTotal over attempts', () => {
  const WORDS = ['SPEED', 'CRANE', 'SLATE', 'TRICE', 'MOUND', 'PLUMB', 'GHOST']

  // 500 random months of Wordle boards: wins on every guess count, six-guess
  // losses, duplicate rows for one day, missing answers, weekends on and off.
  test('Wordle totals are identical to the frozen pre-refactor function', () => {
    const rng = createRng(20261014)
    for (let i = 0; i < 500; i++) {
      const month = `2026-${String(rng.int(12) + 1).padStart(2, '0')}`
      const days = daysOfMonth(month)
      const scores: Array<ScoredDay> = []
      for (let n = rng.int(40); n > 0; n--) {
        const answer = rng.pick(WORDS)
        const length = rng.int(6) + 1
        const guesses = Array.from({ length }, () => rng.pick(WORDS))
        scores.push({ puzzleDay: rng.pick(days), guesses, answer: rng.int(10) === 0 ? undefined : answer })
      }
      const opts = {
        month,
        system,
        playWeekends: rng.int(2) === 0,
        today: rng.pick(days),
      }
      expect(monthTotal({ ...opts, days: wordleDays(scores) })).toBe(legacyMonthTotal({ ...opts, scores }))
    }
  })

  test('takes any game’s attempts, with 7 scoring the failure value', () => {
    const total = monthTotal({
      month: '2026-08',
      days: [
        { puzzleDay: '2026-08-03', attempts: 4 },
        { puzzleDay: '2026-08-04', attempts: 7 },
      ],
      system,
      playWeekends: false,
      today: '2026-08-05',
    })
    // 3rd: 4 attempts -> 1. 4th: failed -> -3. 1st and 2nd are a skipped weekend.
    expect(total).toBe(-2)
  })

  test('wordleDays keeps row order, so the first row for a day still wins', () => {
    expect(
      wordleDays([
        { puzzleDay: '2026-08-03', guesses: ['SPEED'], answer: 'SPEED' },
        { puzzleDay: '2026-08-03', guesses: ['CRANE', 'SPEED'], answer: 'SPEED' },
      ]),
    ).toEqual([
      { puzzleDay: '2026-08-03', attempts: 1 },
      { puzzleDay: '2026-08-03', attempts: 2 },
    ])
  })
})

describe('monthTotal from a day (wordle-teams-k1v5)', () => {
  const missed = { ...system, nA: -2 }

  test('an empty day before fromDay scores nothing; a result before it still counts', () => {
    const total = monthTotal({
      month: '2026-08',
      days: [
        { puzzleDay: '2026-08-03', attempts: 1 }, // before fromDay, and it counts
        { puzzleDay: '2026-08-05', attempts: 7 },
      ],
      system: missed,
      playWeekends: true,
      today: '2026-08-07',
      fromDay: '2026-08-05',
    })
    // 3rd: a 1. 5th: X. 6th: empty, on/after fromDay, so missed.
    // 1st, 2nd and 4th: empty and before fromDay, so nothing.
    expect(total).toBe(missed.oneGuess + missed.failed + missed.nA)
  })

  test('an empty past day on or after fromDay is still a missed day', () => {
    const opts = { month: '2026-08', days: [], system: missed, playWeekends: true, today: '2026-08-07' }
    // 5th and 6th are past and empty: two missed days.
    expect(monthTotal({ ...opts, fromDay: '2026-08-05' })).toBe(2 * missed.nA)
  })

  test('a fromDay after today leaves the month at zero', () => {
    expect(
      monthTotal({ month: '2026-08', days: [], system: missed, playWeekends: true, today: '2026-08-07', fromDay: '2026-08-20' }),
    ).toBe(0)
  })

  test('a fromDay before the month changes nothing', () => {
    const opts = { month: '2026-08', days: [], system: missed, playWeekends: true, today: '2026-08-07' }
    expect(monthTotal({ ...opts, fromDay: '2026-07-01' })).toBe(monthTotal(opts))
  })
})
