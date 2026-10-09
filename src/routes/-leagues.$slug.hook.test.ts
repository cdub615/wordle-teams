// @vitest-environment jsdom
//
// The /leagues/$slug ROUTE's wiring: which args its queries and mutations get.
// The page itself is covered in components/leagues/league-page-view.hook.test.ts;
// this only pins what the route hands the backend. The leading dash keeps
// TanStack Router from treating the file as a route (see -insights.hook.test.ts).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Function references stand in as their names; convexQuery passes them through. */
vi.mock('../../convex/_generated/api', () => ({
  api: {
    players: { needsProfile: 'needsProfile' },
    leagues: Object.fromEntries(
      ['standings', 'myLeagues', 'myContribution', 'groupStanding', 'joinGroup', 'switchGroup', 'joinWord', 'switchWord', 'leaveLeague'].map((n) => [n, n]),
    ),
  },
}))

type Call = { fn: string; args: unknown }
const queries: Call[] = []
const answers: Record<string, unknown> = {}
const mutations: Record<string, ReturnType<typeof vi.fn>> = {}

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (fn: string, args: unknown) => ({ fn, args }),
  useConvexMutation: (fn: string) => (mutations[fn] ??= vi.fn(async () => null)),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (q: Call) => {
    queries.push(q)
    return { data: q.args === 'skip' ? undefined : answers[q.fn], error: null }
  },
  useMutation: ({ mutationFn }: { mutationFn: (args: unknown) => Promise<unknown> }) => ({ mutateAsync: mutationFn, isPending: false }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ ...options, useParams: () => ({ slug: 'starting-words' }) }),
  redirect: () => undefined,
  useNavigate: () => () => undefined,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => createElement('a', { href: to, ...rest }, children),
}))

vi.mock('#/lib/use-hydrated.ts', () => ({ useHydrated: () => true }))
vi.mock('#/components/upgrade-dialog.tsx', () => ({ useUpgrade: () => ({ openUpgrade: vi.fn() }) }))

const { Route } = await import('./leagues.$slug.tsx')

const largeView = {
  large: true,
  groupSource: 'answer-words',
  leagueId: 'l1',
  pickable: null,
  league: { slug: 'starting-words', name: 'Starting Words' },
  month: '2026-10',
  groups: [],
  popular: [{ _id: 'g1', slug: 'slate', name: 'SLATE', memberCount: 4 }],
  shown: [],
  viewer: null,
  unrankedCount: 0,
  standings: [],
  lastMonth: null,
  monthsWon: [],
}
const slate = {
  league: { slug: 'starting-words', name: 'Starting Words' },
  leagueId: 'l1',
  group: { _id: 'g1', name: 'SLATE' },
  since: '2026-10-02',
  pending: null,
}

const page = () => render(createElement((Route as unknown as { component: () => ReactNode }).component))
const last = (fn: string) => queries.filter((q) => q.fn === fn).at(-1)?.args

beforeEach(() => {
  queries.length = 0
  for (const k of Object.keys(answers)) delete answers[k]
  for (const k of Object.keys(mutations)) delete mutations[k]
  answers.standings = { enabled: true, view: largeView }
})
afterEach(cleanup)

describe('/leagues/$slug wiring', () => {
  test("standings gets the viewer's group from the membership", () => {
    answers.myLeagues = { enabled: true, leagues: [slate] }
    page()
    expect(last('standings')).toMatchObject({ slug: 'starting-words', groupId: 'g1' })
  })

  test('a non-member sends no group', () => {
    answers.myLeagues = { enabled: true, leagues: [] }
    page()
    expect(last('standings')).toMatchObject({ slug: 'starting-words', groupId: undefined })
  })

  test("groupStanding is 'skip' until a word is submitted", () => {
    answers.myLeagues = { enabled: true, leagues: [slate] }
    page()
    expect(queries.filter((q) => q.fn === 'groupStanding').every((q) => q.args === 'skip')).toBe(true)
    const search = screen.getByRole('search', { name: 'Find a group' })
    fireEvent.change(within(search).getByLabelText('Find a group'), { target: { value: 'crane' } })
    fireEvent.click(within(search).getByRole('button', { name: 'Find' }))
    expect(last('groupStanding')).toMatchObject({ slug: 'starting-words', word: 'crane' })
  })

  test('joinWord gets the league id, the word and a day', () => {
    answers.myLeagues = { enabled: true, leagues: [] }
    page()
    fireEvent.click(within(screen.getByRole('group', { name: 'Choose a group' })).getByRole('button', { name: 'SLATE' }))
    expect(mutations.joinWord).toHaveBeenCalledWith({ leagueId: 'l1', word: 'slate', today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
  })
})
