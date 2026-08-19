import { describe, expect, test } from 'vitest'
import { monthOptions } from './month-picker'

describe('monthOptions', () => {
  test('returns exactly three months, ascending, ending at the month passed in', () => {
    expect(monthOptions('2026-08')).toEqual(['2026-06', '2026-07', '2026-08'])
  })

  test('walks back correctly across a year boundary', () => {
    expect(monthOptions('2026-01')).toEqual(['2025-11', '2025-12', '2026-01'])
  })
})
