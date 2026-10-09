// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

/**
 * A large league's table (spec v2 §4.5) — the shown rows, the viewer's
 * row after a separator, the unranked count, and "Find a group".
 */
describe('LeagueStandings for a large league', () => {
  const shown = base.standings.slice(0, 2)
  const viewerRow = { groupId: 'g9', rank: 14, average: 4.4, boards: 30, contributors: 3 }
  const large = {
    ...base,
    groups: [...groups, { _id: 'g9', name: 'PIOUS' }],
    standings: shown,
    myGroupId: 'g9',
    viewer: viewerRow,
    unrankedCount: 3,
  }

  test("the viewer's row comes after the shown rows and a separator, marked as theirs", () => {
    render(createElement(LeagueStandings, large))
    const rows = screen.getAllByRole('listitem').map((li) => li.getAttribute('data-testid'))
    expect(rows).toEqual(['standing-CRANE', 'standing-SLATE', 'standing-PIOUS'])
    const mine = screen.getByTestId('standing-PIOUS')
    expect(mine.getAttribute('aria-current')).toBe('true')
    expect(mine.textContent).toContain('14')
    expect(mine.textContent).toContain('you')
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(screen.getByTestId('standing-SLATE').getAttribute('aria-current')).toBeNull()
  })

  test('no viewer row and no separator without a viewer', () => {
    render(createElement(LeagueStandings, { ...large, viewer: null, myGroupId: null }))
    expect(screen.queryByTestId('standing-PIOUS')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
  })

  test('the unranked count, singular and plural, and nothing at zero', () => {
    render(createElement(LeagueStandings, large))
    expect(screen.getByText('3 more groups not ranked yet')).toBeTruthy()
    cleanup()
    render(createElement(LeagueStandings, { ...large, unrankedCount: 1 }))
    expect(screen.getByText('1 more group not ranked yet')).toBeTruthy()
    cleanup()
    render(createElement(LeagueStandings, { ...large, unrankedCount: 0 }))
    expect(screen.queryByText(/not ranked yet/)).toBeNull()
  })

  test('a small league has neither the unranked line nor the search', () => {
    render(createElement(LeagueStandings, base))
    expect(screen.queryByText(/not ranked yet$/)).toBeNull()
    expect(screen.queryByRole('search')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
  })

  const findWith = (result: unknown, onFind = vi.fn()) =>
    render(createElement(LeagueStandings, { ...large, find: { onFind, result } } as Parameters<typeof LeagueStandings>[0]))

  test('Find a group submits five letters, lower-cased', () => {
    const onFind = vi.fn()
    findWith(null, onFind)
    const search = screen.getByRole('search', { name: 'Find a group' })
    fireEvent.change(within(search).getByLabelText('Find a group'), { target: { value: 'SLATE' } })
    fireEvent.click(within(search).getByRole('button', { name: 'Find' }))
    expect(onFind).toHaveBeenCalledWith('slate')
  })

  test('Find a group refuses anything but five letters, without searching', () => {
    const onFind = vi.fn()
    findWith(null, onFind)
    const search = screen.getByRole('search', { name: 'Find a group' })
    fireEvent.change(within(search).getByLabelText('Find a group'), { target: { value: 'sla' } })
    fireEvent.click(within(search).getByRole('button', { name: 'Find' }))
    expect(onFind).not.toHaveBeenCalled()
    expect(screen.getByTestId('league-find-result').textContent).toBe('Enter a five-letter word')
  })

  test('each find result state', () => {
    const result = (text: string) => expect(screen.getByTestId('league-find-result').textContent).toBe(text)
    findWith({ word: 'slate', standing: { group: { name: 'SLATE' }, boards: 12, average: 4.1 } })
    result('SLATE — 4.1 · 12 boards')
    expect(screen.getByTestId('league-find-result').getAttribute('aria-live')).toBe('polite')
    cleanup()
    findWith({ word: 'slate', standing: { group: { name: 'SLATE' }, boards: 6, average: null } })
    result('SLATE — not yet ranked (6/10)')
    cleanup()
    findWith({ word: 'slate', standing: { group: { name: 'SLATE' }, boards: 0, average: null } })
    result('No one plays for SLATE this month')
    cleanup()
    findWith({ word: 'slate', standing: null })
    result('No SLATE group yet')
    cleanup()
    findWith({ word: 'slate', standing: undefined })
    result('Searching…')
    cleanup()
    findWith({ word: 'slate', standing: undefined, failed: true })
    result('Couldn’t search right now. Try again.')
    cleanup()
    findWith(null)
    result('')
  })
})
