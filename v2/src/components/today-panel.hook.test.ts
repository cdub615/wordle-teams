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
