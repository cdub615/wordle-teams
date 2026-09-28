import { describe, expect, test } from 'vitest'
import { pickDefaultDay } from './pick-default-day.ts'
import { daysOfMonth, isWeekendDay } from '../../../convex/lib/puzzleDay.ts'

// August 2026: the 1st and 2nd are Sat/Sun, the 3rd is a Monday.
describe('pickDefaultDay', () => {
  test('defaults to today when it is in the requested month and playable', () => {
    expect(
      pickDefaultDay({
        month: '2026-08',
        today: '2026-08-05',
        playedDays: new Set(),
        playWeekends: true,
      }),
    ).toBe('2026-08-05')
  })

  test('does not select a disabled weekend, even when it is today', () => {
    // Regression for the bug the quality review caught: a playWeekends:false
    // team opening board entry on a Saturday used to get handed that Saturday
    // as the default — a day the date picker itself renders disabled.
    const result = pickDefaultDay({
      month: '2026-08',
      today: '2026-08-01', // a Saturday
      playedDays: new Set(),
      playWeekends: false,
    })
    expect(result).not.toBe('2026-08-01')
    expect(result).toBe('2026-08-03') // first playable (weekday) day of the month
  })

  test('a past month picks the first unplayed, playable day', () => {
    const result = pickDefaultDay({
      month: '2026-08',
      today: '2026-09-15',
      playedDays: new Set(['2026-08-03', '2026-08-04']),
      playWeekends: false,
    })
    expect(result).toBe('2026-08-05')
  })

  test('the fallback itself is weekend-filtered, not just the primary candidate search', () => {
    // January 2026's literal last calendar day (the 31st) is a Saturday. Every
    // playable (weekday) day in the month has already been played, so this
    // must fall back to the last WEEKDAY, never the literal last day of the
    // month just because playedDays.has() didn't happen to cover it.
    const month = '2026-01'
    const playedDays = new Set(daysOfMonth(month).filter((day) => !isWeekendDay(day)))
    const result = pickDefaultDay({ month, today: '2026-02-15', playedDays, playWeekends: false })
    expect(isWeekendDay(result)).toBe(false)
    expect(result).toBe('2026-01-30') // the last Friday, not the 31st (a Saturday)
  })

  test('every playable day already played falls back to the last playable day', () => {
    const month = '2026-08'
    const playedDays = new Set(daysOfMonth(month))
    const result = pickDefaultDay({ month, today: '2026-09-15', playedDays, playWeekends: true })
    expect(result).toBe('2026-08-31')
  })
})
