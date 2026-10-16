// @vitest-environment jsdom
//
// THE DASHBOARD CARD (wordle-teams-9j7o.2.3.2.14): nothing until hydrated and
// until `today` says the game is on; then the card for the play's state, as a
// link to the play route carrying the team.
import { cleanup, render, screen } from '@testing-library/react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../../convex/_generated/api'
import { DashboardClueLadderCard } from './dashboard-card.tsx'
import type { ClueLadderTodayView } from './today.ts'

const { state } = vi.hoisted(() => ({
  state: { hydrated: true, answer: undefined as unknown, queries: [] as unknown[] },
}))

vi.mock('#/lib/use-hydrated.ts', () => ({ useHydrated: () => state.hydrated }))
vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>, args: unknown) => ({ queryKey: [getFunctionName(ref), args] }),
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: [string, unknown] }) => {
    if (queryKey[0] !== getFunctionName(api.clueLadder.today)) throw new Error(`unexpected query ${queryKey[0]}`)
    state.queries.push(queryKey[1])
    return { data: queryKey[1] === 'skip' ? undefined : state.answer }
  },
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, search, children }: { to: string; search?: unknown; children?: ReactNode }) =>
    createElement('a', { href: to, 'data-search': JSON.stringify(search ?? null) }, children),
}))

const playing: ClueLadderTodayView = {
  status: 'playing',
  date: '2026-10-20',
  cluesRevealed: 3,
  clues: ['a', 'b', 'c'],
  scratch: [],
} as unknown as ClueLadderTodayView

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 20, 12))
  state.hydrated = true
  state.answer = { enabled: true, play: playing }
  state.queries.length = 0
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const mount = () => render(createElement(DashboardClueLadderCard, { teamId: 'team1' }))

describe('DashboardClueLadderCard', () => {
  test('renders nothing when the game is off', () => {
    state.answer = { enabled: false }
    const { container } = mount()
    expect(container.innerHTML).toBe('')
  })

  test('renders nothing while the answer is in flight', () => {
    state.answer = undefined
    expect(mount().container.innerHTML).toBe('')
  })

  test('renders nothing, and skips the query, before hydration', () => {
    state.hydrated = false
    const { container } = mount()
    expect(container.innerHTML).toBe('')
    expect(state.queries).toEqual(['skip'])
  })

  test('asks for the client’s own day once hydrated', () => {
    mount()
    expect(state.queries).toEqual([{ today: '2026-10-20' }])
  })

  test('links to the play route with the team', () => {
    mount()
    const link = screen.getByRole('link', { name: 'Continue' })
    expect(link.getAttribute('href')).toBe('/play/clue-ladder')
    expect(link.getAttribute('data-search')).toBe(JSON.stringify({ team: 'team1' }))
  })

  test('shows the play’s state through cardPlayOf', () => {
    mount()
    expect(screen.getByText('Clue 3')).toBeTruthy()
  })

  test('a not-started play offers Play', () => {
    state.answer = { enabled: true, play: { status: 'not-started', date: '2026-10-20' } }
    mount()
    expect(screen.getByRole('link', { name: 'Play' })).toBeTruthy()
  })
})
