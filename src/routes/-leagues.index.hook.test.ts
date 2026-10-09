// @vitest-environment jsdom
//
// The /leagues ROUTE's wiring: a failed myLeagues must surface to the route's
// errorComponent instead of leaving "Loading…" up forever. The leading dash
// keeps TanStack Router from treating the file as a route.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../convex/_generated/api', () => ({
  api: { players: { needsProfile: 'needsProfile' }, leagues: { leagues: 'leagues', myLeagues: 'myLeagues' } },
}))

const answers: Record<string, unknown> = {}
const errors: Record<string, Error> = {}

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (fn: string, args: unknown) => ({ fn, args }),
}))
vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: (q: { fn: string }) => ({ data: answers[q.fn] }),
  useQuery: (q: { fn: string; args: unknown }) => ({
    data: q.args === 'skip' ? undefined : answers[q.fn],
    error: errors[q.fn] ?? null,
  }),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ ...options }),
  redirect: () => undefined,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement('a', { href: to, ...rest }, children),
}))
vi.mock('#/lib/use-hydrated.ts', () => ({ useHydrated: () => true }))

const { Route } = await import('./leagues.index.tsx')
const page = () => render(createElement((Route as unknown as { component: () => ReactNode }).component))

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k]
  for (const k of Object.keys(errors)) delete errors[k]
  answers.leagues = {
    enabled: true,
    leagues: [
      { slug: 'a', name: 'Alpha' },
      { slug: 'b', name: 'Beta' },
    ],
  }
})
afterEach(cleanup)

describe('/leagues route', () => {
  test('waiting on myLeagues shows a status, not the directory', () => {
    page()
    expect(screen.getByRole('status').textContent).toBe('Loading…')
  })
  test('a failed myLeagues throws to the errorComponent instead of loading forever', () => {
    errors.myLeagues = new Error('boom')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(page).toThrow('boom')
  })
  test('myLeagues answered: the directory renders', () => {
    answers.myLeagues = { enabled: true, leagues: [] }
    page()
    expect(screen.getByRole('heading', { name: 'Join a league' })).toBeTruthy()
  })
})
