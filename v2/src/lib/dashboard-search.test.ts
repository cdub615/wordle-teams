import { describe, expect, test } from 'vitest'
import { resolveDashboardSearch } from './dashboard-search.ts'

const teams = [{ id: 'a' }, { id: 'b' }]

describe('resolveDashboardSearch', () => {
  test('returns null when both params are already valid — no navigation', () => {
    expect(
      resolveDashboardSearch({
        teamParam: 'a',
        monthParam: '2026-08',
        teams,
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toBeNull()
  })

  test('fills in the current month when only the team is set', () => {
    expect(
      resolveDashboardSearch({
        teamParam: 'a',
        monthParam: undefined,
        teams,
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toEqual({ team: 'a', month: '2026-08' })
  })

  test('prefers the stored team when the URL has none', () => {
    expect(
      resolveDashboardSearch({
        teamParam: undefined,
        monthParam: '2026-08',
        teams,
        storedTeam: 'b',
        currentMonth: '2026-08',
      }),
    ).toEqual({ team: 'b', month: '2026-08' })
  })

  test('falls back to the first team when the stored team is not one of yours', () => {
    expect(
      resolveDashboardSearch({
        teamParam: undefined,
        monthParam: '2026-08',
        teams,
        storedTeam: 'gone',
        currentMonth: '2026-08',
      }),
    ).toEqual({ team: 'a', month: '2026-08' })
  })

  test('treats a team you are not on as if it were missing — a stale bookmark', () => {
    expect(
      resolveDashboardSearch({
        teamParam: 'gone',
        monthParam: '2026-08',
        teams,
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toEqual({ team: 'a', month: '2026-08' })
  })

  test('returns null when there is no team to select at all', () => {
    expect(
      resolveDashboardSearch({
        teamParam: undefined,
        monthParam: undefined,
        teams: [],
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toBeNull()
  })

  test('is idempotent — its own output resolves to null on the next run', () => {
    const first = resolveDashboardSearch({
      teamParam: undefined,
      monthParam: undefined,
      teams,
      storedTeam: null,
      currentMonth: '2026-08',
    })!
    expect(
      resolveDashboardSearch({
        teamParam: first.team,
        monthParam: first.month,
        teams,
        storedTeam: null,
        currentMonth: '2026-08',
      }),
    ).toBeNull()
  })
})
