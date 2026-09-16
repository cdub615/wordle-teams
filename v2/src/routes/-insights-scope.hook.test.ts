// @vitest-environment jsdom
//
// THE LEADING DASH IS REQUIRED, not a style choice: TanStack Router treats every
// file under src/routes/ as a route and warns on each build that this one exports
// no Route. `routeFileIgnorePrefix` is "-", so the dash is the documented way to
// keep a non-route file next to the route it tests.
//
// A SECOND FILE BESIDE -insights.hook.test.ts, AND THE MOCK IS WHY. That file
// answers EVERY react-query call with `{ data: undefined }`, which is exactly
// what its own subject needs — the three-state guard and the absent states —
// and it means Layer 3 there never gets past `if (!data) return null`. So it
// cannot see a rendered team card at all, and the branch this file is about
// (which controls the PRO card gets versus the FREE one) is unreachable from
// it. Rather than make that file's mock call-aware and put every assertion in
// it at the mercy of the change, the mock that answers is here.
//
// WHY THIS FILE EXISTS: THE FREE BRANCH MUST NOT GET A MONTH DROPDOWN. That is
// a one-line difference inside TeamSection between two sibling calls, it is
// invisible to type-checking (the prop is optional on purpose), and it is
// invisible to team-scope-controls.hook.test.ts, which renders the control
// directly and never sees who built it. Only a render of the panel through the
// real branch can catch a month scope handed to the daily fact — or, the other
// way, a pro card that lost its month dropdown to a refactor.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import { toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * TODAY, FROM THE SAME FUNCTION TeamSection READS IT FROM. The daily fact is a
 * fact about today and returns 'no-board' for any other day, so a hardcoded
 * date here would render no card at all and the free-branch assertions would
 * pass against an empty document.
 */
const today = toPuzzleDay(new Date())

/**
 * A team month with one board — the viewer's, today.
 *
 * ONE MEMBER, SO THE FREE FACT IS THE 'alone' ONE. Which sentence it is does
 * not matter here; that it renders A CARD does, because the card is what holds
 * the header this file is about.
 */
const teamMonth = {
  viewerId: 'me',
  roster: [{ playerId: 'me', firstName: 'Ada', lastName: 'Lovelace' }],
  stats: {
    members: [{ playerId: 'me', boards: 1, attempts: 3, solved: 1, failed: 0 }],
    days: [{ puzzleDay: today, entries: [{ playerId: 'me', attempts: 3 }] }],
  },
}

// Answers the ONE query Layer 3 makes (`insights.teamMonth`). TrialEndedCard
// reads `access?.trialExpired` off the same answer and finds nothing, which is
// its own "no card" state — the shape below is not a trial payload and is not
// meant to be one.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: teamMonth, isPending: false }),
}))

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: () => ({ queryKey: ['stub'] }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  redirect: () => undefined,
  useNavigate: () => () => undefined,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
    createElement('a', { href: to, ...rest }, children),
}))

const { InsightsPanel } = await import('./insights.tsx')

afterEach(cleanup)

const credit = {
  attribution: 'FiveLetterWords.io, research release v2026-09-01',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  citation: 'FiveLetterWords.io (2026-09-01). [Data set].',
}

const benchmark: InsightsBenchmark = {
  openers: { ...credit, release: 'v2026-09-01', count: 14855, words: 'slantcraneorate' },
  difficulty: {
    ...credit,
    release: 'current',
    snapshotId: 'current-2026-09-07-abc',
    firstDay: '2026-09-01',
    count: 3,
    percentiles: [10, 50, 95],
  },
}

// `Id<'teams'>` is a branded string, so a literal needs the cast to stand in
// for one. The ids are never dereferenced here — the query is mocked.
const teams = [
  { id: 'team_a' as Id<'teams'>, name: 'Ada’s Analysts' },
  { id: 'team_b' as Id<'teams'>, name: 'Turing Test' },
]

const panel = ({
  layer3,
  teamCount,
}: {
  layer3: 'free' | 'full'
  teamCount: 1 | 2
}) =>
  render(
    createElement(InsightsPanel, {
      benchmark,
      data: {
        access: { layer1: 'free', layer2: 'none', layer3 },
        boards: [{ puzzleDay: today, guesses: ['CRANE'] }],
      },
      onATeam: true,
      teams: teams.slice(0, teamCount),
      team: teams[0],
      // The month `?month=` would hold once the route's effect has settled it.
      // Any month is fine: the dropdown's OPTIONS come from the team's window,
      // and what this file asserts is the dropdown's presence, not its contents.
      month: today.slice(0, 7),
      onTeamChange: () => undefined,
      onMonthChange: () => undefined,
    }),
  )

describe('the pro branch — the full team card', () => {
  test('gets a month dropdown, because a month is what it is showing', () => {
    panel({ layer3: 'full', teamCount: 2 })
    expect(screen.queryByTestId('insights-team')).not.toBeNull()
    expect(screen.queryByTestId('insights-scope-month')).not.toBeNull()
  })

  test('and the team dropdown at two teams', () => {
    panel({ layer3: 'full', teamCount: 2 })
    expect(screen.queryByTestId('insights-scope-team')).not.toBeNull()
  })

  test('but no team dropdown at one', () => {
    panel({ layer3: 'full', teamCount: 1 })
    expect(screen.queryByTestId('insights-scope-team')).toBeNull()
    // The month one is unaffected — the two rules are independent.
    expect(screen.queryByTestId('insights-scope-month')).not.toBeNull()
  })
})

describe('the free branch — the daily fact', () => {
  test('gets the team dropdown at two teams and NO month dropdown', () => {
    // THE ASSERTION THIS FILE IS FOR. A fact about today has no month to
    // choose, so offering one would be a control that cannot change what is on
    // screen — and, with a past month picked, `?month=` would move under a card
    // that is still reading the clock.
    panel({ layer3: 'free', teamCount: 2 })
    expect(screen.queryByTestId('insights-daily-fact')).not.toBeNull()
    expect(screen.queryByTestId('insights-scope-team')).not.toBeNull()
    expect(screen.queryByTestId('insights-scope-month')).toBeNull()
  })

  test('and no controls at all at one team', () => {
    panel({ layer3: 'free', teamCount: 1 })
    expect(screen.queryByTestId('insights-daily-fact')).not.toBeNull()
    expect(screen.queryByTestId('insights-scope-controls')).toBeNull()
  })
})
