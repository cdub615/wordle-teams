// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { GameScoresTable } from './game-scores-table.tsx'

let earliestMonth: string | null = null
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
    if (queryKey[0] === getFunctionName(api.scores.getTeamGameMonth)) return { data: gameMonth }
    throw new Error(`unexpected query ${queryKey[0]}`)
  },
}))

afterEach(cleanup)
beforeEach(() => {
  earliestMonth = null
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
})
