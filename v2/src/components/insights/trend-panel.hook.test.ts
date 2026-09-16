// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { TREND_MONTHS, type PersonalBoard } from '#/lib/insights-personal.ts'
import { TrendPanel } from './trend-panel.tsx'

afterEach(cleanup)

/** A solved board on `day` (YYYY-MM-DD), taking `n` guesses (n <= 6). */
const board = (day: string, n: number): PersonalBoard => ({
  puzzleDay: day,
  answer: 'SPEED',
  guesses: [...Array.from({ length: Math.max(n - 1, 0) }, () => 'MOIST'), 'SPEED'].slice(0, n),
})

/** `count` boards spread one per day, starting at the 1st of `month` ('YYYY-MM'), all taking `n` guesses. */
function monthBoards(month: string, count: number, n: number): PersonalBoard[] {
  return Array.from({ length: count }, (_, i) => board(`${month}-${String(i + 1).padStart(2, '0')}`, n))
}

/** The i-th month after 2025-01, as 'YYYY-MM' — walks past a year boundary so a 24-month fixture is real. */
const monthAt = (i: number): string => {
  const date = new Date(Date.UTC(2025, i, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const render_ = (boards: PersonalBoard[]) => render(createElement(TrendPanel, { boards }))

test('renders nothing when there are no months', () => {
  render_([])
  expect(screen.queryByTestId('insights-trend')).toBeNull()
})

test('never renders more than TREND_MONTHS bars, even for a two-year history', () => {
  // 24 distinct months, one board each — a player with two years behind them.
  const boards = Array.from({ length: 24 }, (_, i) => monthAt(i)).flatMap((month) => monthBoards(month, 1, 3))
  const { container } = render_(boards)
  const bars = container.querySelectorAll('[data-testid="insights-trend-bar"]')
  expect(bars).toHaveLength(TREND_MONTHS)
})

test('states the direction outright, so a shorter bar is not ambiguous', () => {
  render_(monthBoards('2026-08', 5, 4))
  expect(screen.getByTestId('insights-trend').textContent).toContain('avg guesses · lower is better')
})

test('insights-months resolves to exactly one element, holding the bars', () => {
  render_(monthBoards('2026-08', 5, 4))
  const months = screen.getByTestId('insights-months')
  expect(months).not.toBeNull()
  expect(months.querySelectorAll('[data-testid="insights-trend-bar"]')).toHaveLength(1)
})

test('each bar carries an sr-only sentence with its month, board count and mean', () => {
  render_(monthBoards('2026-08', 5, 4))
  const months = screen.getByTestId('insights-months')
  const sentence = months.querySelector('.sr-only')
  expect(sentence).not.toBeNull()
  expect(sentence!.textContent).toContain('Aug 2026')
  expect(sentence!.textContent).toContain('5 boards')
  expect(sentence!.textContent).toContain('4')
})

test('the mean is printed as VISIBLE text next to the bar, not only inside the sr-only sentence', () => {
  // One board at 4 guesses and one at 5 gives a mean of exactly 4.5 — a
  // number that appears nowhere else in this render (not the board count,
  // not the month), so finding "4.5" among the visible text proves this
  // label specifically, rather than coincidentally matching something else.
  const boards = [board('2026-08-01', 4), board('2026-08-02', 5)]
  const { container } = render_(boards)
  const months = screen.getByTestId('insights-months')
  const bar = container.querySelector('[data-testid="insights-trend-bar"]')!
  // bar -> its aria-hidden wrapper -> the column div holding the wrapper,
  // the sr-only sentence and both month-name spans as siblings.
  const column = bar.parentElement!.parentElement!
  const visibleText = [...column.children]
    .filter((el) => !el.classList.contains('sr-only'))
    .map((el) => el.textContent)
    .join(' ')
  expect(visibleText).toContain('4.5')
  // The sr-only sentence still carries it too, in prose — this assertion is
  // about the VISIBLE label existing in addition, not replacing it.
  expect(months.querySelector('.sr-only')!.textContent).toContain('4.5')
})

describe('the bars scale from zero against the worst mean, not from the minimum', () => {
  test('a month at half the worst mean renders at half height, not zero', () => {
    // July: mean 2 (the best). August: mean 4 (the worst, and the window's
    // ceiling). Scaling from zero puts July at 50% — scaling from the minimum
    // (the bug this guards against) would put it at 0%, since July IS the min.
    const boards = [...monthBoards('2026-07', 3, 2), ...monthBoards('2026-08', 3, 4)]
    const { container } = render_(boards)
    const bars = [...container.querySelectorAll('[data-testid="insights-trend-bar"]')]
    expect((bars[0] as HTMLElement).style.height).toBe('50%')
    expect((bars[1] as HTMLElement).style.height).toBe('100%')
  })
})

describe('the latest bar is accented only when it is also the best month', () => {
  test('a latest month that is the best gets bg-accent-solid', () => {
    // July mean 4 (worse), August (latest) mean 2 (better) — August is both
    // latest and best.
    const boards = [...monthBoards('2026-07', 3, 4), ...monthBoards('2026-08', 3, 2)]
    const { container } = render_(boards)
    const bars = [...container.querySelectorAll('[data-testid="insights-trend-bar"]')]
    // In full: `toContain('bg-muted')` also matches `bg-muted-foreground`, so
    // the looser form cannot tell the visible fill from the invisible track.
    expect(bars[0]!.className).toContain('bg-muted-foreground')
    expect(bars[0]!.className).not.toContain('bg-accent-solid')
    expect(bars[1]!.className).toContain('bg-accent-solid')
  })

  test('a latest month that is worse than an earlier month stays unaccented, not accented for being newest', () => {
    // July mean 2 (the best). August (latest) mean 4 — worse than July, so
    // August must NOT get the accent just because it is the most recent bar.
    const boards = [...monthBoards('2026-07', 3, 2), ...monthBoards('2026-08', 3, 4)]
    const { container } = render_(boards)
    const bars = [...container.querySelectorAll('[data-testid="insights-trend-bar"]')]
    expect(bars[1]!.className).toContain('bg-muted-foreground')
    expect(bars[1]!.className).not.toContain('bg-accent-solid')
  })
})

describe('the caption', () => {
  test('reads "your best month yet" when the latest month is the best', () => {
    const boards = [...monthBoards('2026-07', 3, 4), ...monthBoards('2026-08', 5, 2)]
    render_(boards)
    const text = screen.getByTestId('insights-trend').textContent ?? ''
    expect(text).toContain('Your best month yet')
    expect(text).toContain('Aug 2026')
    expect(text).toContain('5 boards')
    expect(text).toContain('avg 2')
  })

  test('reads "your best month" (no "yet") and names the earlier month when the latest is not best', () => {
    const boards = [...monthBoards('2026-07', 4, 2), ...monthBoards('2026-08', 3, 4)]
    render_(boards)
    const text = screen.getByTestId('insights-trend').textContent ?? ''
    expect(text).toContain('Your best month')
    expect(text).not.toContain('Your best month yet')
    expect(text).toContain('Jul 2026')
    expect(text).toContain('4 boards')
    expect(text).toContain('avg 2')
  })
})
