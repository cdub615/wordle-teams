// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file RENDERS the component; `.hook.test.ts` rather than `.test.tsx` matches
// every precedent in src/ and keeps vitest.config.ts's `src/**/*.test.ts` glob,
// so the elements below go through `createElement` by hand.
//
// TWO KINDS OF ASSERTION HERE, AND THE SPLIT IS DELIBERATE. The header slot's
// "one control, never two" invariant is a fact about the DOM, so it is rendered
// and counted below — as are the link's destination, its params and the funnel
// event its click emits. What is left to the source-text suite is only what a
// render cannot see: the shape of the expression that produces the slot, and
// two guards on words the component must NOT contain. Nothing is asserted in
// both places.
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, type MouseEvent, type ReactNode } from 'react'
import { getFunctionName, type FunctionReference } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { codeOf } from '#/test-support/source-ast.ts'
import { TodayPanelSkeleton } from './dashboard-skeletons.tsx'
import { TodayPanel } from './today-panel.tsx'
import type { Id } from '../../convex/_generated/dataModel'

/** Every funnel event the render emitted, in order. */
const sent: Array<string> = []

/** `to` plus its search params, the way a real Link resolves an href. */
function searchParamsHref(to: string, search?: Record<string, string>) {
  const query = new URLSearchParams(Object.entries(search ?? {})).toString()
  return query ? `${to}?${query}` : to
}

vi.mock('#/lib/funnel.ts', () => ({
  trackFunnel: (event: { name: string }) => {
    sent.push(event.name)
  },
}))

/** Set per test, read by the mocked `useSuspenseQuery`. */
let teamMonth: {
  players: Array<{
    id: string
    firstName: string
    lastName: string
    scores: Array<{ puzzleDay: string }>
  }>
}

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (ref: FunctionReference<'query'>) => ({ queryKey: [getFunctionName(ref)] }),
}))

// ONE QUERY, AND THE THROW IS THE ASSERTION OF THAT. The panel's whole design
// note is "NO NEW QUERY" — it joins the `getTeamMonth` subscription the
// dashboard already holds. A second query added here would land in this branch
// rather than quietly receiving the month payload.
vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: ({ queryKey }: { queryKey: Array<string> }) => {
    if (queryKey[0] !== getFunctionName(api.scores.getTeamMonth)) {
      throw new Error(`TodayPanel asked for an unexpected query: ${queryKey[0]}`)
    }
    return { data: teamMonth }
  },
}))

// A plain anchor. The real Link needs a RouterProvider, and the route tree is
// not what this file is about — routes.test.ts owns that, and
// e2e/board-entry.spec.ts drives this very link through the real router.
//
// `...rest` IS NOT OPTIONAL, for the reason no-team-card.hook.test.ts and
// next-step-card.hook.test.ts both spell out: the control is
// `<Button asChild><Link/></Button>`, and asChild means Radix's Slot renders no
// element of its own — it MERGES the button's props onto this child. A mock
// that destructured only `to` and `children` would drop the merged className
// the `bg-secondary` assertion below reads, and the click test would go green
// against a link that reported nothing.
//
// `search` IS BUILT INTO THE href RATHER THAN SPREAD ONTO THE ANCHOR, which is
// what a real Link does with it — and spreading the object would render
// `search="[object Object]"` and trip React's unknown-attribute warning. It is
// also what makes the link's params a rendered fact the test below can read off
// the DOM instead of a regex over the source.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    onClick,
    ...rest
  }: {
    to: string
    search?: Record<string, string>
    children?: ReactNode
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  }) =>
    createElement(
      'a',
      {
        href: searchParamsHref(to, search),
        ...rest,
        // Pulled out and re-attached so this mock can do the one thing a real
        // Link does that matters to a click test: preventDefault. jsdom
        // implements no navigation, so a bare anchor click prints "Not
        // implemented: navigation to another Document" on every run. The
        // handler itself is passed through untouched, so a Slot merge that
        // stopped delivering it still fails.
        onClick: (event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault()
          onClick?.(event)
        },
      },
      children,
    ),
}))

// The board-entry form is mocked to a probe, the same way
// board-entry/button.hook.test.ts does it: it runs Convex useSuspenseQuery
// calls of its own, and the mock above answers getTeamMonth and throws on
// anything else. INSURANCE RATHER THAN LOAD-BEARING — the closed Dialog never
// mounts the form, so nothing here is downstream of it today.
vi.mock('#/components/board-entry/form.tsx', () => ({
  BoardEntryForm: () => createElement('div', { 'data-testid': 'board-entry-form' }),
}))

const TEAM_ID = 'team_1' as Id<'teams'>
const MONTH = '2026-08'
/** Thursday 20 August 2026, mid-morning local — a weekday inside MONTH. */
const NOW = new Date(2026, 7, 20, 10, 0, 0)
const TODAY = '2026-08-20'

const panel = (myPlayerId: string) =>
  createElement(TodayPanel, {
    teamId: TEAM_ID,
    month: MONTH,
    myPlayerId: myPlayerId as Id<'players'>,
  })

/**
 * The header row, reached through the heading it holds rather than by child
 * index, so a wrapper added around the row does not silently turn the count
 * below into a count of nothing.
 */
function headerRow() {
  const row = screen.getByRole('heading', { level: 2 }).parentElement
  if (!row) throw new Error("the panel's heading has no parent row")
  return row
}

/** Every control in that row — anchors and buttons alike. */
const headerControls = () => Array.from(headerRow().querySelectorAll('a, button'))

beforeEach(() => {
  sent.length = 0
  // Only Date is faked; faking timers wholesale takes the message channel
  // React's scheduler needs to flush anything (team-boards.hook.test.ts).
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  teamMonth = {
    players: [
      { id: 'p1', firstName: 'Ada', lastName: 'Lovelace', scores: [{ puzzleDay: TODAY }] },
      { id: 'p2', firstName: 'Alan', lastName: 'Turing', scores: [] },
    ],
  }
  // jsdom implements neither matchMedia nor visualViewport. BoardEntryButton's
  // useMediaQuery calls the first on mount; useVisualViewport falls back to
  // window.innerHeight when the second is absent. Desktop, so the board-entry
  // trigger carries its name as visible text — both breakpoints answer to the
  // same accessible name, which is what `label` is for.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 768px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// A cwd-relative path, NOT `new URL(..., import.meta.url)` — see
// dashboard-skeletons.hook.test.ts's comment on the same line for why: this
// file is also jsdom, and jsdom breaks that resolution the same way there.
const source = readFileSync('src/components/today-panel.tsx', 'utf8')
// BOTH, AND NOT ONE: the copy guards forbid words the component's own note on
// the label spells out as REJECTED options, so they have to read `codeOf`'s
// comment-free text. The hydration assertions are about imports and control
// flow, and read the raw source.
const code = codeOf(source)

describe('TodayPanel guards the hydration hazard', () => {
  // THE TRAP THIS COMPONENT IS BUILT AROUND. "Today" is a client-only fact.
  // Guessing it during SSR is a hydration mismatch, which surfaces in
  // production as a minified React #418 — the same failure src/server.ts
  // records the maintenance-mode rewrite being rejected for. This component is
  // ENTIRELY about today, so it must render the skeleton until hydrated rather
  // than render a guessed value.
  test('it reads useHydrated and returns the skeleton before hydration', () => {
    expect(source).toContain("from '#/lib/use-hydrated.ts'")
    expect(source).toContain('useHydrated()')
    expect(source).toMatch(/if \(!hydrated\) return/)
  })

  test('it renders nothing at all when the month does not contain today', () => {
    // Absent, not empty: a "Today" panel is meaningless while browsing March.
    expect(source).toContain('monthContainsToday')
    expect(source).toMatch(/return null/)
  })

  test('the waiting list is capped through waitingOnSummary, not sliced inline', () => {
    expect(source).toContain("from '#/lib/waiting-on.ts'")
    expect(source).toContain('waitingOnSummary(')
  })

  test('names come from the shared collision rule, not from bare first names', () => {
    // Two Adas must not both read as "Ada" here while the table below
    // disambiguates them.
    expect(source).toContain("from '#/lib/display-names.ts'")
  })
})

describe("the header slot's one control, rendered", () => {
  // THE INVARIANT, EXECUTABLY. Every assertion in this block is a fact about
  // the DOM, which is what the design actually rests on: one control in that
  // slot, never two. The source-text block below keeps only what a render
  // cannot see.
  //
  // MUTATION-TESTED, four ways, each applied to today-panel.tsx and run
  // against this file alone:
  //   • the ternary split into `{iPlayed && …}` beside a SECOND, independently
  //     derived predicate — `{summary.playedCount < summary.total && …}`, which
  //     is true at the same time on this fixture. That is the drift the one
  //     expression exists to make impossible, and it is invisible to a ban on
  //     the literal `{iPlayed &&`. 'holds exactly ONE control' failed with 2.
  //   • `asChild` dropped from the Button. Slot stops replacing the button, so
  //     the anchor renders inside it: the count failed with 2 AND the click
  //     test failed with [] — the wrapper button carries no handler.
  //   • `onClick` dropped from the Link: the click test failed with [].
  //   • `month` added to `search`: the href assertion failed with
  //     '/insights?team=team_1&month=2026-08'.
  test('a player who has played today is offered the comparison, not board entry', () => {
    render(panel('p1'))
    // ROLE AND ACCESSIBLE NAME, NOT A TESTID, and that is a decision rather
    // than a default. The accessible name IS behaviour here: app.tsx's toolbar
    // renders its own board-entry button on this same page, so the two
    // controls must not share a name (board-entry/button.tsx's `label`,
    // wordle-teams-vgat) — a testid would go green while a screen reader heard
    // "Board Entry" twice. The cost is that this test and its inverse below
    // are coupled to the copy. The count and click tests are not: they reach
    // the control structurally, so a rewording touches the two tests whose
    // subject is the name and nothing else.
    const link = screen.getByRole('link', { name: 'How do you compare?' })
    // EXACT, WHICH IS WHERE THE `search` PARAMS ARE PINNED. The team travels
    // with the link, and `month` deliberately does NOT: the panel has already
    // returned null unless monthContainsToday(month), so this month is the one
    // resolveInsightsSearch (lib/insights-search.ts) falls back to anyway, and
    // a param that can never differ from the default is noise. An exact match
    // fails on a month appearing, on the team leaving, and on any third param
    // arriving — none of which a regex over the source can be trusted to see.
    expect(link.getAttribute('href')).toBe(`/insights?team=${TEAM_ID}`)
    expect(screen.queryByRole('button', { name: "Enter Today's Board" })).toBeNull()
  })

  test('and that slot holds exactly ONE control', () => {
    render(panel('p1'))
    expect(headerControls()).toHaveLength(1)
  })

  test('the click actually emits dashboard_insights_click, and nothing else', () => {
    // THE HANDLER SURVIVING THE SLOT MERGE IS THE POINT. `<Button asChild>`
    // makes Radix's Slot clone this anchor and merge the button's props onto
    // it; reading `onClick={() => trackFunnel(…)}` out of the source proves
    // the prop was written, not that anything delivers it. This clicks the
    // rendered element and reads the channel.
    render(panel('p1'))
    fireEvent.click(headerControls()[0])
    expect(sent).toEqual(['dashboard_insights_click'])
  })

  test('a player who has NOT played today gets board entry, and no comparison link', () => {
    render(panel('p2'))
    expect(screen.getByRole('button', { name: "Enter Today's Board" })).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(headerControls()).toHaveLength(1)
  })

  test('whichever control holds the slot carries the same secondary treatment', () => {
    // board-entry/button.tsx's trigger is `variant="secondary"` in both of its
    // branches, so matching it keeps the slot's colour and border across the
    // swap (not its width — see the component's note on md). `bg-secondary` is
    // that variant's own class in ui/button.tsx.
    //
    // ON THE LINK THIS IS ALSO THE OTHER HALF OF THE SLOT MERGE: the anchor has
    // no className of its own, so the class can only have arrived by Slot
    // merging the Button's onto it.
    render(panel('p1'))
    expect(headerControls()[0].className).toContain('bg-secondary')
    cleanup()

    render(panel('p2'))
    expect(headerControls()[0].className).toContain('bg-secondary')
  })
})

describe("the header slot's source, for what a render cannot see", () => {
  test('the slot is one ternary, not two independent predicates', () => {
    // WHY THIS SURVIVES the rendered count above: the count proves one control
    // is on screen for the two states it renders, and this proves the slot is
    // produced by ONE expression whose branches are exclusive by construction
    // rather than by two conditions somebody has to keep in step.
    //
    // THIS IS A WEAK GUARD AND IS MEANT TO BE THE SECOND ONE. It is a regex
    // over formatting: `{iPlayed  && …}` with two spaces, a line-wrapped `&&`,
    // or `{played.has(myPlayerId) && …}` all satisfy a ban on `{iPlayed &&`,
    // and there is no prettier in the gates to rule the whitespace variants
    // out. So the ban is gone and only the positive shape is asserted. This
    // one breaks in the safer direction — a reformatted ternary fails it
    // rather than slipping past it — and the rendered count is what actually
    // holds the line.
    expect(code).toMatch(
      /\{iPlayed \? \([\s\S]*?to="\/insights"[\s\S]*?\) : \([\s\S]*?<BoardEntryButton/,
    )
  })

  test('it reports through the funnel event dashboard_insights_click owns', () => {
    // The emission itself is rendered and clicked above. What is left here is
    // the NAME: its sibling onboarding_insights_click is latched to the
    // graduation card's arming, and sharing a name would conflate the two
    // (lib/funnel.ts). A render cannot see an event the component never emits.
    expect(code).not.toContain('onboarding_insights_click')
  })

  // A GUARD ON FUTURE COPY, not a fact about this change — the old file made
  // none of these claims either. Why these words and not others is the
  // component's own note on the label. Read off the source rather than the
  // rendered text because it covers BOTH branches of the slot in one pass.
  test('it promises nothing the free tier cannot show', () => {
    expect(code).not.toMatch(/difficult/i)
    expect(code).not.toMatch(/average|trend|streak/i)
  })
})

describe('TodayPanelSkeleton', () => {
  test('is hidden from the accessibility tree like every other skeleton here', () => {
    const { container } = render(createElement(TodayPanelSkeleton, {}))
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })

  test('pulses, which is what loading looks like in this app', () => {
    render(createElement(TodayPanelSkeleton, {}))
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})
