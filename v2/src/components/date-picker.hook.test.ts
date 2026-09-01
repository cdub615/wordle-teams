// @vitest-environment jsdom
//
// jsdom, not the suite's default edge-runtime (vitest.config.ts), because this
// file renders the real component and opens its popover. Named `.hook.test.ts`
// to match the existing precedents — src/components/settings/notifications-tab.
// hook.test.ts, src/lib/use-local-capture.hook.test.ts and the sibling
// src/components/teams/team-boards.hook.test.ts — and `.test.ts` rather than
// `.test.tsx` because vitest.config.ts's glob is `src/**/*.test.ts`, so the
// elements below go through `createElement` by hand.
//
// THIS FILE EXISTS BECAUSE `minDay`/`maxDay` HAD NO COVERAGE AT ANY LEVEL.
// V2-ADDENDUM §7a row 32 states as documented parity behaviour that the Team
// Boards date picker is bounded to the viewed month "through new optional
// minDay/maxDay props on v2/src/components/date-picker.tsx". Measured during
// the Task 10 review: making the component ignore `maxDay` entirely, and
// separately dropping the `minDay` matcher, each left the whole suite green —
// so no gate could tell whether that sentence was true.
//
// WHAT IS ASSERTED IS THE ENABLED SET, EXHAUSTIVELY. `enabledDays()` below
// reads every `[data-day]` cell the calendar rendered, so a bound that shifts
// by one day, or opens up a day in the middle of the range, is a change to the
// array rather than something a spot check might step over.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import DatePicker from './date-picker.tsx'
import { isWeekendDay, type PuzzleDay } from '../../convex/lib/puzzleDay.ts'

// Thursday 20 August 2026, mid-morning local — the same instant the Team Boards
// suite uses, chosen so "today" is a weekday and there are days either side of
// it inside the month.
const NOW = new Date(2026, 7, 20, 10, 0, 0)

const onSelect = vi.fn()

beforeEach(() => {
  // Only Date is faked; faking timers wholesale takes the message channel React's
  // scheduler needs to flush anything.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  onSelect.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function open(props: Partial<Parameters<typeof DatePicker>[0]> = {}) {
  render(
    createElement(DatePicker, {
      day: '2026-08-20',
      onSelect,
      playWeekends: true,
      ...props,
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'August 20, 2026' }))
}

/**
 * Every day the open calendar offers, in grid order.
 *
 * react-day-picker stamps each cell with `data-day="YYYY-MM-DD"` — the same
 * shape as a PuzzleDay — and disables the button inside it, so this is the
 * complete rendered set rather than a sample of it. `showOutsideDays` and
 * `fixedWeeks` mean the grid always spans six weeks, which is what makes the
 * out-of-month bounds below observable at all.
 */
function enabledDays(): Array<PuzzleDay> {
  const cells = screen.getByRole('grid').querySelectorAll<HTMLElement>('td[data-day]')
  return Array.from(cells)
    .filter((cell) => cell.querySelector('button')?.hasAttribute('disabled') === false)
    .map((cell) => cell.dataset.day ?? '')
}

/** Every ISO day from `from` to `to` inclusive, `keep` deciding what survives. */
function range(from: PuzzleDay, to: PuzzleDay, keep: (day: PuzzleDay) => boolean = () => true) {
  const days: Array<PuzzleDay> = []
  const cursor = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (cursor <= end) {
    const day = cursor.toISOString().slice(0, 10)
    if (keep(day)) days.push(day)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

// The August 2026 grid: six fixed weeks from Sunday 26 July to Saturday 5
// September, with today the 20th sitting inside it.
const GRID_START = '2026-07-26'
const TODAY = '2026-08-20'

describe('v1 behaviour, which is what both bounds default to', () => {
  test('every day up to and including today is offered, and nothing after it', () => {
    open()
    expect(enabledDays()).toEqual(range(GRID_START, TODAY))
  })

  test('weekends are withheld from a team that does not play them', () => {
    open({ playWeekends: false })
    expect(enabledDays()).toEqual(range(GRID_START, TODAY, (day) => !isWeekendDay(day)))
  })
})

describe('the optional bounds — V2-ADDENDUM §7a row 32', () => {
  test('maxDay pulls the upper end in, inclusively', () => {
    open({ maxDay: '2026-08-14' })
    expect(enabledDays()).toEqual(range(GRID_START, '2026-08-14'))
  })

  test('minDay pushes the lower end up, inclusively — the previous month goes', () => {
    open({ minDay: '2026-08-01' })
    expect(enabledDays()).toEqual(range('2026-08-01', TODAY))
  })

  test('the two together bound both ends', () => {
    open({ minDay: '2026-08-10', maxDay: '2026-08-14' })
    expect(enabledDays()).toEqual(range('2026-08-10', '2026-08-14'))
  })

  test('a maxDay in the future NARROWS ONLY — it can never open up days after today', () => {
    // The claim the component's own comment makes. A caller that passed the
    // last day of a month still in progress would otherwise hand out days the
    // app has no scores for at all.
    open({ maxDay: '2026-12-31' })
    expect(enabledDays()).toEqual(range(GRID_START, TODAY))
  })

  test('the bounds compose with the weekend rule rather than replacing it', () => {
    open({ playWeekends: false, minDay: '2026-08-01', maxDay: '2026-08-14' })
    expect(enabledDays()).toEqual(range('2026-08-01', '2026-08-14', (day) => !isWeekendDay(day)))
  })
})

describe('what a selection does', () => {
  test('picking a day reports it as a PuzzleDay and closes the calendar', () => {
    open()
    fireEvent.click(screen.getByRole('grid').querySelector('td[data-day="2026-08-18"] button')!)

    expect(onSelect.mock.calls).toEqual([['2026-08-18']])
    expect(screen.queryByRole('grid')).toBeNull()
  })

  test('a disabled day reports nothing', () => {
    open({ minDay: '2026-08-10' })
    fireEvent.click(screen.getByRole('grid').querySelector('td[data-day="2026-08-05"] button')!)

    expect(onSelect).not.toHaveBeenCalled()
  })
})
