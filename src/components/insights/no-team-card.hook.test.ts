// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime (vitest.config.ts),
// because this file renders the real component. `.hook.test.ts` with
// createElement by hand, matching every other component test in this
// directory — vitest.config.ts's glob is `src/**/*.test.ts`, so a .tsx file
// would simply not run.
//
// WHY THIS FILE EXISTS: no-team-card.tsx had no test file at all before this,
// and routes/-insights.hook.test.ts renders it on every single test it runs
// (its global useQuery mock always reports `data: undefined`, so `teamId` is
// always undefined there — see that file's own comment) without a single
// assertion on what it renders. This file is the missing direct coverage of
// the card itself; the guard split that CHOOSES to render it is pinned
// separately, in routes/-insights.hook.test.ts, alongside the comment that
// explains why every render there hits this branch.
//
// A PLAIN ANCHOR, NOT A REAL ROUTER. The real Link needs a RouterProvider, and
// nothing here is about routing — routes.test.ts and e2e/routes.spec.ts own
// the destination. `...rest` IS LOAD-BEARING, the same lesson app-menu's own
// comment on this identical mock records: NoTeamCard's Link sits inside
// `<Button asChild>`, and asChild means Radix's Slot does not render an
// element of its own — it CLONES its child and merges the button's own props
// onto it. A mock that destructures only `to` and `children` would silently
// drop everything Slot merges in (the button's className, type, and so on),
// which would make this test pass against a link that no longer looks or
// behaves like the button it is supposed to be.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
    createElement('a', { href: to, ...rest }, children),
}))

const { NoTeamCard } = await import('./no-team-card.tsx')

afterEach(cleanup)

describe('NoTeamCard', () => {
  test('carries the testid TeamSection is keyed on', () => {
    render(createElement(NoTeamCard, {}))
    expect(screen.getByTestId('insights-no-team')).not.toBeNull()
  })

  test('states plainly that the player is on no team', () => {
    render(createElement(NoTeamCard, {}))
    expect(screen.getByTestId('insights-no-team').textContent).toContain(
      'You are not on a team yet',
    )
  })

  // NAMED CONCRETELY, not as a label — see the component's own comment on why
  // "team insights" alone is not an invitation to cross the floor. All three
  // things TeamPanel actually renders (head-to-head, averages, best/worst
  // days) must be named, individually, so a future edit that drops one of
  // them from the sentence fails here rather than only reading vaguer.
  test('names what a team gives, concretely: head-to-head, averages, best and worst days', () => {
    render(createElement(NoTeamCard, {}))
    const text = screen.getByTestId('insights-no-team').textContent ?? ''
    expect(text).toContain('head-to-head')
    expect(text.toLowerCase()).toContain('averages')
    expect(text).toContain('best and worst days')
  })

  test('offers a link to /app, the one action that gets a player onto a team', () => {
    render(createElement(NoTeamCard, {}))
    const link = screen.getByTestId('insights-no-team').querySelector('a[href="/app"]')
    expect(link).not.toBeNull()
    expect(link?.textContent).toBe('Find or create a team')
  })
})
