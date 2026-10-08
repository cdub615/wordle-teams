// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LeagueStandings } from './league-standings.tsx'

afterEach(cleanup)

const groups = ['CRANE', 'SLATE', 'ADIEU'].map((name, i) => ({ _id: `g${i}`, name }))
const base = {
  month: '2026-10',
  groups,
  standings: [
    { groupId: 'g0', rank: 1, average: 3.8, boards: 142, contributors: 9 },
    { groupId: 'g1', rank: 2, average: 3.9, boards: 96, contributors: 6 },
    { groupId: 'g2', rank: null, average: null, boards: 6, contributors: 2 },
  ],
  myGroupId: 'g1',
  lastMonth: null,
  monthsWon: [],
}

describe('LeagueStandings', () => {
  test('ranked rows show the average, unranked rows show progress to the floor', () => {
    render(createElement(LeagueStandings, base))
    expect(screen.getByTestId('standing-CRANE').textContent).toContain('3.8')
    expect(screen.getByTestId('standing-ADIEU').textContent).toContain('not yet ranked (6/10)')
  })
  test("the viewer's group is marked", () => {
    render(createElement(LeagueStandings, base))
    expect(screen.getByTestId('standing-SLATE').textContent).toContain('you')
    expect(screen.getByTestId('standing-CRANE').textContent).not.toContain('you')
  })
  test('last month: a winner, or no winner', () => {
    render(createElement(LeagueStandings, { ...base, lastMonth: { month: '2026-09', winnerGroupId: 'g0' } }))
    expect(screen.getByText('September winner: CRANE')).toBeTruthy()
    cleanup()
    render(createElement(LeagueStandings, { ...base, lastMonth: { month: '2026-09', winnerGroupId: null } }))
    expect(screen.getByText('No winner in September')).toBeTruthy()
  })
  test('the all-time tally lists only groups that have won, most first', () => {
    render(createElement(LeagueStandings, { ...base, monthsWon: [{ groupId: 'g0', count: 1 }, { groupId: 'g1', count: 3 }, { groupId: 'g2', count: 0 }] }))
    expect(screen.getByTestId('league-all-time').textContent).toBe('All-time: SLATE 3 · CRANE 1')
  })
})
