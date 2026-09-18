// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, and `.hook.test.ts` with
// createElement by hand, because vitest.config.ts's glob is `src/**/*.test.ts` —
// a .tsx file would simply not run. Same shape as every other component test here.
//
// WHY THIS FILE EXISTS: THE RULE IT GUARDS IS ABOUT SOMETHING BEING ABSENT. The
// Pro teaser row must not render when the team has no history behind the gate,
// and an absent row is the one defect a screenshot of a long-lived team never
// shows. Without this the row is deletable, and its condition wideable, with a
// green suite.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MonthPicker } from './month-picker.tsx'

afterEach(cleanup)

/**
 * Radix opens a DropdownMenu on POINTERDOWN, not on click — `fireEvent.click`
 * alone leaves the menu shut and every assertion about its contents trivially
 * passing against an empty list. Lifted from team-scope-controls.hook.test.ts,
 * which pays for the same lesson on the same primitive, including the two extra
 * event fields Radix's own handler reads.
 */
const open = () =>
  fireEvent.pointerDown(screen.getByRole('button', { name: /2026/ }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse',
  })

const props = {
  value: '2026-08',
  months: ['2026-08', '2026-07', '2026-06'],
  teaserLabel: null as string | null,
  onChange: () => {},
  onUpgrade: () => {},
}

describe('the month list', () => {
  test('renders every month it is given, and only those', () => {
    render(createElement(MonthPicker, { ...props, months: ['2026-08', '2026-07', '2026-06', '2026-05'] }))
    open()

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4)
  })

  test('labels months in the short form the app uses everywhere', () => {
    // 'Aug 2026', NOT 'August 2026'. formatMonthLabel is
    // Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })
    // (format-day.ts:13), and its own doc line says "'Aug 2026' — the month
    // picker's label". The first draft of this file asserted the long form in
    // three places and could never have passed.
    render(createElement(MonthPicker, props))
    open()

    expect(screen.getByRole('menuitemradio', { name: 'Aug 2026' })).toBeTruthy()
  })
})

describe('the pro teaser row', () => {
  test('names the month Pro reaches back to', () => {
    render(createElement(MonthPicker, { ...props, teaserLabel: 'Mar 2023' }))
    open()

    const row = screen.getByRole('menuitem', { name: /Back to/ })
    // THE MONTH IS PINNED SEPARATELY FROM THE PREFIX, deliberately. The row's
    // whole job is to name the actual reward rather than an abstraction, so a
    // future edit that keeps "Back to …" and loses the month must fail here.
    expect(row.textContent).toContain('Mar 2023')
  })

  test('does not render when there is nothing behind the gate', () => {
    // THE GUARD. A week-old team must not advertise history it does not have —
    // somebody would pay for it. `teaserLabel` is null for a pro viewer, for a
    // team with no boards, and for a team whose earliest board is already inside
    // the free window; proTeaserMonth decides which, and monthWindow.test.ts
    // covers that decision. This asserts the component honours it.
    render(createElement(MonthPicker, props))
    open()

    // A POSITIVE CONTROL FIRST. Without it, an `open()` that silently failed
    // would make the null assertion below pass vacuously — which is exactly the
    // failure mode team-scope-controls.hook.test.ts warns about in its own helper.
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    expect(screen.queryByRole('menuitem', { name: /Back to/ })).toBeNull()
  })

  test('calls onUpgrade rather than changing the month', () => {
    // IT IS AN UPGRADE AFFORDANCE, NOT A MONTH. Rendering it inside the radio
    // group would make it selectable as a value the window does not contain,
    // which the server would then refuse.
    const onUpgrade = vi.fn()
    const onChange = vi.fn()
    render(createElement(MonthPicker, { ...props, teaserLabel: 'Mar 2023', onUpgrade, onChange }))
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: /Back to/ }))

    expect(onUpgrade).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })
})
