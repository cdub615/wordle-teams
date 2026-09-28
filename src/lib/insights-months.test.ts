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
    // Literal, not built from addMonths -- a test that recomputes the answer
    // the same way the source does would not catch the source getting it
    // wrong. Full array, not just the endpoints, so a mutant that corrupts
    // one of the middle ten months cannot hide between two correct edges.
    expect(teamMonthOptions(CURRENT, at(2020, 1, 1))).toEqual([
      '2026-09',
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
      '2025-10',
    ])
  })

  /**
   * THE CAP COUNTS THE CURRENT MONTH -- the single most likely thing to get
   * wrong if `CAP` is ever changed. Twelve months means this month plus the
   * eleven before it, so the earliest reachable month is eleven months back
   * (2025-10), not twelve. A team created exactly twelve months back is
   * already one month past that floor, and one created thirteen months back
   * is further still -- both get clamped to the identical 12-month array,
   * which is the behaviour this documents.
   */
  test('created 12 months back or 13 months back both hit the same capped floor', () => {
    const capped = [
      '2026-09',
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
      '2025-10',
    ]
    expect(teamMonthOptions(CURRENT, at(2025, 9, 20))).toEqual(capped)
    expect(teamMonthOptions(CURRENT, at(2025, 8, 20))).toEqual(capped)
  })

  /**
   * `undefined` is rare, not the common case -- a migrated team's v1
   * `created_at` defaulted to `now()` on insert (src/app/me/actions.ts never
   * supplies one), so most migrated teams DO carry a date, and the copy
   * script forwards it. What is actually being covered here is that the
   * schema field is `v.optional` and getMyTeams refuses to substitute a
   * stand-in, so a NULL that slipped through, or any future row written
   * without one, must be handled rather than crash. Without a known creation
   * month there is no floor to apply, so the full cap is the only answer that
   * does not silently hide months such a team might actually have data in.
   */
  test('createdAt undefined (a NULL that slipped through, not the typical case) gets the full 12', () => {
    // Literal for the same reason as the "older than the cap" case above:
    // the full array, not just the endpoints.
    expect(teamMonthOptions(CURRENT)).toEqual([
      '2026-09',
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
      '2025-10',
    ])
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

  /**
   * THE CURRENT MONTH IS ALWAYS THE FIRST OPTION, WHATEVER `createdAt` SAYS.
   * Every case above pins a concrete array, so this property follows from
   * them -- but it is never named by them, and a change that dropped the
   * current month for one kind of team would break it while leaving most of
   * those arrays plausible.
   *
   * It is named here because insights-search.ts's resolveInsightsSearch
   * depends on it to terminate: it falls back to `currentMonth` when a
   * `?month=` is not in this list, and that only settles because the fallback
   * is itself always in the list. If this test ever fails, do not relax it --
   * the effect that consumes that resolver will navigate forever.
   */
  test('the current month is always the first option, for every createdAt', () => {
    expect(teamMonthOptions(CURRENT)[0]).toBe(CURRENT) // absent
    expect(teamMonthOptions(CURRENT, at(2026, 9, 5))[0]).toBe(CURRENT) // created this month
    expect(teamMonthOptions(CURRENT, at(2026, 6, 12))[0]).toBe(CURRENT) // inside the cap
    expect(teamMonthOptions(CURRENT, at(2020, 1, 1))[0]).toBe(CURRENT) // older than the cap
    expect(teamMonthOptions(CURRENT, at(2027, 3, 4))[0]).toBe(CURRENT) // future, clock skew
  })

  test('is always newest first', () => {
    const options = teamMonthOptions(CURRENT, at(2026, 5, 1))
    expect(options).toEqual([...options].sort().reverse())
  })
})
