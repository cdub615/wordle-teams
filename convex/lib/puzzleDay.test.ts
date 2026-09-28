import { describe, expect, test } from 'vitest'
import {
  FIRST_PUZZLE_DAY,
  addDays,
  addMonths,
  daysOfMonth,
  fromPuzzleDay,
  isPlausiblePuzzleDay,
  isPlausibleToday,
  isPuzzleDay,
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

describe('isPuzzleDay', () => {
  test('accepts a real day', () => {
    expect(isPuzzleDay('2026-09-18')).toBe(true)
  })

  // The four values wordle-teams-qvqi names as storable before upsertBoardFor
  // grew its check. '' is the one that actually broke something downstream: it
  // sorts below every real day, so it became a team's earliestMonth.
  test('rejects the shapes that used to be storable', () => {
    for (const value of ['', '1', 'x', '2026', '2026-09', 'not-a-day']) {
      expect(isPuzzleDay(value)).toBe(false)
    }
  })

  // SHAPE ALONE IS NOT ENOUGH, which is the whole reason this is stricter than
  // monthWindow.ts's isMonth. Each of these matches /^\d{4}-\d{2}-\d{2}$/ and is
  // not a day — and fromPuzzleDay would silently ROLL each one over into a
  // different, real date rather than failing.
  test('rejects a well-shaped string that is not a real calendar day', () => {
    expect(isPuzzleDay('2026-02-30')).toBe(false)
    expect(isPuzzleDay('2026-13-01')).toBe(false)
    expect(isPuzzleDay('2026-00-10')).toBe(false)
    expect(isPuzzleDay('2026-09-31')).toBe(false)
    expect(isPuzzleDay('2026-09-00')).toBe(false)
  })

  // Leap years come out of the round trip for free. A hand-written table of
  // month lengths is one off-by-one from getting this wrong every four years.
  test('knows which Februaries have a 29th', () => {
    expect(isPuzzleDay('2024-02-29')).toBe(true)
    expect(isPuzzleDay('2026-02-29')).toBe(false)
  })

  test('rejects an unpadded or over-long day', () => {
    expect(isPuzzleDay('2026-8-18')).toBe(false)
    expect(isPuzzleDay('2026-09-18-00')).toBe(false)
  })

  // THE ONE THING ONLY THE `\d{4}` CATCHES, and it is the reason the pattern is
  // not redundant beside the round trip: `toPuzzleDay` pads the month and the
  // day but writes `getFullYear()` raw, so both of these round-trip to
  // THEMSELVES and pass a round-trip-only check. A three-digit year breaks the
  // property the whole module rests on — '999-12-31' sorts ABOVE every day of
  // this century, so every lexical comparison in this file reads it as the
  // future. Delete the regex and this is the test that goes red.
  test('rejects a year that is not four digits, which round-trips cleanly', () => {
    expect(isPuzzleDay('100-01-01')).toBe(false)
    expect(isPuzzleDay('999-12-31')).toBe(false)
    expect(isPuzzleDay('20260-01-01')).toBe(false)
  })
})

describe('isPlausiblePuzzleDay', () => {
  // THE CASE THE BOUND EXISTS TO ALLOW. Backfill is a supported feature, so a
  // day years behind the server's must pass — this is what stops anyone
  // "tidying" the rule into isPlausibleToday's +/-1 day window.
  test('accepts an old day, because backfill is the ordinary case', () => {
    expect(isPlausiblePuzzleDay('2023-03-14', '2026-09-18')).toBe(true)
  })

  test('accepts the first Wordle puzzle and rejects the day before it', () => {
    expect(isPlausiblePuzzleDay(FIRST_PUZZLE_DAY, '2026-09-18')).toBe(true)
    expect(isPlausiblePuzzleDay('2021-06-18', '2026-09-18')).toBe(false)
    expect(isPlausiblePuzzleDay('1000-01-01', '2026-09-18')).toBe(false)
  })

  // ONE DAY OF SLACK ON THE CEILING, for isPlausibleToday's reason: offsets span
  // UTC-12..UTC+14, so a client east of this UTC runtime is legitimately a
  // calendar day ahead of it and must still be able to file today's board.
  test('accepts today and tomorrow, and refuses the day after that', () => {
    expect(isPlausiblePuzzleDay('2026-09-18', '2026-09-18')).toBe(true)
    expect(isPlausiblePuzzleDay('2026-09-19', '2026-09-18')).toBe(true)
    expect(isPlausiblePuzzleDay('2026-09-20', '2026-09-18')).toBe(false)
  })

  test('a malformed day fails the range check too', () => {
    expect(isPlausiblePuzzleDay('', '2026-09-18')).toBe(false)
    // In range lexically, and not a day.
    expect(isPlausiblePuzzleDay('2026-02-30', '2026-09-18')).toBe(false)
  })
})

describe('monthContainsToday', () => {
  test('true when the day falls inside the month', () => {
    expect(monthContainsToday('2026-09', '2026-09-04')).toBe(true)
  })

  // monthContainsToday is a single string equality on the sliced month — there
  // is no day-level range logic here for a mutant to move. This pins that
  // every day in the month is treated alike, which would catch an
  // implementation that reached for date arithmetic or a range comparison
  // instead of a month-prefix compare.
  test('every day in the month is treated alike, first and last included', () => {
    expect(monthContainsToday('2026-09', '2026-09-01')).toBe(true)
    expect(monthContainsToday('2026-09', '2026-09-30')).toBe(true)
  })

  test('false for the month before and the month after', () => {
    expect(monthContainsToday('2026-09', '2026-08-31')).toBe(false)
    expect(monthContainsToday('2026-09', '2026-10-01')).toBe(false)
  })

  // Pins that the comparison includes the year, not just the month: a
  // same-month-different-year day is not "today". An implementation that
  // compared only the month portion (e.g. slice(5, 7)) would wrongly pass
  // this as true.
  test('the same month a year apart is not today', () => {
    expect(monthContainsToday('2026-09', '2025-09-04')).toBe(false)
  })
})
