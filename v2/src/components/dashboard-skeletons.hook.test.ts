// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because the
// first half of this file renders the real components. `.hook.test.ts` matches
// the existing precedents, and `.test.ts` rather than `.test.tsx` because
// vitest.config.ts's glob is `src/**/*.test.ts`, so the elements below go
// through `createElement` by hand.
//
// WHY THIS FILE EXISTS: NONE OF wordle-teams-9ahw IS VISIBLE TO A GATE.
// Deleting a `<Suspense>` boundary from routes/app.tsx type-checks, lints,
// builds, and passes all 1305 other tests — the page simply blanks again on
// every team or month switch, which is the defect being fixed. So is dropping
// a fallback's `className`, which reinstates the layout jump. Both are one-line
// edits that look harmless in review.
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import {
  DashboardSkeleton,
  ScoresTableSkeleton,
  ScoringSystemCardSkeleton,
  TeamBoardsSkeleton,
} from './dashboard-skeletons.tsx'
import { parseSource } from '#/test-support/source-ast.ts'
import { SYSTEM_FIELDS } from '../../convex/lib/scoringSystem.ts'

afterEach(cleanup)

/** Every element carrying the pulse, which is what "loading" looks like here. */
const pulsing = () => document.querySelectorAll('.animate-pulse')

/**
 * COUNTED OUT OF THE DOM, NOT THROUGH `getAllByRole` — AND THE REASON IS ONE OF
 * THIS FILE'S OWN ASSERTIONS. Every skeleton root carries `aria-hidden="true"`
 * on purpose (see the last test in the block below), which removes its whole
 * subtree from the accessibility tree, so a role query correctly finds nothing:
 * "Unable to find an accessible element with the role columnheader". Passing
 * `{ hidden: true }` would work and would also make these tests pass if the
 * aria-hidden were ever dropped, which is exactly the coupling to avoid — the
 * two facts should be able to fail independently.
 */
const headerCells = () => document.querySelectorAll('th')
const rows = () => document.querySelectorAll('tr')

describe('the skeletons are the shape of the things they stand in for', () => {
  test('the scores table has one column per day of the month it is loading', () => {
    // DERIVED, NOT HARDCODED, AND THIS IS WHERE v2 IMPROVES ON v1: v1's
    // skeleton-rows.tsx lists THIRTY day cells as literal JSX, so its skeleton
    // is a column too wide in February and a column too narrow in January, and
    // the table jumps sideways as it resolves. 30 is also the one length that
    // makes a wrong-length bug invisible in four months of the year.
    render(createElement(ScoresTableSkeleton, { month: '2026-02' }))

    // +2 for the pinned Player and Score columns either side of the days.
    expect(headerCells()).toHaveLength(28 + 2)

    cleanup()
    render(createElement(ScoresTableSkeleton, { month: '2026-01' }))
    expect(headerCells()).toHaveLength(31 + 2)
  })

  test('a leap February is 29, because daysOfMonth is doing the counting', () => {
    // The assertion that separates "derived" from "derived from something that
    // happens to agree with a hardcoded table most of the time".
    render(createElement(ScoresTableSkeleton, { month: '2028-02' }))

    expect(headerCells()).toHaveLength(29 + 2)
  })

  test('the scoring card has one row per scoring field, so it cannot drift', () => {
    // SYSTEM_FIELDS is the same array scoring-system-card.tsx maps over, and it
    // is itself derived from DEFAULT_SYSTEM's keys — so adding a scoring rule
    // changes the card and this skeleton together. A hardcoded count here would
    // silently become the wrong height the day a field is added.
    render(createElement(ScoringSystemCardSkeleton))

    // +1 for the Attempts/Points header row.
    expect(rows()).toHaveLength(SYSTEM_FIELDS.length + 1)
  })

  test('the table draws one row per team member, not a fixed three', () => {
    // THE HEIGHT HALF OF THE SIZING FIX. v1 draws three rows unconditionally, so
    // its skeleton is the wrong height for every team that is not exactly three
    // players and the grid jumps vertically as the table lands. The count is
    // knowable here: team membership comes from api.teams.getMyTeams, which does
    // NOT suspend on a team or month change, so routes/app.tsx already has it
    // when it renders this fallback.
    render(createElement(ScoresTableSkeleton, { month: '2026-09', rows: 5 }))

    // +1 for the header row.
    expect(rows()).toHaveLength(5 + 1)
  })

  test('and never draws zero rows, however small the team', () => {
    // A one-person team is real, and `rows={0}` would be a table with a header
    // and nothing under it — which reads as "loaded, and empty" rather than as
    // "loading". Math.max(1, rows) is what stops that.
    render(createElement(ScoresTableSkeleton, { month: '2026-09', rows: 0 }))

    expect(rows()).toHaveLength(1 + 1)
  })

  test('every skeleton actually pulses', () => {
    // The whole ask was "pulse animation for loading states". A skeleton that
    // renders the right boxes and does not animate is indistinguishable from
    // an empty component that has finished loading.
    render(createElement(TeamBoardsSkeleton))

    expect(pulsing().length).toBeGreaterThan(0)
  })

  test('the pulse comes from ui/skeleton.tsx and not a second implementation', () => {
    // `animate-pulse bg-muted` is Skeleton's own pair, and v1 used the same
    // primitive. A hand-rolled `animate-pulse bg-gray-900` — which is exactly
    // what v1's own dashboard-skeleton.tsx does — would be a colour outside the
    // token system, which styles.css rule 1 forbids in a component.
    render(createElement(TeamBoardsSkeleton))

    for (const element of pulsing()) {
      expect(element.className).toContain('bg-muted')
      expect(element.className).not.toMatch(/bg-(gray|zinc|neutral|slate)-\d/)
    }
  })

  test('the grid class passes through, which is what stops the layout jumping', () => {
    // A fallback that drops `md:col-span-3` collapses its neighbours into the
    // gap and then shoves them back when the real content arrives — the
    // reported problem restated rather than fixed.
    render(createElement(ScoresTableSkeleton, { month: '2026-08', className: 'md:col-span-3' }))
    expect(document.querySelector('[data-slot="scores-table-skeleton"]')?.className).toContain(
      'md:col-span-3',
    )

    cleanup()
    render(createElement(TeamBoardsSkeleton, { className: 'md:row-span-3' }))
    expect(document.querySelector('[data-slot="team-boards-skeleton"]')?.className).toContain(
      'md:row-span-3',
    )
  })

  test('the full-grid skeleton mirrors the dashboard grid it precedes', () => {
    // routes/app.tsx's own comment calls `grid-cols-1` load-bearing rather than
    // decorative: without a grid-cols-* at the base breakpoint the single
    // implicit column is `auto`, whose max sizing is max-content, and one long
    // team name widens the whole page. A skeleton that omits it reintroduces
    // that on exactly the frames where nothing else is on screen to hide it.
    render(createElement(DashboardSkeleton))

    const grid = document.querySelector('[data-slot="dashboard-skeleton"]')
    expect(grid?.className).toContain('grid-cols-1')
    expect(grid?.className).toContain('md:grid-cols-3')
  })

  test('none of it is announced to a screen reader', () => {
    // A skeleton has no content — reading out a dozen empty boxes is worse than
    // silence, and the real content announces itself when it lands.
    render(createElement(DashboardSkeleton))

    expect(document.querySelector('[data-slot="dashboard-skeleton"]')?.getAttribute('aria-hidden'))
      .toBe('true')
  })
})

/**
 * THE WIRING, READ OUT OF routes/app.tsx AS SOURCE.
 *
 * That file cannot be imported by a test — `createFileRoute` registers against
 * a router that does not exist under vitest, which is why routes.test.ts reads
 * it as text too. So the source IS the artefact, and it is read with the
 * compiler rather than a regex for the reason src/test-support/source-ast.ts
 * gives at length: a string match on the whole file is satisfied by the text
 * sitting somewhere it does nothing.
 *
 * ASSERTED AS PAIRS — which component each boundary WRAPS — rather than as
 * "three Suspense elements exist". A boundary around the wrong component, or
 * around nothing, is the mutation a count cannot see.
 */
describe('routes/app.tsx wraps every suspending panel in its own boundary', () => {
  // A cwd-relative path, NOT `new URL(..., import.meta.url)`. Every other
  // source-reading suite here resolves that way, but they all run under the
  // default edge-runtime environment; this file declares jsdom for the render
  // half above, and under jsdom `import.meta.url` is not a `file:` URL —
  // readFileSync answers "The URL must be of scheme file". vitest runs with the
  // project root as cwd, which styles.test.ts's own source scan also relies on.
  const source = readFileSync('src/routes/app.tsx', 'utf8')

  /** Each `<Suspense>` in the file, as (fallback source text, wrapped tag). */
  const boundaries = (): Array<{ fallback: string; child: string }> => {
    const found: Array<{ fallback: string; child: string }> = []
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'Suspense') {
        const fallbackAttr = node.openingElement.attributes.properties.find(
          (property) => ts.isJsxAttribute(property) && property.name.getText() === 'fallback',
        )
        const initializer =
          fallbackAttr && ts.isJsxAttribute(fallbackAttr) ? fallbackAttr.initializer : undefined
        const fallback =
          initializer && ts.isJsxExpression(initializer) && initializer.expression
            ? initializer.expression.getText()
            : ''

        // The one element child, ignoring the whitespace JSX records between tags.
        const child = node.children.find(
          (candidate) => ts.isJsxElement(candidate) || ts.isJsxSelfClosingElement(candidate),
        )
        const childTag = child
          ? ts.isJsxElement(child)
            ? child.openingElement.tagName.getText()
            : child.tagName.getText()
          : ''

        found.push({ fallback, child: childTag })
      }
      ts.forEachChild(node, visit)
    }
    visit(parseSource('app.tsx', source))
    return found
  }

  test('all four dashboard-grid getTeamMonth consumers are wrapped, each by its own skeleton', () => {
    // THE FOUR THAT SUSPEND TOGETHER, ON THE GRID ITSELF. scores-table.tsx:36,
    // teams/team-boards.tsx:50, today-panel.tsx and scoring-legend.tsx all call
    // useSuspenseQuery on api.scores.getTeamMonth keyed by (teamId, month), so
    // a switch re-keys all four at once. Missing any one of them leaves the
    // grid blanking on every switch, just less of it.
    //
    // ScoringSystemCard READS THE SAME QUERY TOO, but it moved off this grid
    // in Task 9 — it now lives inside TeamSettingsDialog (see that
    // component's own source), mounted only once the dialog is open on the
    // Scoring tab, with its own Suspense boundary there rather than one of
    // these four.
    const wrapped = boundaries().map((boundary) => boundary.child)

    expect(wrapped.sort()).toEqual(['ScoresTable', 'ScoringLegend', 'TeamBoards', 'TodayPanel'])
  })

  test('each fallback is the skeleton for the component it wraps, not a generic one', () => {
    // Crossing two fallbacks type-checks and renders something plausible —
    // both are components taking an optional className — so only this notices.
    const byChild = new Map(boundaries().map((boundary) => [boundary.child, boundary.fallback]))

    expect(byChild.get('ScoresTable')).toContain('ScoresTableSkeleton')
    expect(byChild.get('TeamBoards')).toContain('TeamBoardsSkeleton')
    expect(byChild.get('TodayPanel')).toContain('TodayPanelSkeleton')
    expect(byChild.get('ScoringLegend')).toContain('ScoringLegendSkeleton')
  })

  test('the fallbacks carry the same grid classes as the components they replace', () => {
    // The layout-jump half, and it is separately mutable: a boundary can be
    // perfectly placed with a fallback that collapses the grid underneath it.
    // Every one of these four is full width, unlike the retired
    // ScoringSystemCard boundary this suite used to check for, which carried
    // no grid class at all.
    const byChild = new Map(boundaries().map((boundary) => [boundary.child, boundary.fallback]))

    expect(byChild.get('ScoresTable')).toContain('md:col-span-3')
    expect(byChild.get('TeamBoards')).toContain('md:col-span-3')
    expect(byChild.get('TodayPanel')).toContain('md:col-span-3')
    expect(byChild.get('ScoringLegend')).toContain('md:col-span-3')
  })

  test('the scores-table fallback is told which month it is sizing for', () => {
    // Without `month` it cannot know the column count and the table jumps
    // sideways as it resolves — the exact failure v1's hardcoded 30 columns
    // has, reintroduced through the prop instead of through the markup.
    const byChild = new Map(boundaries().map((boundary) => [boundary.child, boundary.fallback]))

    expect(byChild.get('ScoresTable')).toContain('month={monthParam}')
  })

  test('the route declares a pendingComponent for the navigation INTO /app', () => {
    // A different moment from the boundaries above, and both are needed: the
    // loader prefetches getMyTeams, amIPro and getMyPlayerId, none of which
    // depend on team or month, so it does NOT re-run on a switch. It DOES run
    // on arrival, and before this there was nothing to show while it did —
    // router.tsx sets no defaultPendingComponent either.
    expect(source).toContain('pendingComponent: DashboardSkeleton')
  })
})
