// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { GameScoresTable } from './game-scores-table.tsx'

let earliestMonth: string | null = null
let countsFrom: string | null = null
let missed = 0
let results = [{ puzzleDay: '2026-08-04', attempts: 7 }]
const gameMonth = {
  game: 'clueLadder',
  team: {
    id: 't',
    name: 'T',
    playWeekends: true,
    system: { oneGuess: 5, twoGuesses: 3, threeGuesses: 2, fourGuesses: 1, fiveGuesses: 0, sixGuesses: 0, failed: -1, nA: 0 },
    systemEffectiveFrom: null,
  },
  players: [{ id: 'a', firstName: 'Al', lastName: 'One', results: [{ puzzleDay: '2026-08-04', attempts: 7 }] }],
}

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
}))
vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    if (queryKey[0] === getFunctionName(api.scores.monthWindow)) return { data: { earliestMonth } }
    if (queryKey[0] === getFunctionName(api.scores.getTeamGameMonth)) return {
        data: {
          ...gameMonth,
          countsFrom,
          team: { ...gameMonth.team, system: { ...gameMonth.team.system, nA: missed } },
          players: gameMonth.players.map((player) => ({ ...player, results })),
        },
      }
    throw new Error(`unexpected query ${queryKey[0]}`)
  },
}))

afterEach(cleanup)
beforeEach(() => {
  earliestMonth = null
  countsFrom = null
  missed = 0
  results = [{ puzzleDay: '2026-08-04', attempts: 7 }]
})

const props = { teamId: 't' as Id<'teams'>, game: 'clueLadder' as const }

describe('GameScoresTable', () => {
  test('a month before the game’s first play shows a notice, not the grid', () => {
    earliestMonth = '2026-09'
    render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(screen.getByText('No clue ladder games this month.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('a month with plays shows the grid, with X for a failed day', () => {
    earliestMonth = '2026-08'
    const { container } = render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(container.querySelector('[data-day="2026-08-04"]')?.textContent).toBe('X')
  })

  test('the legend shows the clue ladder’s points, X at -1', () => {
    earliestMonth = '2026-08'
    render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(screen.getByText('Points by clue: 1: 5 · 2: 3 · 3: 2 · 4: 1 · 5: 0 · 6: 0 · X: -1 · missed: 0')).toBeTruthy()
  })

  // The row's last cell is its month total (scores-table.tsx).
  const total = (container: HTMLElement) => container.querySelector('tbody tr td:last-child')?.textContent

  test('a result before the team turned it on still shows and counts', () => {
    // "Scores are kept": switching the game off and on again never hides a play.
    earliestMonth = '2026-08'
    countsFrom = '2026-08-10'
    results = [
      { puzzleDay: '2026-08-04', attempts: 7 },
      { puzzleDay: '2026-08-12', attempts: 7 },
    ]
    const { container } = render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(container.querySelector('[data-day="2026-08-04"]')?.textContent).toBe('X')
    expect(container.querySelector('[data-day="2026-08-12"]')?.textContent).toBe('X')
    expect(total(container)).toBe('-2')
  })

  test('an empty day before it is blank and scores nothing; an empty day on or after it is missed', () => {
    // August 2026 is wholly past, so without countsFrom every day would score `missed`.
    earliestMonth = '2026-08'
    countsFrom = '2026-08-30'
    missed = -1
    results = []
    const { container } = render(createElement(GameScoresTable, { ...props, month: '2026-08' }))
    expect(container.querySelector('[data-day="2026-08-29"]')?.textContent).toBe('')
    expect(container.querySelector('[data-day="2026-08-30"]')?.textContent).toBe('0')
    // The 30th and 31st, and nothing before.
    expect(total(container)).toBe('-2')
  })
})
