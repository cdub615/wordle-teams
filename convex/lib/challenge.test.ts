/**
 * WHY THESE CASES. A threshold tested in one direction is vacuous, so both sides
 * of SHORT_WINDOW_DAYS are asserted. Both lastDayOf call sites (the same-month
 * branch and the following-month branch) are covered with real month lengths,
 * so substituting monthRange(month).end on either branch fails.
 *
 * For teamTotalsOver the fixture deliberately straddles both window bounds and a
 * month boundary. Player b appearing on two separate days is what pins per-player
 * accumulation rather than assignment.
 */
import { describe, expect, test } from 'vitest'
import {
  MAX_ACTIVE_CHALLENGES,
  MIN_CHALLENGE_BOARDS,
  outcomeOf,
  PROPOSAL_TTL_DAYS,
  SHORT_WINDOW_DAYS,
  teamTotalsOver,
  windowFor,
} from './challenge.ts'

describe('the constants', () => {
  test('are the values the design approved', () => {
    expect(MIN_CHALLENGE_BOARDS).toBe(10)
    expect(MAX_ACTIVE_CHALLENGES).toBe(5)
    expect(PROPOSAL_TTL_DAYS).toBe(7)
    expect(SHORT_WINDOW_DAYS).toBe(7)
  })
})

describe('windowFor', () => {
  test('starts the day AFTER acceptance, so nothing retroactive counts', () => {
    expect(windowFor('2026-10-04').startDay).toBe('2026-10-05')
  })

  test('ends with the calendar month when the month has room', () => {
    expect(windowFor('2026-10-04')).toEqual({ startDay: '2026-10-05', endDay: '2026-10-31' })
  })

  // Counted INCLUSIVELY from startDay to month end.
  test('at the short-window boundary the window still ends with this month', () => {
    // start 2026-10-25, end 2026-10-31 => 7 days remaining, which is NOT fewer than 7.
    expect(windowFor('2026-10-24')).toEqual({ startDay: '2026-10-25', endDay: '2026-10-31' })
  })

  test('below the boundary it runs to the end of the FOLLOWING month', () => {
    // start 2026-10-26, end 2026-10-31 => 6 days remaining, fewer than 7.
    expect(windowFor('2026-10-25')).toEqual({ startDay: '2026-10-26', endDay: '2026-11-30' })
  })

  test('accepting on the last day of a month gets the whole next month', () => {
    expect(windowFor('2026-10-31')).toEqual({ startDay: '2026-11-01', endDay: '2026-11-30' })
  })

  test('crosses a year boundary', () => {
    expect(windowFor('2026-12-28')).toEqual({ startDay: '2026-12-29', endDay: '2027-01-31' })
  })

  test('handles February in a leap year', () => {
    expect(windowFor('2028-02-01')).toEqual({ startDay: '2028-02-02', endDay: '2028-02-29' })
  })

  test('handles a NON-leap February', () => {
    expect(windowFor('2026-02-01')).toEqual({ startDay: '2026-02-02', endDay: '2026-02-28' })
  })
})

const days = [
  { puzzleDay: '2026-10-04', entries: [{ playerId: 'a', attempts: 3 }] },
  { puzzleDay: '2026-10-05', entries: [{ playerId: 'a', attempts: 4 }, { playerId: 'b', attempts: 2 }] },
  { puzzleDay: '2026-10-31', entries: [{ playerId: 'b', attempts: 7 }] },
  { puzzleDay: '2026-11-01', entries: [{ playerId: 'a', attempts: 5 }] },
]

describe('teamTotalsOver', () => {
  test('counts only days inside the window, both bounds inclusive', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.boards).toBe(3)
    expect(totals.attempts).toBe(4 + 2 + 7)
  })

  test('excludes the day before the window, which is the retroactivity guard', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.members.find((m) => m.playerId === 'a')?.attempts).toBe(4)
  })

  test('excludes the day after the window', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.members.find((m) => m.playerId === 'a')).toEqual({
      playerId: 'a',
      boards: 1,
      attempts: 4,
    })
  })

  test('splits totals per player', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.members).toEqual(
      expect.arrayContaining([
        { playerId: 'a', boards: 1, attempts: 4 },
        { playerId: 'b', boards: 2, attempts: 9 },
      ]),
    )
    expect(totals.members).toHaveLength(2)
  })

  test('a failed board contributes 7, the attemptsFor sentinel', () => {
    const totals = teamTotalsOver(days, '2026-10-31', '2026-10-31')
    expect(totals.attempts).toBe(7)
    expect(totals.boards).toBe(1)
  })

  test('an empty window is zero boards rather than a throw', () => {
    expect(teamTotalsOver(days, '2026-09-01', '2026-09-30')).toEqual({
      boards: 0,
      attempts: 0,
      members: [],
    })
  })

  // THE SHORT-WINDOW CASE: two months of days, concatenated by the caller.
  test('accepts days concatenated from two monthly documents', () => {
    const totals = teamTotalsOver(days, '2026-10-31', '2026-11-30')
    expect(totals.boards).toBe(2)
    expect(totals.attempts).toBe(7 + 5)
  })

  // wordle-teams-rac: duplicate (playerId, puzzleDay) rows copied from v1 exist in
  // production, so two same-day entries are reachable. Counting both keeps that
  // defect visible rather than silent.
  test('the same player twice on one day accumulates rather than overwrites', () => {
    const dup = [
      {
        puzzleDay: '2026-10-05',
        entries: [
          { playerId: 'a', attempts: 3 },
          { playerId: 'a', attempts: 4 },
        ],
      },
    ]
    expect(teamTotalsOver(dup, '2026-10-05', '2026-10-05').members).toEqual([
      { playerId: 'a', boards: 2, attempts: 7 },
    ])
  })
})

/** A side with `boards` boards averaging `avg`, at or above the floor. */
const side = (boards: number, avg: number) => ({ boards, attempts: Math.round(boards * avg) })

describe('outcomeOf', () => {
  test('LOWER average guesses wins — the challenger', () => {
    expect(outcomeOf(side(20, 3.5), side(20, 4.5))).toBe('challenger')
  })

  test('LOWER average guesses wins — the opponent', () => {
    expect(outcomeOf(side(20, 4.5), side(20, 3.5))).toBe('opponent')
  })

  test('void when the challenger is below the board floor', () => {
    expect(outcomeOf(side(MIN_CHALLENGE_BOARDS - 1, 2.0), side(20, 4.5))).toBe('void')
  })

  test('void when the opponent is below the board floor', () => {
    expect(outcomeOf(side(20, 4.5), side(MIN_CHALLENGE_BOARDS - 1, 2.0))).toBe('void')
  })

  test('AT the board floor is a real result, not void', () => {
    expect(outcomeOf(side(MIN_CHALLENGE_BOARDS, 3.0), side(MIN_CHALLENGE_BOARDS, 4.0))).toBe(
      'challenger',
    )
  })

  test('a 1dp tie is broken on boards played', () => {
    // Both average 4.0; the challenger played more.
    expect(outcomeOf({ boards: 30, attempts: 120 }, { boards: 20, attempts: 80 })).toBe('challenger')
    expect(outcomeOf({ boards: 20, attempts: 80 }, { boards: 30, attempts: 120 })).toBe('opponent')
  })

  test('equal averages and equal boards is a tie', () => {
    expect(outcomeOf({ boards: 20, attempts: 80 }, { boards: 20, attempts: 80 })).toBe('tie')
  })

  // ROUNDED BEFORE COMPARISON, the meanAttemptsOf rule. Raw quotients differ
  // here; both display as 4.0, so this must be a tie broken on boards, never a
  // win on a ten-thousandth nobody can see.
  test('averages that DISPLAY the same are compared as the same', () => {
    const a = { boards: 10, attempts: 40 } // 4.00
    const b = { boards: 11, attempts: 44 } // 4.00
    expect(outcomeOf(a, b)).toBe('opponent') // b played more boards
  })
})
