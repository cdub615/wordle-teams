import { describe, expect, test } from 'vitest'
import { formatDayHeader, formatMonthLabel, ordinal } from './format-day'

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

describe('formatDayHeader', () => {
  test('matches v1 formatting, EE do', () => {
    // 2026-08-03 is a Monday.
    expect(formatDayHeader('2026-08-03')).toBe('Mon 3rd')
  })
})

describe('formatMonthLabel', () => {
  test('matches v1 formatting, MMM yyyy', () => {
    expect(formatMonthLabel('2026-08')).toBe('Aug 2026')
  })
})
