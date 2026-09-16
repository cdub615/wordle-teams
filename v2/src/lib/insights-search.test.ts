import { describe, expect, test } from 'vitest'
import { resolveInsightsSearch } from './insights-search.ts'

const CURRENT = '2026-09'

/** Epoch millis for local noon on the given day, matching fromPuzzleDay. */
const at = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12).getTime()

/**
 * Two teams with deliberately different windows: 'a' was created well inside
 * the 12-month cap (so 2026-07 is selectable for it) and 'b' was created this
 * month (so 2026-09 is the ONLY month selectable for it). Every month literal
 * below is written out rather than derived from `teamMonthOptions`, so a test
 * cannot agree with a broken source by making the same mistake twice.
 */
const teams = [
  { id: 'a', createdAt: at(2026, 6, 12) },
  { id: 'b', createdAt: at(2026, 9, 2) },
]

describe('resolveInsightsSearch', () => {
  test('returns null when both params are already valid — no navigation', () => {
    expect(
      resolveInsightsSearch({
        teamParam: 'a',
        monthParam: '2026-07',
        teams,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toBeNull()
  })

  test('fills in the current month when only the team is set', () => {
    expect(
      resolveInsightsSearch({
        teamParam: 'a',
        monthParam: undefined,
        teams,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'a', month: '2026-09' })
  })

  /**
   * A VALID `?team=` OUTRANKS A DIFFERENT REMEMBERED TEAM. The URL is the
   * more specific request — a shared link, or a pick not yet written back to
   * localStorage — so the stored preference must not win over it.
   *
   * THE MONTH MUST STILL BE MISSING FOR THIS TO TEST ANYTHING. With both
   * params already settled the function returns null before the fallback
   * order is consulted at all, which is exactly how an inverted order
   * (stored team first, param second) hides from every other case in this
   * file — including the "prefers the stored team" one directly below, which
   * it would also pass.
   */
  test('a valid team param beats a different stored team', () => {
    expect(
      resolveInsightsSearch({
        teamParam: 'a',
        monthParam: undefined,
        teams,
        storedTeam: 'b',
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'a', month: '2026-09' })
  })

  test('prefers the stored team when the URL has none', () => {
    expect(
      resolveInsightsSearch({
        teamParam: undefined,
        monthParam: '2026-09',
        teams,
        storedTeam: 'b',
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'b', month: '2026-09' })
  })

  test('falls back to the first team when the stored team is not one of yours', () => {
    expect(
      resolveInsightsSearch({
        teamParam: undefined,
        monthParam: '2026-09',
        teams,
        storedTeam: 'gone',
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'a', month: '2026-09' })
  })

  test('treats a team you are not on as if it were missing — a stale bookmark', () => {
    expect(
      resolveInsightsSearch({
        teamParam: 'gone',
        monthParam: '2026-09',
        teams,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'a', month: '2026-09' })
  })

  test('returns null when there is no team to select at all', () => {
    expect(
      resolveInsightsSearch({
        teamParam: undefined,
        monthParam: undefined,
        teams: [],
        storedTeam: 'b',
        currentMonth: CURRENT,
      }),
    ).toBeNull()
  })

  /**
   * ONE RULE COVERS MALFORMED, FUTURE AND TOO-OLD MONTHS: membership of the
   * team's window. Each of these is a distinct way a `?month=` can be wrong,
   * and none of them may survive into the URL.
   */
  test('a malformed month falls back to the current month', () => {
    expect(
      resolveInsightsSearch({
        teamParam: 'a',
        monthParam: 'not-a-month',
        teams,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'a', month: '2026-09' })
  })

  test('a future month falls back to the current month', () => {
    expect(
      resolveInsightsSearch({
        teamParam: 'a',
        monthParam: '2026-10',
        teams,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'a', month: '2026-09' })
  })

  test('a month older than the 12-month cap falls back to the current month', () => {
    expect(
      resolveInsightsSearch({
        teamParam: 'a',
        monthParam: '2024-01',
        teams,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'a', month: '2026-09' })
  })

  /**
   * THE WINDOW BELONGS TO THE RESOLVED TEAM, NOT TO THE APP. 2026-07 is a
   * perfectly good month for team 'a' (asserted valid above) and an
   * impossible one for team 'b', which did not exist yet — so the same
   * `?month=` must survive for one and be corrected for the other. A source
   * that checked the month against a team-independent window would pass every
   * other test in this file and fail this one.
   */
  test('the same month is kept for an older team and corrected for a newer one', () => {
    expect(
      resolveInsightsSearch({
        teamParam: 'b',
        monthParam: '2026-07',
        teams,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'b', month: '2026-09' })
  })

  /**
   * The month is checked against the window of the team that was RESOLVED,
   * not the one the URL asked for. Here the URL's team is a stale id, so the
   * answer is team 'a' — and 2026-07 is inside 'a''s window, so it survives.
   */
  test('the month is judged against the resolved team, not the requested one', () => {
    expect(
      resolveInsightsSearch({
        teamParam: 'gone',
        monthParam: '2026-07',
        teams,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'a', month: '2026-07' })
  })

  /**
   * A TEAM WHOSE `createdAt` IS ABSENT MUST NOT CRASH OR COLLAPSE ITS WINDOW.
   * The schema makes the field optional, so a team can legitimately arrive
   * with no creation date; it gets the full cap, which means an old month is
   * still selectable for it.
   */
  test('a team with no createdAt gets the full window rather than only this month', () => {
    const undated = [{ id: 'c' }]
    // Inside the full 12-month cap: accepted as it stands, nothing to do.
    expect(
      resolveInsightsSearch({
        teamParam: 'c',
        monthParam: '2025-12',
        teams: undated,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toBeNull()
    // BOTH EDGES, OR THIS TEST ONLY SAYS "SOMETHING WAS ACCEPTED". 2025-09 is
    // one month past the cap's floor of 2025-10, so it must still be
    // corrected: a missing creation date means the FULL window, never an
    // unbounded one.
    expect(
      resolveInsightsSearch({
        teamParam: 'c',
        monthParam: '2025-09',
        teams: undated,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toEqual({ team: 'c', month: '2026-09' })
  })

  /**
   * THE CURRENT MONTH IS ALWAYS INSIDE THE WINDOW, EVEN FOR A TEAM WHOSE
   * `createdAt` IS IN THE FUTURE (clock skew or bad data). This is the fact
   * the idempotency contract rests on: if the month fallback could itself be
   * outside the window, a second pass would try to correct it again and the
   * navigate-on-effect below would never settle.
   */
  test('a future createdAt still resolves to the current month, and settles', () => {
    const skewed = [{ id: 'skew', createdAt: at(2027, 3, 4) }]
    const first = resolveInsightsSearch({
      teamParam: undefined,
      monthParam: undefined,
      teams: skewed,
      storedTeam: null,
      currentMonth: CURRENT,
    })
    expect(first).toEqual({ team: 'skew', month: '2026-09' })
    expect(
      resolveInsightsSearch({
        teamParam: first!.team,
        monthParam: first!.month,
        teams: skewed,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toBeNull()
  })

  test('is idempotent — its own output resolves to null on the next run', () => {
    const first = resolveInsightsSearch({
      teamParam: undefined,
      monthParam: undefined,
      teams,
      storedTeam: null,
      currentMonth: CURRENT,
    })!
    expect(first).toEqual({ team: 'a', month: '2026-09' })
    expect(
      resolveInsightsSearch({
        teamParam: first.team,
        monthParam: first.month,
        teams,
        storedTeam: null,
        currentMonth: CURRENT,
      }),
    ).toBeNull()
  })

  /**
   * The same contract from the worst starting point available: a team the
   * viewer has left AND a month that is not a month, which is the input a
   * shared or long-stale bookmark actually produces. Both halves change on
   * the first pass, and the second pass must still find nothing to do.
   */
  test('is idempotent when both params were wrong', () => {
    const first = resolveInsightsSearch({
      teamParam: 'gone',
      monthParam: 'not-a-month',
      teams,
      storedTeam: 'b',
      currentMonth: CURRENT,
    })!
    expect(first).toEqual({ team: 'b', month: '2026-09' })
    expect(
      resolveInsightsSearch({
        teamParam: first.team,
        monthParam: first.month,
        teams,
        storedTeam: 'b',
        currentMonth: CURRENT,
      }),
    ).toBeNull()
  })
})
