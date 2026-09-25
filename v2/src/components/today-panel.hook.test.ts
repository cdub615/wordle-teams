// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { TodayPanelSkeleton } from './dashboard-skeletons.tsx'

afterEach(cleanup)

// A cwd-relative path, NOT `new URL(..., import.meta.url)` — see
// dashboard-skeletons.hook.test.ts's comment on the same line for why: this
// file is also jsdom, and jsdom breaks that resolution the same way there.
const source = readFileSync('src/components/today-panel.tsx', 'utf8')

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

// COMMENTS STRIPPED, because the component's own rationale block NAMES the
// claims that block rejects — "difficulty", "average", "trend" all appear there
// as reasons. Asserting on the raw source would then fail on the explanation
// rather than on anything the reader can see.
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe("the header slot's one control", () => {
  // WHAT THIS SUITE CANNOT DO, said plainly: reading the source cannot prove
  // that only one control is on screen. It can prove the source has no way to
  // express two — a single ternary rather than a pair of `iPlayed` predicates —
  // which is the property the design rests on. Proving the rendered result
  // needs a browser, and no e2e assertion covers it yet.
  test('the slot is one ternary, not two independent predicates', () => {
    expect(code).toMatch(
      /\{iPlayed \? \([\s\S]*?to="\/insights"[\s\S]*?\) : \([\s\S]*?<BoardEntryButton/,
    )
    // `{iPlayed && …}` or `{!iPlayed && …}` anywhere here means the slot is
    // back to two predicates whose exclusivity is a coincidence. The h2 above
    // uses a ternary too, so this pattern has nothing else to match.
    expect(code).not.toMatch(/\{!?iPlayed &&/)
    expect(code.match(/<BoardEntryButton/g)).toHaveLength(1)
    expect(code.match(/to="\/insights"/g)).toHaveLength(1)
  })

  test('it links /insights and carries the team the panel is showing', () => {
    expect(code).toContain("from '@tanstack/react-router'")
    expect(code).toContain('to="/insights"')
    expect(code).toContain('search={{ team: teamId }}')
    // NO `month`, deliberately: the component has already returned null unless
    // monthContainsToday(month), so this month is the one resolveInsightsSearch
    // defaults to anyway. A param that can never differ from the default is
    // noise, and this pins that decision rather than just the presence of one.
    expect(code).not.toMatch(/search=\{\{[^}]*month/)
  })

  test('the label is exactly the question, on the link itself', () => {
    expect(code).toMatch(/to="\/insights"[\s\S]*?How do you compare\?/)
  })

  test('it carries BoardEntryButton’s own variant, so the slot keeps its weight', () => {
    // board-entry/button.tsx's trigger is `variant="secondary"` in both
    // branches; matching it is why swapping the occupant does not change how
    // heavy the corner of the panel looks.
    expect(code).toMatch(/<Button variant="secondary" asChild>/)
  })

  test('the click emits dashboard_insights_click and nothing else', () => {
    expect(code).toContain("from '#/lib/funnel.ts'")
    expect(code).toContain("trackFunnel({ name: 'dashboard_insights_click' })")
    // Its sibling event is latched to the graduation card's arming; sharing a
    // name would conflate the two (see lib/funnel.ts).
    expect(code).not.toContain('onboarding_insights_click')
  })

  // A GUARD ON FUTURE COPY, NOT A FACT ABOUT THIS CHANGE — the old file made
  // none of these claims either. It is here because the label was chosen
  // against exactly this list: today never has a difficulty row (the corpus
  // publishes only globally completed days), and personal history is
  // `layer2: paid ? 'full' : 'none'`, so a free player cannot see an average or
  // a trend. Comparison is what free actually gets.
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
