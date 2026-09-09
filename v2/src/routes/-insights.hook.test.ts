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

/*
  TeamSection (Layer 3) issues its own queries, so rendering the panel with
  layer3 'full' pulls react-query in. Mocked to report nothing loaded, which makes
  TeamSection render null — this file is about Layers 1 and 2, and Layer 3's own
  statistics are covered in lib/insights-team.test.ts against fixtures.
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

const panel = (data: Parameters<typeof InsightsPanel>[0]['data']) =>
  render(createElement(InsightsPanel, { benchmark, data }))

describe('a free player on their first board', () => {
  const freeFirstBoard = {
    access: { layer1: 'free' as const, layer2: 'none' as const, layer3: 'free' as const },
    boards: [{ puzzleDay: '2026-09-03', guesses: ['CRANE', 'SPEED'] }],
  }

  test('sees the benchmark for it', () => {
    panel(freeFirstBoard)
    expect(screen.getAllByTestId('insights-board')).toHaveLength(1)
    expect(screen.getByText('CRANE')).not.toBeNull()
    expect(screen.getByText('2nd of 14,855')).not.toBeNull()
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

  test('is told what pro would add', () => {
    panel(freeFirstBoard)
    expect(screen.getByTestId('insights-upsell').textContent).toContain('every board')
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

  /** The designed state for 368 of 392 accounts, per the spec — not a bug. */
  test('a thin history says so instead of showing a mean over two boards', () => {
    panel({ access: { layer1: 'full', layer2: 'full', layer3: 'full' }, boards: history(2) })
    expect(screen.getByTestId('insights-personal-thin').textContent).toContain(
      'Enter a few more boards',
    )
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
