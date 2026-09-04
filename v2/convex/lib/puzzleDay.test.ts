import { describe, expect, test } from 'vitest'
import {
  addDays,
  addMonths,
  daysOfMonth,
  fromPuzzleDay,
  isPlausibleToday,
  isWeekendDay,
  monthContainsToday,
  monthOf,
  monthRange,
  toPuzzleDay,
} from './puzzleDay'

describe('toPuzzleDay', () => {
  test('uses local calendar fields, not UTC', () => {
    // 2026-08-18 at 23:30 local. getUTC* would roll this to the 19th east of
    // Greenwich and to the 18th west of it; the local fields never do.
    expect(toPuzzleDay(new Date(2026, 7, 18, 23, 30))).toBe('2026-08-18')
  })

  test('zero-pads single-digit months and days', () => {
    expect(toPuzzleDay(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('fromPuzzleDay', () => {
  test('round-trips through local noon so DST cannot shift the day', () => {
    expect(toPuzzleDay(fromPuzzleDay('2026-03-08'))).toBe('2026-03-08')
    expect(fromPuzzleDay('2026-03-08').getHours()).toBe(12)
  })
})

describe('monthOf and monthRange', () => {
  test('monthOf slices the month off a day', () => {
    expect(monthOf('2026-08-18')).toBe('2026-08')
  })

  test('monthRange bounds sort correctly against every real day', () => {
    const { start, end } = monthRange('2026-02')
    expect(start).toBe('2026-02-01')
    // '-31' is a lexicographic upper bound, not a real date. February has no
    // 31st, and the index range query never needs it to.
    expect('2026-02-28' <= end).toBe(true)
    expect('2026-03-01' <= end).toBe(false)
  })
})

describe('daysOfMonth', () => {
  test('knows month lengths including leap years', () => {
    expect(daysOfMonth('2026-02')).toHaveLength(28)
    expect(daysOfMonth('2024-02')).toHaveLength(29)
    expect(daysOfMonth('2026-08')).toHaveLength(31)
    expect(daysOfMonth('2026-09')).toHaveLength(30)
  })

  test('returns padded day strings in order', () => {
    const days = daysOfMonth('2026-08')
    expect(days[0]).toBe('2026-08-01')
    expect(days[8]).toBe('2026-08-09')
    expect(days[30]).toBe('2026-08-31')
  })
})

describe('isWeekendDay', () => {
  test('identifies Saturday and Sunday', () => {
    expect(isWeekendDay('2026-08-15')).toBe(true) // Saturday
    expect(isWeekendDay('2026-08-16')).toBe(true) // Sunday
    expect(isWeekendDay('2026-08-17')).toBe(false) // Monday
  })
})

describe('addDays', () => {
  test('walks forwards and backwards across a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
  })

  test('handles a leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
  })

  test('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('addMonths', () => {
  test('walks backwards across a year boundary', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-01', -2)).toBe('2025-11')
  })

  test('walks forwards', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01')
  })
})

describe('isPlausibleToday', () => {
  test('accepts an exact match with the server date', () => {
    expect(isPlausibleToday('2026-06-08', '2026-06-08')).toBe(true)
  })

  test('accepts one day either side of the server date', () => {
    expect(isPlausibleToday('2026-06-07', '2026-06-08')).toBe(true)
    expect(isPlausibleToday('2026-06-09', '2026-06-08')).toBe(true)
  })

  test('rejects two days either side of the server date', () => {
    expect(isPlausibleToday('2026-06-06', '2026-06-08')).toBe(false)
    expect(isPlausibleToday('2026-06-10', '2026-06-08')).toBe(false)
  })
})

describe('monthContainsToday', () => {
  test('true when the day falls inside the month', () => {
    expect(monthContainsToday('2026-09', '2026-09-04')).toBe(true)
  })

  test('true on the first and last day, which are the boundaries a mutant moves', () => {
    expect(monthContainsToday('2026-09', '2026-09-01')).toBe(true)
    expect(monthContainsToday('2026-09', '2026-09-30')).toBe(true)
  })

  test('false for the month before and the month after', () => {
    expect(monthContainsToday('2026-09', '2026-08-31')).toBe(false)
    expect(monthContainsToday('2026-09', '2026-10-01')).toBe(false)
  })

  // A string compare of '2026-9' against '2026-09' would pass the happy path
  // and fail here. monthOf slices, so this pins that it keeps the zero pad.
  test('the same month a year apart is not today', () => {
    expect(monthContainsToday('2026-09', '2025-09-04')).toBe(false)
  })
})
