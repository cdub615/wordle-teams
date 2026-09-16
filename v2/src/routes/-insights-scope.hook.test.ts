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
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
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

/** The month before `today`'s — a month `?month=` can legitimately name. */
const pastMonth = (() => {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
})()

/**
 * That same team, one month earlier: a board, but not today's.
 *
 * WHAT MAKES IT THE RIGHT FIXTURE: `dailyTeamFact` looks for `today` in
 * `stats.days` and returns 'no-board' when it is absent, and DailyTeamFact
 * renders NOTHING for 'no-board'. So this aggregate is precisely the one that
 * makes the free card disappear — which is what the month-keying bug used to
 * hand it.
 */
const pastTeamMonth = {
  viewerId: 'me',
  roster: [{ playerId: 'me', firstName: 'Ada', lastName: 'Lovelace' }],
  stats: {
    members: [{ playerId: 'me', boards: 1, attempts: 3, solved: 1, failed: 0 }],
    days: [{ puzzleDay: `${pastMonth}-05`, entries: [{ playerId: 'me', attempts: 3 }] }],
  },
}

/**
 * Every `insights.teamMonth` args object TeamSection has asked for this test,
 * newest last — including the string 'skip', which is how that component says
 * "do not read at all" (see the route's own note on why `enabled` cannot).
 */
const asked: unknown[] = []

/**
 * THE MOCK ANSWERS BY MONTH, AND THAT IS LOAD-BEARING RATHER THAN THOROUGH.
 *
 * A mock that returned one aggregate for every call would let the free branch
 * ask for ANY month and still render its fact, so the regression this file now
 * pins — a free card fetching a past month and vanishing — would pass. Keying
 * the answer the way the real backend does is what makes that test able to
 * fail. The five assertions that predate this all pass the current month and so
 * get exactly the aggregate they always did.
 */
const answerFor = (args: unknown) => {
  if (args === 'skip' || args === undefined) return undefined
  const { month } = args as { month: string }
  return month === monthOf(today) ? teamMonth : pastTeamMonth
}

// Answers the ONE query Layer 3 makes (`insights.teamMonth`). TrialEndedCard
// reads `access?.trialExpired` off the same answer and finds nothing, which is
// its own "no card" state — the shape below is not a trial payload and is not
// meant to be one.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { args?: unknown }) => ({
    data: answerFor(options.args),
    isPending: false,
  }),
}))

// `args` RIDES ALONG ON THE OPTIONS OBJECT so the useQuery mock above can see
// what was actually requested. The real `convexQuery` builds a queryKey the
// adapter understands; nothing here depends on its shape, only on the args
// surviving the trip.
vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (_fn: unknown, args: unknown) => {
    asked.push(args)
    return { queryKey: ['stub', args], args }
  },
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

const panel = (options: {
  layer3: 'free' | 'full'
  teamCount: 1 | 2
  month?: string
  team?: { id: Id<'teams'>; name: string }
}) => {
  const { layer3, teamCount } = options
  // `in` RATHER THAN A DEFAULT PARAMETER, and the difference is the whole point
  // of two of the tests below: a default fires on an explicit `undefined` too,
  // so `panel({ month: undefined })` would silently get the current month and
  // the "reads nothing until it is settled" assertions would test nothing. Both
  // props are genuinely absent for a render or two after hydration, so a test
  // has to be able to say ABSENT rather than merely not say anything.
  //
  // The month default is the current one: the dropdown's OPTIONS come from the
  // team's window, and what most of this file asserts is the dropdown's
  // presence, not its contents.
  const month = 'month' in options ? options.month : monthOf(today)
  const team = 'team' in options ? options.team : teams[0]
  asked.length = 0
  return render(
    createElement(InsightsPanel, {
      benchmark,
      data: {
        access: { layer1: 'free', layer2: 'none', layer3 },
        boards: [{ puzzleDay: today, guesses: ['CRANE'] }],
      },
      onATeam: true,
      teams: teams.slice(0, teamCount),
      team,
      month,
      onTeamChange: () => undefined,
      onMonthChange: () => undefined,
    }),
  )
}

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

/*
  THE MONTH EACH BRANCH READS, WHICH IS NOT THE MONTH EACH BRANCH SHOWS.

  ONE QUERY SERVES BOTH CARDS, and keying it on `?month=` for both was a
  regression this epic introduced: before the month was selectable at all it was
  always `monthOf(today)`, so the free fact always had the aggregate it needed.
  Once `?month=` moved it, `/insights?month=<past>` fetched a month with no
  entry for today, `dailyTeamFact` returned 'no-board', DailyTeamFact rendered
  `null` — AND THE TEAM PICKER WENT WITH IT, because that picker lives in the
  card's header and only exists when the card does. A free player on a shared
  link got a blank region and nothing to click.

  THE ASSERTIONS ARE ON THE ARGS, NOT ONLY ON THE RENDER, because the args are
  what the fix changes; the render follows from them only while the mock above
  keys its answer by month, which is exactly why it does.
*/
describe('the month each branch reads', () => {
  test('a free player with a PAST ?month= still gets their fact about today', () => {
    // THE REGRESSION TEST. Before the fix this rendered nothing at all — no
    // card, and therefore no way to reach the other team either.
    panel({ layer3: 'free', teamCount: 2, month: pastMonth })
    expect(screen.queryByTestId('insights-daily-fact')).not.toBeNull()
    expect(screen.queryByTestId('insights-scope-team')).not.toBeNull()
  })

  test('and it asks for the CURRENT month, whatever ?month= says', () => {
    panel({ layer3: 'free', teamCount: 2, month: pastMonth })
    expect(asked).toEqual([{ teamId: 'team_a', month: monthOf(today) }])
  })

  test('the pro branch still asks for the month that was selected', () => {
    // NOT COLLATERAL DAMAGE FROM THE FIX ABOVE: a pro player choosing a past
    // month and seeing that month's card is the entire feature, and they have
    // the month dropdown to come back with.
    panel({ layer3: 'full', teamCount: 2, month: pastMonth })
    expect(asked).toEqual([{ teamId: 'team_a', month: pastMonth }])
    expect(screen.queryByTestId('insights-team')).not.toBeNull()
  })

  test('neither branch reads anything until the team is resolved', () => {
    // The free branch's month half is now ALWAYS satisfied — `monthOf` slices a
    // clock reading and cannot return `undefined` — so `team` is the only thing
    // still holding this query back on that branch. A refactor that dropped the
    // team half would send an id-less read, or worse an id for a team the
    // viewer is not on, which `insights.teamMonth` refuses server-side.
    panel({ layer3: 'free', teamCount: 2, month: pastMonth, team: undefined })
    expect(asked).toEqual(['skip'])
    panel({ layer3: 'full', teamCount: 2, month: pastMonth, team: undefined })
    expect(asked).toEqual(['skip'])
  })

  test('the pro branch reads nothing until ?month= is settled either', () => {
    // Its month genuinely is absent for a render or two after hydration.
    panel({ layer3: 'full', teamCount: 2, month: undefined })
    expect(asked).toEqual(['skip'])
  })
})
