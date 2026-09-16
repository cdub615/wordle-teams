import { describe, expect, test } from 'vitest'
import { teamMonthOptions } from './insights-months'

const CURRENT = '2026-09'

/** Epoch millis for local noon on the given puzzle day, matching fromPuzzleDay. */
const at = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12).getTime()

describe('teamMonthOptions', () => {
  test('a team created this month has one option: the current month', () => {
    expect(teamMonthOptions(CURRENT, at(2026, 9, 5))).toEqual(['2026-09'])
  })

  test('a team created three months ago has four options, newest first', () => {
    expect(teamMonthOptions(CURRENT, at(2026, 6, 12))).toEqual([
      '2026-09',
      '2026-08',
      '2026-07',
      '2026-06',
    ])
  })

  test('a team older than the cap is capped at 12, not the true age', () => {
    const options = teamMonthOptions(CURRENT, at(2020, 1, 1))
    expect(options).toHaveLength(12)
    expect(options[0]).toBe('2026-09')
    expect(options[11]).toBe('2025-10')
  })

  /**
   * Every v1-migrated team has a nullable created_at, so `undefined` is a
   * routine state rather than a defensive check. Without a known creation
   * month there is no floor to apply, so the full cap is the only answer that
   * does not silently hide months a migrated team might actually have data
   * in.
   */
  test('createdAt undefined (a v1-migrated team) gets the full 12', () => {
    const options = teamMonthOptions(CURRENT)
    expect(options).toHaveLength(12)
    expect(options[0]).toBe('2026-09')
    expect(options[11]).toBe('2025-10')
  })

  /**
   * A createdAt in the future (clock skew, bad data) must not produce a
   * negative-length or empty list. It clamps to just the current month —
   * the same shape as "created this month" — rather than propagating the
   * bad input into a broken range.
   */
  test('a createdAt in the future clamps to one option: the current month', () => {
    expect(teamMonthOptions(CURRENT, at(2026, 12, 1))).toEqual(['2026-09'])
  })

  test('is always newest first', () => {
    const options = teamMonthOptions(CURRENT, at(2026, 5, 1))
    expect(options).toEqual([...options].sort().reverse())
  })
})
