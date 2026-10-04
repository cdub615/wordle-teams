/**
 * WHY THESE CASES. A threshold tested in one direction is vacuous, so both sides
 * of SHORT_WINDOW_DAYS are asserted. Both lastDayOf call sites (the same-month
 * branch and the following-month branch) are covered with real month lengths,
 * so substituting monthRange(month).end on either branch fails.
 */
import { describe, expect, test } from 'vitest'
import {
  MAX_ACTIVE_CHALLENGES,
  MIN_CHALLENGE_BOARDS,
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
    expect(totals.boards).not.toBe(4)
  })

  test('splits totals per player', () => {
    const totals = teamTotalsOver(days, '2026-10-05', '2026-10-31')
    expect(totals.members).toEqual(
      expect.arrayContaining([
        { playerId: 'a', boards: 1, attempts: 4 },
        { playerId: 'b', boards: 2, attempts: 9 },
      ]),
    )
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
    expect(totals.attempts).toBe(12)
  })
})
