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
