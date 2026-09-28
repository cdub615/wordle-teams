// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real components; `.hook.test.ts` rather than `.test.tsx`
// matches every precedent in src/ and keeps vitest.config.ts's `src/**/*.test.ts`
// glob, so the elements below go through `createElement` by hand.
//
// WHY THIS FILE EXISTS: `trigger: (isDesktop: boolean) => ReactNode` IS THE ONE
// GENUINELY NEW CONTRACT IN BoardEntrySurface, AND THE E2E SUITE IS BLIND TO IT.
//
// The surface was split out of BoardEntryButton so the onboarding card can open
// board entry from its own control (wordle-teams-456). That split turned the
// trigger into a callback, and the callback takes `isDesktop` because the two
// breakpoints need genuinely different markup: the desktop trigger carries its
// accessible name as VISIBLE TEXT, the mobile one is icon-only and carries it
// as an ARIA-LABEL.
//
// Invert that callback — render each breakpoint's trigger under the other
// condition — and tsc, eslint, the unit suite and the e2e suite ALL stay green.
// e2e cannot see it because every spec that opens board entry
// (e2e/board-entry.spec.ts:36/79/144, e2e/teams.spec.ts:173,
// e2e/team-boards.spec.ts:66) locates the control by
// `getByRole('button', { name: 'Board Entry' })`, and BOTH triggers answer to
// that name — that is the whole point of the `label` prop. The only visible
// symptom is a 12px label rendering at 14px on a phone.
//
// So the assertions below are deliberately about what the accessible name
// COLLAPSES: which mechanism supplies the name, and the icon-only button's own
// `text-xs`. Asserting "a button named Board Entry exists" would be satisfied by
// the mutant, which is exactly the failure mode this file exists to refuse.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BoardEntryButton, BoardEntrySurface } from './button.tsx'
import type { Id } from '../../../convex/_generated/dataModel'

const DESKTOP_QUERY = '(min-width: 768px)'

const TEAM_ID = 'team-1' as Id<'teams'>

/**
 * The form is mocked to a probe. It opens with two useSuspenseQuery calls
 * against Convex, and none of what this file asserts is downstream of them —
 * form.hook.test.ts owns the form's own behaviour.
 */
vi.mock('./form.tsx', () => ({
  BoardEntryForm: ({ teamId, month }: { teamId?: string; month: string }) =>
    createElement('div', {
      'data-testid': 'board-entry-form',
      'data-team-id': teamId ?? 'none',
      'data-month': month,
    }),
}))

let isDesktop: boolean

beforeEach(() => {
  isDesktop = true
  // jsdom implements neither matchMedia nor visualViewport. useMediaQuery calls
  // the first on mount; useVisualViewport falls back to window.innerHeight when
  // the second is absent, which needs no stub. Same shape as
  // app-menu.hook.test.ts:207.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === DESKTOP_QUERY ? isDesktop : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const renderButton = (label?: string) =>
  render(
    createElement(BoardEntryButton, { teamId: TEAM_ID, month: '2026-09', ...(label ? { label } : {}) }),
  )

describe('BoardEntryButton renders the right trigger for the breakpoint', () => {
  test('desktop: the name is VISIBLE TEXT, and there is no aria-label at all', () => {
    isDesktop = true
    renderButton()

    const trigger = screen.getByRole('button', { name: 'Board Entry' })
    // Both halves are load-bearing. The name alone is identical across the two
    // triggers; what differs is that this one has no aria-label to supply it.
    expect(trigger.textContent?.trim()).toBe('Board Entry')
    expect(trigger.getAttribute('aria-label')).toBeNull()
  })

  test('mobile: the name is an ARIA-LABEL on an icon-only, text-xs button', () => {
    isDesktop = false
    renderButton()

    const trigger = screen.getByRole('button', { name: 'Board Entry' })
    expect(trigger.getAttribute('aria-label')).toBe('Board Entry')
    // Icon-only: the Plus svg contributes no text. If this trigger ever grows
    // visible text it would read out twice, once as label and once as content.
    expect(trigger.textContent?.trim()).toBe('')
    // `text-xs` is the phone-sized variant. The desktop trigger does not carry
    // it, so this is the one class that tells the two apart in the DOM.
    expect(trigger.className).toContain('text-xs')
  })

  test('`label` drives whichever mechanism the breakpoint uses', () => {
    // today-panel.tsx passes "Enter Today's Board" so its button does not
    // collide with app.tsx's toolbar one (wordle-teams-vgat). The prop has to
    // reach the visible text on desktop and the aria-label on mobile, because
    // the desktop branch has no separate aria-label to override.
    isDesktop = true
    renderButton("Enter Today's Board")
    expect(
      screen.getByRole('button', { name: "Enter Today's Board" }).textContent?.trim(),
    ).toBe("Enter Today's Board")

    cleanup()

    isDesktop = false
    renderButton("Enter Today's Board")
    expect(
      screen.getByRole('button', { name: "Enter Today's Board" }).getAttribute('aria-label'),
    ).toBe("Enter Today's Board")
  })
})

describe('BoardEntrySurface opens without a trigger of its own', () => {
  // WHAT THE ONBOARDING CARD DEPENDS ON. next-step-card.tsx renders its own
  // task button and calls back; if the surface rendered a trigger regardless,
  // /app would show a second board-entry control beside the card's one. The
  // `trigger &&` guard is what prevents that, and nothing else asserts it.
  test('no trigger prop means no button', () => {
    render(
      createElement(BoardEntrySurface, {
        open: false,
        onOpenChange: () => {},
        month: '2026-09',
      }),
    )
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  test('a controlled `open` shows the form with no team id, for a team-less player', () => {
    render(
      createElement(BoardEntrySurface, {
        open: true,
        onOpenChange: () => {},
        month: '2026-09',
      }),
    )
    const form = screen.getByTestId('board-entry-form')
    expect(form.getAttribute('data-team-id')).toBe('none')
    expect(form.getAttribute('data-month')).toBe('2026-09')
  })

  test('a team id reaches the form when there is one', () => {
    render(
      createElement(BoardEntrySurface, {
        open: true,
        onOpenChange: () => {},
        teamId: TEAM_ID,
        month: '2026-09',
      }),
    )
    expect(screen.getByTestId('board-entry-form').getAttribute('data-team-id')).toBe(TEAM_ID)
  })
})
