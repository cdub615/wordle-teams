// @vitest-environment jsdom
//
// THE LEADING DASH IS REQUIRED, not a style choice: TanStack Router treats every
// file under src/routes/ as a route and warns on each build that this one exports
// no Route. `routeFileIgnorePrefix` is "-", so the dash is the documented way to
// keep a non-route file next to the route it tests.
//
// jsdom rather than the suite's default edge-runtime, because this file renders
// the real panel. `.hook.test.ts` and createElement by hand, matching every
// existing precedent — vitest.config.ts's glob is `src/**/*.test.ts`, so a .tsx
// file would simply not run.
//
// WHY THIS FILE EXISTS: ACCEPTANCE CRITERION 5. Layer 1 must render for a FREE
// player on their first board, WITH VISIBLE CC BY 4.0 ATTRIBUTION. Attribution
// is a licence obligation rather than a courtesy, so it gets its own assertion
// here instead of riding along inside somebody's snapshot — a snapshot would go
// on passing with the credit deleted as long as it was regenerated.
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'

/*
  TeamSection (Layer 3) issues its own queries, so rendering the panel with
  layer3 'full' pulls react-query in. Mocked to report nothing loaded, which
  makes `teams` — and so `teamId` — undefined on every render here. That is the
  "we do not know yet" branch, NOT the "no team" one: an undefined roster is not
  an empty roster, so Layer 3 renders NOTHING in every test in this file rather
  than the no-team card. (It used to render the card, which is exactly the
  conflation the third state below was added to stop.) This file is about Layers
  1 and 2, and Layer 3's own statistics are covered in lib/insights-team.test.ts
  against fixtures; the no-team card itself is pinned directly in
  no-team-card.hook.test.ts and, for the guards that choose between the three
  states, below in this file.
*/
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isPending: false }),
}))

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: () => ({ queryKey: ['stub'] }),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  redirect: () => undefined,
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
    createElement('a', { href: to, ...rest }, children),
}))

const { InsightsPanel, InsightsScope, Route } = await import('./insights.tsx')

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

/*
  `onATeam` DEFAULTS TO TRUE HERE, which is the case that renders the most copy
  rather than the least: the upsell names the team layer only for a player who
  has a team, so a default of `false` or `undefined` would quietly assert less
  than the panel can say and let a regression in the team clause through. Each
  test that is about the other two states passes it explicitly.
*/
const panel = (
  data: Parameters<typeof InsightsPanel>[0]['data'],
  onATeam: boolean | undefined = true,
) => render(createElement(InsightsPanel, { benchmark, data, onATeam }))

describe('a free player on their first board', () => {
  const freeFirstBoard = {
    access: { layer1: 'free' as const, layer2: 'none' as const, layer3: 'free' as const },
    boards: [{ puzzleDay: '2026-09-03', guesses: ['CRANE', 'SPEED'] }],
  }

  test('sees the benchmark for it', () => {
    panel(freeFirstBoard)
    expect(screen.getAllByTestId('insights-board')).toHaveLength(1)
    expect(screen.getByText('CRANE')).not.toBeNull()
    // The compact badge AND the full sentence. Asserting only the sentence is
    // how the row silently lost the word "ranks" — see board-row.hook.test.ts's
    // comment on the same pair.
    expect(screen.getByText('#2')).not.toBeNull()
    expect(screen.getByText('ranks 2nd of 14,855')).not.toBeNull()
    expect(screen.getByText('Hard for the solver')).not.toBeNull()
  })

  /** The criterion's own assertion, deliberately not folded into the one above. */
  test('sees the CC BY 4.0 attribution', () => {
    panel(freeFirstBoard)
    const footer = screen.getByTestId('insights-attribution')
    expect(footer.textContent).toContain('FiveLetterWords.io, research release v2026-09-01')
    expect(footer.textContent).toContain('CC BY 4.0')
  })

  test('and the licence text links to the licence', () => {
    panel(freeFirstBoard)
    const link = screen
      .getByTestId('insights-attribution')
      .querySelector('a[href="https://creativecommons.org/licenses/by/4.0/"]')
    expect(link?.textContent).toBe('CC BY 4.0')
  })

  /*
    RENDERED, NOT JUST RETURNED. lib/insights-panel.test.ts pins what `upsellFor`
    says for each tier; this pins that the panel actually puts it on the page for
    the tier that most needs it, and that the two benefits a free player CANNOT
    SEE AT ALL are the ones named — Layer 2 does not render for them at all
    (layer2 'none') and TeamSection gives them one daily fact instead of the
    panel, so nothing else on their screen hints that either exists.
  */
  test('is told what pro would add, including the two layers invisible to them', () => {
    panel(freeFirstBoard)
    const copy = screen.getByTestId('insights-upsell').textContent
    expect(copy).toContain('every board')
    expect(copy).toContain('your full playing history')
    expect(copy).toContain('your team’s analytics')
  })

  test('and is not promised team analytics when they are on no team', () => {
    panel(freeFirstBoard, false)
    const copy = screen.getByTestId('insights-upsell').textContent
    expect(copy).toContain('your full playing history')
    expect(copy).not.toMatch(/team/i)
  })

  /*
    The pitch is absent rather than partial while getMyTeams is in flight. Asserted
    on the RENDER because "withheld" is a property of the page, not of the string:
    returning null and rendering an empty <p> are the same value and different
    pages.
  */
  test('and sees no pitch at all until team membership resolves', () => {
    // NOT `panel(freeFirstBoard, undefined)`: a default parameter is applied for
    // an argument that IS undefined, so the helper would silently hand the panel
    // `true` and this test would assert the opposite of its name. Rendered
    // directly so the unresolved value is the one that reaches the component.
    render(createElement(InsightsPanel, { benchmark, data: freeFirstBoard, onATeam: undefined }))
    expect(screen.queryByTestId('insights-upsell')).toBeNull()
  })
})

describe('the absent states', () => {
  /**
   * The fault this whole panel is written to avoid. A missing benchmark rendering
   * as 0 reads as a real and extreme result — "ranks 0th of 14,855" is a claim
   * about the worst opener in the language.
   */
  test('an opener the corpus does not hold says so, and never shows a zero', () => {
    panel({
      access: { layer1: 'free', layer2: 'none', layer3: 'free' },
      boards: [{ puzzleDay: '2026-09-02', guesses: ['XXXXX'] }],
    })
    const board = screen.getByTestId('insights-board')
    expect(board.textContent).toContain('is not in the benchmark set')
    expect(board.textContent).not.toContain('0th')
    expect(board.textContent).not.toContain('0 of')
  })

  test('a day the corpus does not cover says so, and never shows 0%', () => {
    // The most common case there is: today is never rated, because the source
    // aggregates only globally completed days.
    panel({
      access: { layer1: 'free', layer2: 'none', layer3: 'free' },
      boards: [{ puzzleDay: '2026-12-25', guesses: ['CRANE'] }],
    })
    const board = screen.getByTestId('insights-board')
    expect(board.textContent).toContain('not rated yet')
    expect(board.textContent).not.toContain('0%')
    // The half that still works must survive the half that does not.
    expect(board.textContent).toContain('2nd of 14,855')
  })
})

describe('a pro player', () => {
  test('sees every board and is not sold anything', () => {
    panel({
      access: { layer1: 'full', layer2: 'full', layer3: 'full' },
      boards: [
        { puzzleDay: '2026-09-03', guesses: ['CRANE'] },
        { puzzleDay: '2026-09-02', guesses: ['ORATE'] },
        { puzzleDay: '2026-09-01', guesses: ['SLANT'] },
      ],
    })
    expect(screen.getAllByTestId('insights-board')).toHaveLength(3)
    expect(screen.queryByTestId('insights-upsell')).toBeNull()
  })

  test('still sees the attribution, which is not a free-tier feature', () => {
    panel({ access: { layer1: 'full', layer2: 'full', layer3: 'full' }, boards: [{ puzzleDay: '2026-09-01', guesses: ['SLANT'] }] })
    expect(screen.getByTestId('insights-attribution').textContent).toContain('CC BY 4.0')
  })
})

describe('Layer 2 — personal history', () => {
  const history = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      puzzleDay: `2026-09-${String(i + 1).padStart(2, '0')}`,
      // Two openers so the headline has something to compare against.
      guesses: i % 3 === 0 ? ['ORATE', 'SPEED'] : ['CRANE', 'MOIST', 'SPEED'],
      answer: 'SPEED',
    }))

  test('is not rendered at all for a free player', () => {
    // The paywall. Layer 2 is pro or trial; a free player must not see it, and
    // must not see a locked shell of it either.
    panel({ access: { layer1: 'free', layer2: 'none', layer3: 'free' }, boards: history(20) })
    expect(screen.queryByTestId('insights-personal')).toBeNull()
    expect(screen.queryByTestId('insights-personal-thin')).toBeNull()
  })

  test('leads with the join, which is the sentence worth paying for', () => {
    panel({ access: { layer1: 'full', layer2: 'full', layer3: 'full' }, boards: history(12) })
    const headline = screen.getByTestId('insights-headline').textContent ?? ''
    expect(headline).toContain('You have opened with')
    expect(headline).toContain('CRANE')
    expect(headline).toContain('It ranks')
    // The comparison half — the thing a rank column alone would not say.
    expect(headline).toContain('ORATE')
  })

  test('shows the repertoire, the streaks and the months', () => {
    panel({ access: { layer1: 'full', layer2: 'full', layer3: 'full' }, boards: history(12) })
    expect(screen.getByTestId('insights-repertoire')).not.toBeNull()
    expect(screen.getByTestId('insights-consistency')).not.toBeNull()
    expect(screen.getByTestId('insights-months')).not.toBeNull()
  })

  test('an unranked opener reads as unranked, never as rank 0', () => {
    panel({
      access: { layer1: 'full', layer2: 'full', layer3: 'full' },
      boards: Array.from({ length: 6 }, (_, i) => ({
        puzzleDay: `2026-09-0${i + 1}`,
        guesses: ['XXXXX', 'SPEED'],
        answer: 'SPEED',
      })),
    })
    const repertoire = screen.getByTestId('insights-repertoire').textContent ?? ''
    expect(repertoire).toContain('unranked')
    expect(repertoire).not.toContain('0th')
  })

  /*
    The designed state for 368 of 392 accounts, per the spec — not a bug.

    THE COPY CHANGED FROM "Enter a few more boards and we will show you…" TO
    UnlockPrompt's "X unlocks at N boards — value" FORM, as part of moving this
    branch out of the old PersonalHistory into InsightsPanel (see
    routes/insights.tsx's comment on that move). The old sentence named what
    was coming but not how close the player was to it; UnlockPrompt adds the
    distance (a "2 / 5" progress readout) on top of the same value clause,
    carried over verbatim below. This assertion is updated to the new wording
    rather than the old one because that is a deliberate copy change, not a
    regression — it still proves the thin state names the concrete value AND
    now also proves the floor and progress are stated, which the old assertion
    could not check at all.
  */
  test('a thin history says so instead of showing a mean over two boards', () => {
    panel({ access: { layer1: 'full', layer2: 'full', layer3: 'full' }, boards: history(2) })
    const thin = screen.getByTestId('insights-personal-thin').textContent ?? ''
    expect(thin).toContain('Your history unlocks at 5 boards')
    expect(thin).toContain(
      'your opening repertoire, your streaks and how your scores move month to month',
    )
    expect(thin).toContain('2 / 5')
    expect(screen.queryByTestId('insights-personal')).toBeNull()
  })
})

describe('the layout, so nothing is buried', () => {
  const history = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      puzzleDay: `2026-09-${String(n - i).padStart(2, '0')}`,
      guesses: i % 2 === 0 ? ['CRANE', 'SPEED'] : ['ORATE', 'SPEED'],
      answer: 'SPEED',
    }))

  /**
   * THE REGRESSION THIS PAGE SHIPPED WITH. A pro player holds up to 400 boards, and
   * rendering one card each ABOVE the summaries buried both paid panels under
   * roughly four hundred screens of scroll — reported as "Your Team and Your
   * History are buried below miles of daily insights".
   */
  test('the summaries come before the day-by-day list in the DOM', () => {
    panel({ access: { layer1: 'full', layer2: 'full', layer3: 'full' }, boards: history(30) })

    const personal = screen.getByTestId('insights-personal')
    const daily = screen.getByTestId('insights-daily')
    // Node.compareDocumentPosition: 4 means `daily` FOLLOWS `personal`.
    expect(personal.compareDocumentPosition(daily) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('the day-by-day list is a bounded scroll container, not a wall', () => {
    panel({ access: { layer1: 'full', layer2: 'full', layer3: 'full' }, boards: history(30) })

    const scroller = screen.getByTestId('insights-daily-scroll')
    // overflow-y-auto does nothing without an explicit max height.
    expect(scroller.className).toContain('overflow-y-auto')
    expect(scroller.className).toContain('max-h-')
    expect(screen.getAllByTestId('insights-board')).toHaveLength(30)
  })

  test('and says how many it is showing, since a touch device has no scrollbar', () => {
    panel({ access: { layer1: 'full', layer2: 'full', layer3: 'full' }, boards: history(30) })
    expect(screen.getByTestId('insights-daily-count').textContent).toBe('Showing 30 of 30 boards')
  })
})

describe('the day-by-day filters', () => {
  const boards = [
    { puzzleDay: '2026-09-03', guesses: ['CRANE', 'SPEED'], answer: 'SPEED' },
    { puzzleDay: '2026-09-02', guesses: ['ORATE', 'SPEED'], answer: 'SPEED' },
    { puzzleDay: '2026-08-30', guesses: ['CRANE', 'SPEED'], answer: 'SPEED' },
  ]
  const pro = { access: { layer1: 'full' as const, layer2: 'full' as const, layer3: 'full' as const }, boards }

  test('filtering by month narrows the list and the count', () => {
    panel(pro)
    fireEvent.change(screen.getByTestId('insights-filter-month'), { target: { value: '2026-08' } })

    expect(screen.getAllByTestId('insights-board')).toHaveLength(1)
    expect(screen.getByTestId('insights-daily-count').textContent).toBe('Showing 1 of 3 boards')
  })

  test('filtering by opener does too', () => {
    panel(pro)
    fireEvent.change(screen.getByTestId('insights-filter-opener'), { target: { value: 'ORATE' } })
    expect(screen.getAllByTestId('insights-board')).toHaveLength(1)
  })

  test('and the two combine', () => {
    panel(pro)
    fireEvent.change(screen.getByTestId('insights-filter-month'), { target: { value: '2026-09' } })
    fireEvent.change(screen.getByTestId('insights-filter-opener'), { target: { value: 'CRANE' } })
    expect(screen.getAllByTestId('insights-board')).toHaveLength(1)
  })

  test('a combination matching nothing says so rather than showing everything', () => {
    panel(pro)
    fireEvent.change(screen.getByTestId('insights-filter-month'), { target: { value: '2026-08' } })
    fireEvent.change(screen.getByTestId('insights-filter-opener'), { target: { value: 'ORATE' } })

    expect(screen.getByTestId('insights-daily-none')).not.toBeNull()
    expect(screen.queryAllByTestId('insights-board')).toHaveLength(0)
  })

  test('the opener select is ordered by the player’s own use', () => {
    panel(pro)
    const options = [...screen.getByTestId('insights-filter-opener').querySelectorAll('option')]
    expect(options.map((o) => o.textContent)).toEqual(['All openers', 'CRANE', 'ORATE'])
  })

  test('no filters at all on a single board — furniture that explains nothing', () => {
    panel({ access: { layer1: 'free', layer2: 'none', layer3: 'free' }, boards: [boards[0]] })
    expect(screen.queryByTestId('insights-filter-month')).toBeNull()
    expect(screen.queryByTestId('insights-daily-count')).toBeNull()
  })
})

describe('the trial must not see Layer 1’s full history', () => {
  /**
   * The query returns full history whenever Layer 2 is unlocked, and the trial
   * unlocks Layer 2 WITHOUT Layer 1. Rendering the payload directly showed a
   * trialist every benchmark card — the paid Layer 1 slice, during the trial.
   */
  test('a trialist sees one benchmark board and the full personal history', () => {
    panel({
      access: { layer1: 'free', layer2: 'full', layer3: 'full' },
      boards: Array.from({ length: 12 }, (_, i) => ({
        puzzleDay: `2026-09-${String(12 - i).padStart(2, '0')}`,
        guesses: ['CRANE', 'SPEED'],
        answer: 'SPEED',
      })),
    })

    expect(screen.getAllByTestId('insights-board')).toHaveLength(1)
    expect(screen.getByTestId('insights-personal')).not.toBeNull()
  })
})

describe('InsightsScope', () => {
  const scope = (data: Parameters<typeof InsightsScope>[0]['data']) =>
    render(createElement(InsightsScope, { data }))

  test('renders nothing for undefined', () => {
    scope(undefined)
    expect(screen.queryByTestId('insights-scope')).toBeNull()
  })

  test('renders nothing for null', () => {
    scope(null)
    expect(screen.queryByTestId('insights-scope')).toBeNull()
  })

  test('renders nothing for an empty boards array', () => {
    scope({ access: { layer1: 'full', layer2: 'full', layer3: 'full' }, boards: [] })
    expect(screen.queryByTestId('insights-scope')).toBeNull()
  })

  /*
    THE BOARDS ARE DELIBERATELY OUT OF CHRONOLOGICAL ORDER. This is the case that
    catches a wrong reduce seed or a flipped `<` comparator — either bug would
    still pass if the fixture happened to already be sorted earliest-first.
  */
  test('finds the earliest board’s month, given boards not in chronological order', () => {
    scope({
      access: { layer1: 'full', layer2: 'full', layer3: 'full' },
      boards: [
        { puzzleDay: '2026-09-03', guesses: ['CRANE'] },
        { puzzleDay: '2026-08-15', guesses: ['ORATE'] },
        { puzzleDay: '2026-09-01', guesses: ['SLANT'] },
      ],
    })
    expect(screen.getByTestId('insights-scope').textContent).toContain('since Aug 2026')
  })

  test('singular "board" for exactly one', () => {
    scope({
      access: { layer1: 'free', layer2: 'none', layer3: 'free' },
      boards: [{ puzzleDay: '2026-09-03', guesses: ['CRANE'] }],
    })
    expect(screen.getByTestId('insights-scope').textContent).toContain('1 board ·')
  })

  test('plural "boards" otherwise', () => {
    scope({
      access: { layer1: 'full', layer2: 'full', layer3: 'full' },
      boards: [
        { puzzleDay: '2026-09-03', guesses: ['CRANE'] },
        { puzzleDay: '2026-09-02', guesses: ['ORATE'] },
      ],
    })
    expect(screen.getByTestId('insights-scope').textContent).toContain('2 boards ·')
  })
})

/*
  TeamSection ITSELF IS NOT EXPORTED, AND RENDERING IT DIRECTLY THROUGH
  InsightsPanel CANNOT REACH ITS BRANCHES — the global `@tanstack/react-query`
  mock above answers every `useQuery` call, from both `getMyTeams` and
  `teamMonth`, with the SAME `{ data: undefined }`, so `teams` and `teamId` are
  both always undefined in this file (see the comment on that mock) and the ONLY
  branch reachable by rendering here is "we do not know yet", which renders
  nothing. The no-team card needs a LOADED, EMPTY roster and the loading frame
  needs `teamId` truthy with `data` falsy; neither is producible from a mock that
  answers every call the same way, and making it call-aware is a bigger, riskier
  change than this coverage gap justifies (today-panel.hook.test.ts's own comment
  documents the same jsdom-cwd tradeoff for the same reason: read the real source
  rather than invent scaffolding around it).

  So this reads the real source instead, the same fallback today-panel.hook.test.ts
  uses for a hazard a render cannot reach. What it guards is not "these branches
  exist" (no-team-card.hook.test.ts and the render tests above already cover the
  shapes each branch produces) but that they stay SEPARATE — this is the
  regression wordle-teams-wty4.1.11.8 fixed: `if (!teamId || !data) return null`
  silently swallowed the "no team" case into the same null the "still loading"
  case produces, and nothing here would fail if that collapse came back, since a
  mocked `useQuery` that only ever returns `{ data: undefined }` makes `!teamId`
  and `!data` true at the exact same time on every render.

  THERE ARE THREE STATES NOW, NOT TWO, AND THE THIRD ARRIVED WITH `?team=`. Once
  the team comes from a search param, a missing `teamId` stopped meaning "this
  player has no team": it is equally true while getMyTeams is in flight and for
  the render or two before the route's effect settles the param. Rendering the
  no-team card for those — which is what the two-state shape did once the param
  landed — tells a player who HAS a team that they have none and links them away
  to go join one. That is the same conflation as the original defect coming back
  through a new door, so the card is now gated on a LOADED, EMPTY roster and the
  unresolved case renders nothing, like the loading frame beside it.

  The assertions below therefore pin the SHAPE of all three guards, not just
  their separateness: the first fails if NoTeamCard can render while the roster
  is still unknown, and the last still fails for any recombination.

  AND THEIR ORDER, WHICH IS LOAD-BEARING AND IS NOT OBVIOUS FROM READING THREE
  ADJACENT ONE-LINE GUARDS. The roster question must be asked BEFORE the param
  question: an empty roster also yields `teamId === undefined`, so moving
  `if (!teamId) return null` above the card makes the card UNREACHABLE and hands
  a player on no team the blank page wordle-teams-wty4.1.11.8 was filed for —
  the same regression, reached by reordering rather than by recombining. Every
  content assertion here passes under that swap, which is why the order gets an
  assertion of its own.
*/
describe('TeamSection tells "no team", "not resolved yet" and "still loading" apart', () => {
  const source = readFileSync('src/routes/insights.tsx', 'utf8')
  // Isolate the function body — TeamSection is the last thing the module
  // defines, so slicing from its signature to end-of-file is exact and does
  // not risk matching an unrelated `if` elsewhere in the route.
  const teamSection = source.slice(source.indexOf('function TeamSection'))

  test('NoTeamCard renders from one place only, and only for a LOADED, EMPTY roster', () => {
    // The whole line, and every line that mentions the card, so this fails both
    // ways: if the condition is weakened to something true while the roster is
    // unknown (`!teams?.length`, `!teamId`), and if a second render site for the
    // card appears anywhere else in the component.
    expect(teamSection.split('\n').filter((line) => line.includes('<NoTeamCard />'))).toEqual([
      '  if (teams !== undefined && teams.length === 0) return <NoTeamCard />',
    ])
  })

  test('an unresolved team renders null, as a SEPARATE statement', () => {
    // NOT the no-team card: a roster still in flight, or a `?team=` the effect
    // has not settled, is not a player without a team.
    expect(teamSection).toContain('if (!teamId) return null')
  })

  test('the roster question is asked BEFORE the param question, or the card is dead code', () => {
    // An empty roster leaves `teamId` undefined too, so a `!teamId` guard placed
    // first swallows the state NoTeamCard exists to name — the card still reads
    // correctly, it simply never runs. Index comparison rather than a regex over
    // the whole block: it says the one thing that matters and keeps saying it if
    // a fourth guard is added between these two.
    expect(teamSection.indexOf('<NoTeamCard />')).toBeLessThan(
      teamSection.indexOf('if (!teamId) return null'),
    )
  })

  test('unresolved data renders null, as a SEPARATE statement, not folded into the team check', () => {
    expect(teamSection).toContain('if (!data) return null')
  })

  test('the conditions are never recombined into one guard', () => {
    // The exact regression this issue was filed for: collapsing back to the
    // pre-fix shared guard would render `null` — an unexplained gap — for a
    // player with no team at all, instead of NoTeamCard.
    expect(teamSection).not.toContain('if (!teamId || !data)')
    expect(teamSection).not.toContain('if (!data || !teamId)')
    // And the shape this file pinned BEFORE the param arrived, which is the
    // other way the three states collapse back to two — it answers "has this
    // player a team" with a variable that is also undefined while nobody knows.
    expect(teamSection).not.toContain('if (!teamId) return <NoTeamCard />')
  })
})

/**
 * THE SHAPE GATE ON THE TWO PARAMS. `validateSearch` is the FIRST of the two
 * gates a query string anybody can write has to cross before this page acts on
 * it — the second is resolveInsightsSearch, which has its own tests — so it is
 * asserted directly rather than only through what it lets past, the same
 * treatment login-error.test.ts gives its own allowlist.
 *
 * REACHED WITHOUT THE `.options` HOP THAT FILE NEEDS: `createFileRoute` is
 * mocked at the top of this file to return its options object as-is, so `Route`
 * here IS that object. The cast is only to say so — tsc sees the real router's
 * types for this import, not the mock's.
 */
describe('validateSearch, the shape gate on ?team= and ?month=', () => {
  const validate = (
    Route as unknown as {
      validateSearch: (search: Record<string, unknown>) => { team?: string; month?: string }
    }
  ).validateSearch

  test('a string team and a well-formed month are kept exactly as spelled', () => {
    expect(validate({ team: 'k17abc', month: '2026-08' })).toEqual({
      team: 'k17abc',
      month: '2026-08',
    })
  })

  test('a non-string param is dropped rather than passed through', () => {
    // `?team=a&team=b` parses to an array, which is not a team id.
    expect(validate({ team: ['a', 'b'], month: 1 })).toEqual({ team: undefined, month: undefined })
  })

  test('a month that is not shaped like one is dropped', () => {
    // NOT VALIDITY — only shape. Whether '1999-01' is a month this team can be
    // viewed for is resolveInsightsSearch's question (it is not: the window is
    // capped at 12 months), and it is answered in the route's effect, which has
    // the team list and the viewer's clock that this function does not.
    expect(validate({ month: 'August' })).toEqual({ team: undefined, month: undefined })
    expect(validate({ month: '2026-8' })).toEqual({ team: undefined, month: undefined })
    expect(validate({ month: '2026-08-01' })).toEqual({ team: undefined, month: undefined })
  })

  test('an undeclared param does not survive validation at all', () => {
    // `validateSearch` is exhaustive, so this is not really a test of an `if`
    // anywhere — it pins the CONSEQUENCE, which is what a future editor needs to
    // know before adding a param to a link into this page. toStrictEqual rather
    // than toEqual: toEqual would treat a `join: undefined` key as absent, and
    // the point is that no third key comes out the other side.
    expect(validate({ team: 'k17abc', month: '2026-08', join: 'tok' })).toStrictEqual({
      team: 'k17abc',
      month: '2026-08',
    })
  })
})

/*
  THE PARAM WIRING IS READ FROM THE SOURCE, FOR THE REASON THE TeamSection BLOCK
  ABOVE ALREADY GIVES. `InsightsRoute` is deliberately unexported (src/routes.test.ts
  pins that the vite plugin stops code-splitting a route file whose routed
  identifier is exported), and the `@tanstack/react-router` mock in this file has
  no router in it, so the effect that fills the params in cannot be rendered at
  all — not "is awkward to render". What the decision itself does is covered by
  real tests in lib/insights-search.test.ts, against the pure resolver; these
  three tests cover only the WIRING around it, each of which has a specific,
  silent failure mode.
*/
describe('the route wires the params up without reopening old holes', () => {
  const routeSource = readFileSync('src/routes/insights.tsx', 'utf8')

  test('the search effect waits for hydration before reading the clock', () => {
    // wordle-teams-uc5: the fallback month comes from the viewer's LOCAL clock
    // and the server renders in UTC, so on the first and last day of a month an
    // unguarded read disagrees with itself across hydration. Deleting the guard
    // breaks nothing a render here would notice.
    expect(routeSource).toContain('if (!hydrated) return')
    expect(routeSource).toContain('currentMonth: monthOf(toPuzzleDay(new Date()))')
  })

  test('teamMonth is skipped through the sentinel, never through `enabled`', () => {
    // `enabled` DOES NOT GATE A CONVEX QUERY. @convex-dev/react-query opens the
    // watch from the query cache's `added` event, which TanStack fires for a
    // disabled query too, and its handler bails only on a query key whose args
    // are the string 'skip'. An `enabled` spread after convexQuery also
    // OVERRIDES the `enabled: false` the sentinel sets, so the two together are
    // worse than the sentinel alone. Both halves are checked because the month
    // arrives from the URL and is undefined until the effect lands.
    const teamSection = routeSource.slice(routeSource.indexOf('function TeamSection'))
    // The colon is load-bearing in the second assertion, not sloppiness: the
    // paragraph above this query in the source has to NAME `enabled` to explain
    // why it is absent, so the bare word is in the file either way. What must
    // not come back is the option.
    expect(teamSection).toContain("teamId && month ? { teamId, month } : 'skip'")
    expect(teamSection).not.toContain('enabled:')
  })

  test('the selected team is written to the dashboard’s remembered-team key', () => {
    // THE DIFFERENCE FROM routes/team.tsx IS DELIBERATE — that page only READS
    // this key, having no team control of its own to keep it in sync with. A
    // future editor who "harmonises" the two by deleting this write would lose
    // the property it exists for: a team picked on /insights follows the player
    // back to the dashboard.
    expect(routeSource).toContain('localStorage.setItem(STORAGE_KEY, teamParam)')
  })
})
