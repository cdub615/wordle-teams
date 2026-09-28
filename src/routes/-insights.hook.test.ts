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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import type { Id } from '../../convex/_generated/dataModel'

/*
  THE ROUTE MODULE IMPORTS react-query FOR ITS OWN TWO QUERIES — the benchmark
  boards and the roster — so importing it here pulls the library in whether or
  not anything below renders. Mocked to report nothing loaded.

  LAYER 3 NO LONGER COMES IN WITH IT (wordle-teams-kkhj). TeamSection is a
  separate module now and is handed to InsightsPanel as a node, which nothing in
  this file passes — so the `teamMonth` query this mock used to have to answer is
  not issued here at all. Layer 3's branches are covered in
  components/insights/team-section.hook.test.ts, its statistics in
  lib/insights-team.test.ts, and the no-team card's own shape in
  no-team-card.hook.test.ts.
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
  // Imported by the route module and never called here — the routed component
  // is not rendered in this file. Declared anyway so the mock matches the
  // module's real import surface rather than relying on that staying true.
  useNavigate: () => () => undefined,
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
  THE PANEL NO LONGER NAVIGATES, AND NO LONGER BUILDS LAYER 3 (wordle-teams-kkhj).
  TeamSection is its own component in components/insights/, handed to this panel
  as a node by the route, so `team`, `month`, `onTeamChange` and `onMonthChange`
  — four props this component never read — are gone from its surface. Nothing in
  this file passes a `teamSection`, because nothing in this file is about Layer 3
  any more: those assertions moved to components/insights/team-section.hook.test.ts,
  where they render the component directly.
*/

/**
 * A one-team roster, which is what `onATeam: true` used to be spelled as.
 *
 * THE MOST COPY, NOT THE LEAST, and that is why it is the default: the upsell
 * names the team layer only for a player who HAS a team, so a default of `[]` or
 * `undefined` would quietly assert less than the panel can say and let a
 * regression in the team clause through. Each test about the other two states
 * passes its own roster explicitly.
 *
 * `Id<'teams'>` is a branded string, so a literal needs the cast. Nothing here
 * dereferences it.
 */
const ONE_TEAM = [{ id: 'team_a' as Id<'teams'>, name: 'Ada’s Analysts' }]

const panel = (
  data: Parameters<typeof InsightsPanel>[0]['data'],
  teams: Array<{ id: Id<'teams'>; name: string }> | undefined = ONE_TEAM,
) => render(createElement(InsightsPanel, { benchmark, data, teams }))

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
    // AN EMPTY ROSTER, WHICH IS WHAT `onATeam: false` USED TO BE SPELLED AS.
    // `onATeamFrom` is the one derivation now, so a loaded-and-empty roster is
    // the only way to reach this branch — and `undefined` (below) cannot be
    // mistaken for it.
    panel(freeFirstBoard, [])
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
    render(createElement(InsightsPanel, { benchmark, data: freeFirstBoard, teams: undefined }))
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

    // AND `relative`, WHICH IS THE ONE THAT LOOKS REMOVABLE (wordle-teams-m08r).
    // Nothing in the list is positioned against this box, so the class reads as
    // dead weight -- but board-row.tsx renders an `sr-only` span per row, and
    // `sr-only` is `position: absolute`. An absolutely positioned element is
    // clipped by an ancestor's overflow only if that ancestor is its containing
    // block, so with a `static` scroller every one of these escapes the bound
    // above and extends the DOCUMENT instead -- 7160px past the footer, on the
    // ninety boards e2e seeds.
    //
    // THIS ASSERTION CANNOT SEE THAT, and says so rather than implying
    // otherwise: jsdom computes no layout, so it pins the CLASS and
    // e2e/insights.spec.ts pins the CONSEQUENCE. It is here because the class
    // is the thing a later reader would delete as unused.
    expect(scroller.className).toContain('relative')
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
  LAYER 3 IS NOT THIS FILE'S SUBJECT ANY MORE (wordle-teams-kkhj).

  The three-state guard — "no team" versus "not resolved yet" versus "the
  aggregate is still in flight" — and the source assertions that hold the order
  of those guards moved WITH TeamSection, to
  components/insights/team-section.hook.test.ts. They render the component
  directly there, which is strictly better than reaching it through this panel:
  the two states that were reachable here still are, and the file that owns them
  is the file named after them.

  WHAT STAYS BELOW is the route's own: the two params this page fills in, and
  the remembered team it writes. Those are properties of InsightsRoute, which
  cannot be rendered under vitest at all.
*/

/*
  THE SEARCH-PARAM SYNC IS NOT READ OUT OF THIS FILE'S SOURCE ANY MORE
  (wordle-teams-1ubk).

  Three assertions used to live here as `expect(routeCode).toContain(...)` over
  the route's text — that the effect waits for hydration, that the fallback month
  comes from the local clock, and that the selected team is written to
  STORAGE_KEY — with a paragraph explaining why: InsightsRoute cannot be rendered
  under vitest at all, so there was nothing to render.

  A HOOK CAN BE RENDERED. The effect is lib/use-search-sync.ts now, shared with
  /app, and lib/use-search-sync.hook.test.ts DRIVES it through renderHook: it
  asserts that nothing navigates before hydration, that the month the resolver is
  handed is the browser's own, and that the key is actually written. Three
  source-text matchers became three behavioural tests, and a rename of a local
  can no longer fail them — nor a restructure pass them while the property is
  gone.

  What is left below is `validateSearch`, which is a plain function on the route
  object and was never a source assertion.
*/

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
