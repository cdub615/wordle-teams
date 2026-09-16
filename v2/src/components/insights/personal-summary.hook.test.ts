// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import type { PersonalBoard } from '#/lib/insights-personal.ts'
import { PersonalSummary } from './personal-summary.tsx'

afterEach(cleanup)

// attemptsFor (convex/lib/board.ts) scores a board under six guesses by length
// alone — it never checks the last guess against the answer below six rows —
// so the filler words below stand in for guesses of any given count without
// having to solve anything. A six-guess board DOES need its last row to equal
// the answer, or attemptsFor scores it 7 (a failure), so `board` supplies that.
const FILLER = ['CRANE', 'MOIST', 'ADIEU', 'BLUNT', 'FORTH']

function board(day: number, guessCount: number, answer = 'SPEED'): PersonalBoard {
  const guesses = Array.from({ length: guessCount }, (_, i) =>
    guessCount === 6 && i === 5 ? answer : FILLER[i % FILLER.length],
  )
  return { puzzleDay: puzzleDayAt(day), guesses, answer }
}

// Real calendar dates, not a zero-padded month string, so a fixture past 28
// boards does not silently overflow into an invalid day-of-month.
function puzzleDayAt(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10)
}

// Ten two-guess boards: under TRAILING_FORM_MIN_BOARDS (40), so trailingForm
// returns null and the unlock prompt, not a trend, is what should render.
const belowFloor: PersonalBoard[] = Array.from({ length: 10 }, (_, i) => board(i, 2))

// Fifteen two-guess boards followed by thirty six-guess boards: 45 total,
// clears the floor, and the last 30 (TRAILING_FORM_WINDOW) are the WORSE
// stretch — the case most likely to tempt a destructive-red treatment, and
// exactly the one the spec forbids that treatment on.
const worseRecentStretch: PersonalBoard[] = [
  ...Array.from({ length: 15 }, (_, i) => board(i, 2)),
  ...Array.from({ length: 30 }, (_, i) => board(15 + i, 6)),
]

describe('PersonalSummary', () => {
  test('the lead figure is a real number, sized and styled as the hero', () => {
    render(createElement(PersonalSummary, { boards: belowFloor }))
    const figure = screen.getByTestId('insights-lead-figure')
    expect(figure.className).toContain('tabular-nums')
    // Ten boards of two guesses each: mean is exactly 2.
    expect(figure.textContent).toBe('2')
  })

  test('below the trailing-form floor, an unlock prompt appears and the trend does not', () => {
    render(createElement(PersonalSummary, { boards: belowFloor }))
    expect(screen.getByTestId('insights-unlock-form')).not.toBeNull()
    expect(screen.queryByTestId('insights-trailing-form')).toBeNull()
  })

  test('at or above the floor, the trend appears and the unlock prompt does not', () => {
    render(createElement(PersonalSummary, { boards: worseRecentStretch }))
    expect(screen.getByTestId('insights-trailing-form')).not.toBeNull()
    expect(screen.queryByTestId('insights-unlock-form')).toBeNull()
  })

  test('a worse recent stretch is stated in the down arrow, never in the destructive colour', () => {
    const { container } = render(createElement(PersonalSummary, { boards: worseRecentStretch }))
    const trend = screen.getByTestId('insights-trailing-form')
    expect(trend.textContent).toContain('▼')
    // The whole card, not just the trend node: a page someone pays for should
    // not scold them for a bad stretch anywhere on it.
    expect(container.innerHTML).not.toContain('text-destructive')
  })

  test('insights-consistency is still present, since an existing test depends on that id', () => {
    render(createElement(PersonalSummary, { boards: belowFloor }))
    expect(screen.getByTestId('insights-consistency')).not.toBeNull()
  })
})
