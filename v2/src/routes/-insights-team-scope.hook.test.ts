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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import { formatMonthLabel } from '#/lib/format-day.ts'
import { teamMonthOptions } from '#/lib/insights-months.ts'
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

/**
 * A creation date two months before today's, so the team's month window is
 * exactly THREE months long.
 *
 * THREE IS CHOSEN TO SIT BETWEEN THE TWO WRONG ANSWERS, which is the whole
 * reason this constant is not just `undefined`. A dropdown fed `[month]`
 * offers ONE; a dropdown that forgot to pass `createdAt` gets the 12-month cap
 * and offers TWELVE. Only a list built from THIS team's window is three long,
 * so the assertion below can tell all three apart.
 *
 * BUILT FROM LOCAL PARTS BECAUSE `toPuzzleDay` READS LOCAL PARTS
 * (convex/lib/puzzleDay.ts uses getFullYear/getMonth/getDate), and
 * `teamMonthOptions` puts this timestamp through it. Constructing it the same
 * way round-trips exactly in every zone; day 15 keeps it clear of both month
 * boundaries regardless.
 */
const createdAt = new Date(
  Number(today.slice(0, 4)),
  Number(today.slice(5, 7)) - 1 - 2,
  15,
).getTime()

/**
 * Radix opens a DropdownMenu on POINTERDOWN, not on click — `fireEvent.click`
 * alone leaves the menu shut and every assertion about its contents trivially
 * passing against an empty list. Same helper, same lesson, as
 * team-scope-controls.hook.test.ts and app-menu.hook.test.ts.
 */
const open = (name: string) =>
  fireEvent.pointerDown(screen.getByRole('button', { name }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  })

/** The pro card's CardHeader — `Card`'s first child. */
const teamCardHeader = () => screen.getByTestId('insights-team').firstElementChild!

/**
 * The VISIBLE title, or null when the header has none.
 *
 * `:scope > .truncate` IS PRECISE, NOT APPROXIMATE. The title is the only DIRECT
 * child of the header carrying `truncate` (team-panel.tsx gives it
 * `min-w-0 truncate`, and `sr-only` when hidden — never both); the controls
 * wrapper has no `truncate`, and the team trigger's own truncating span is
 * nested inside it. Without the `:scope >` this would match that span and the
 * two-team assertion would pass on the duplicate it exists to forbid.
 *
 * ELEMENT-AGNOSTIC ON PURPOSE: the title is a CardTitle rendered `asChild` over
 * an `h2`, and a test that named the tag would have to change again the next
 * time the heading level moves.
 */
const visibleTitle = () => teamCardHeader().querySelector(':scope > .truncate')?.textContent ?? null

const panel = (options: {
  layer3: 'free' | 'full'
  teamCount: 1 | 2
  month?: string
  team?: { id: Id<'teams'>; name: string; createdAt?: number }
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
    expect(screen.queryByTestId('insights-team-scope-month')).not.toBeNull()
  })

  test('and the team dropdown at two teams', () => {
    panel({ layer3: 'full', teamCount: 2 })
    expect(screen.queryByTestId('insights-team-scope-team')).not.toBeNull()
  })

  test('but no team dropdown at one', () => {
    panel({ layer3: 'full', teamCount: 1 })
    expect(screen.queryByTestId('insights-team-scope-team')).toBeNull()
    // The month one is unaffected — the two rules are independent.
    expect(screen.queryByTestId('insights-team-scope-month')).not.toBeNull()
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
    expect(screen.queryByTestId('insights-team-scope-team')).not.toBeNull()
    expect(screen.queryByTestId('insights-team-scope-month')).toBeNull()
  })

  test('and no controls at all at one team', () => {
    panel({ layer3: 'free', teamCount: 1 })
    expect(screen.queryByTestId('insights-daily-fact')).not.toBeNull()
    expect(screen.queryByTestId('insights-team-scope-controls')).toBeNull()
  })
})

/*
  THE MONTH EACH BRANCH READS, WHICH IS NOT THE MONTH EACH BRANCH SHOWS.

  The bug these pin, and why the two branches differ at all, is stated once at
  `queryMonth` in routes/insights.tsx. In short: the free card asks only about
  TODAY, so a `?month=` in the past used to leave it with no card and no picker.

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
    expect(screen.queryByTestId('insights-team-scope-team')).not.toBeNull()
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

/*
  THE WIRING OF THE PRO CARD'S HEADER, WHICH IS NOT THE SAME THING AS ITS
  CONTRACT.

  team-panel.hook.test.ts pins what TeamPanel DOES with `titleVisuallyHidden` —
  both shapes, given the boolean. It renders the component directly and passes
  the flag itself, so it can say nothing about whether the ROUTE passes the
  right one. That gap is not theoretical: with it open, flipping the prop at the
  call site to a constant — in EITHER direction — left the whole suite green.
  `false` put back the duplicated team name this task was raised to remove, and
  `true` took the only visible identifier off a one-team account.

  THE ROUTE IS THE ONLY PLACE THAT KNOWS THE TEAM COUNT, so the route is where
  the question has to be asked. These assertions render through the real branch
  at both counts and read the header that actually came out.
*/
describe('the pro header names the team exactly once, whatever the team count', () => {
  test('at TWO teams the visible title is gone and an sr-only heading carries the name', () => {
    panel({ layer3: 'full', teamCount: 2 })
    // The trigger is showing the name, so the title must not also.
    expect(visibleTitle()).toBeNull()
    // But the card must still HAVE a heading — invisible, not deleted.
    const heading = screen.getByRole('heading', { level: 2, name: 'Ada’s Analysts' })
    expect(heading.className).toContain('sr-only')
    expect(teamCardHeader().contains(heading)).toBe(true)
  })

  test('at ONE team the visible title stays, because nothing else names the team', () => {
    panel({ layer3: 'full', teamCount: 1 })
    expect(visibleTitle()).toBe('Ada’s Analysts')
    expect(screen.queryByTestId('insights-team-scope-team')).toBeNull()
    // SAME HEADING, PAINTED. Both shapes put the team name in an h2; only
    // `sr-only` differs, so the document outline does not depend on the team
    // count. One name, one element, no hidden duplicate beside it.
    const heading = screen.getByRole('heading', { level: 2, name: 'Ada’s Analysts' })
    expect(heading.className).not.toContain('sr-only')
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
  })

  test('the free card gets the same heading, and still paints no title', () => {
    // IT HOSTS AN INTERACTIVE CONTROL AND HAD NO HEADING AT ALL, so a reader
    // navigating by heading skipped the region and landed on a bare
    // "Team: ..." button with nothing to say what it belonged to. The fix is
    // the heading, NOT a painted title — the card's design is one sentence.
    panel({ layer3: 'free', teamCount: 2 })
    const heading = screen.getByRole('heading', { level: 2, name: 'Ada’s Analysts' })
    expect(heading.className).toContain('sr-only')
    expect(screen.getByTestId('insights-daily-fact').contains(heading)).toBe(true)
    expect(screen.queryByTestId('insights-team-scope-team')).not.toBeNull()
  })

  test('and it keeps that heading at ONE team, where it draws no header at all', () => {
    // The header is conditional on the controls; the heading must not be, or the
    // commonest free account is the one left with no heading.
    panel({ layer3: 'free', teamCount: 1 })
    expect(screen.queryByTestId('insights-team-scope-controls')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Ada’s Analysts' })).not.toBeNull()
  })
})

describe('the month dropdown offers the team’s own window', () => {
  test('the options come from teamMonthOptions and this team’s createdAt', () => {
    // WHY THE LIST AND NOT JUST ITS PRESENCE: "a month dropdown is rendered"
    // says nothing about WHERE its months came from, so a call site handing it
    // `[month]` — the selected month and nothing else — left the suite green
    // while the control became unusable, offering only what was already chosen.
    //
    // THREE ENTRIES IS THE DISCRIMINATING FACT (see `createdAt` above): one
    // means the list was fabricated from the selection, twelve means
    // `createdAt` was dropped and the cap took over, three means it came from
    // this team's real window.
    panel({ layer3: 'full', teamCount: 2, team: { ...teams[0], createdAt } })
    open(`Month: ${formatMonthLabel(monthOf(today))}`)

    const offered = screen.queryAllByRole('menuitemradio').map((item) => item.textContent)
    expect(offered).toHaveLength(3)
    expect(offered).toEqual(teamMonthOptions(monthOf(today), createdAt).map(formatMonthLabel))
  })
})
