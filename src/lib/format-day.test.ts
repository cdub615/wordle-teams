import { describe, expect, test } from 'vitest'
import { formatDayHeaderParts, formatMonthLabel, ordinal, formatInstantLabel, formatDayLabel } from './format-day'

describe('ordinal', () => {
  test('handles the irregular ones', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
  })

  test('handles the teens, which are all th', () => {
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
  })

  test('handles the twenties and thirties', () => {
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(23)).toBe('23rd')
    expect(ordinal(31)).toBe('31st')
  })
})

describe('formatDayHeaderParts', () => {
  test('splits into weekday and ordinal, matching v1\'s EE do pieces', () => {
    // 2026-08-03 is a Monday.
    expect(formatDayHeaderParts('2026-08-03')).toEqual({ weekday: 'Mon', ordinal: '3rd' })
  })

  test('carries the ordinal teen exceptions through (11th/12th/13th)', () => {
    // 2026-08-03 is a Monday, so the 11th/12th/13th fall on Tue/Wed/Thu.
    expect(formatDayHeaderParts('2026-08-11')).toEqual({ weekday: 'Tue', ordinal: '11th' })
    expect(formatDayHeaderParts('2026-08-12')).toEqual({ weekday: 'Wed', ordinal: '12th' })
    expect(formatDayHeaderParts('2026-08-13')).toEqual({ weekday: 'Thu', ordinal: '13th' })
  })

  test('carries the regular 1st/2nd/3rd pattern through', () => {
    // The 1st/2nd/3rd of August 2026 are Sat/Sun/Mon.
    expect(formatDayHeaderParts('2026-08-01')).toEqual({ weekday: 'Sat', ordinal: '1st' })
    expect(formatDayHeaderParts('2026-08-02')).toEqual({ weekday: 'Sun', ordinal: '2nd' })
    expect(formatDayHeaderParts('2026-08-03')).toEqual({ weekday: 'Mon', ordinal: '3rd' })
  })
})

describe('formatMonthLabel', () => {
  test('matches v1 formatting, MMM yyyy', () => {
    expect(formatMonthLabel('2026-08')).toBe('Aug 2026')
  })
})

describe('formatInstantLabel', () => {
  test('renders an epoch instant as a long calendar date', () => {
    // 2026-10-30T00:00:00Z — the first trials stamped on launch day expire here
    // (LAUNCH_AT 2026-09-30 + INSIGHTS_TRIAL_DAYS 30).
    expect(formatInstantLabel(Date.UTC(2026, 9, 30))).toBe('October 30, 2026')
  })

  test('spells the month out, matching formatDayLabel rather than the picker', () => {
    // formatMonthLabel is 'Oct 2026' and is a DIFFERENT formatter. This one
    // shares longDay with formatDayLabel, so the two agree on the same day.
    expect(formatInstantLabel(Date.UTC(2026, 0, 1))).toBe('January 1, 2026')
  })

  test('agrees with formatDayLabel on the same calendar day', () => {
    // The property that stops a second formatter drifting from the first: both
    // read the shared `longDay` instance rather than each constructing options.
    expect(formatInstantLabel(Date.UTC(2026, 8, 20))).toBe(formatDayLabel('2026-09-20'))
  })
})
