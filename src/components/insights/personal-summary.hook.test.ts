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

// Fifteen six-guess boards followed by thirty two-guess boards: 45 total,
// clears the floor, and the last 30 (TRAILING_FORM_WINDOW) are the IMPROVING
// stretch — the branch the contrast bug (Finding 1) lived in and which had no
// fixture at all. Lifetime mean is (15*6 + 30*2) / 45 ≈ 3.3; the recent window
// is a flat 2; delta is lifetime - recent, which trailingForm's own comment
// says is POSITIVE when the player is improving (lower is better) — so this
// fixture is the mirror image of worseRecentStretch, not a copy of it.
const improvingRecentStretch: PersonalBoard[] = [
  ...Array.from({ length: 15 }, (_, i) => board(i, 6)),
  ...Array.from({ length: 30 }, (_, i) => board(15 + i, 2)),
]

// Forty-five boards of a uniform two guesses each, clearing the floor. Every
// window — recent or otherwise — has the same mean as the lifetime figure, so
// delta is exactly 0: the flat case, where there is nothing to colour and
// nothing to call an improvement or a decline.
const flatStretch: PersonalBoard[] = Array.from({ length: 45 }, (_, i) => board(i, 2))

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

  // Finding 2: the improving branch shipped with no fixture at all, which is
  // exactly the branch that carried the text-success contrast bug (Finding
  // 1) — a worse-stretch test alone could not have caught it, since that
  // branch never reaches the coloured span.
  test('an improving recent stretch is stated in the up arrow and text-accent-solid', () => {
    render(createElement(PersonalSummary, { boards: improvingRecentStretch }))
    const trend = screen.getByTestId('insights-trailing-form')
    expect(trend.textContent).toContain('▲')
    // The delta span is the first span in the node — see personal-summary.tsx.
    const deltaSpan = trend.querySelector('span')
    expect(deltaSpan?.className).toContain('text-accent-solid')
  })

  test('a flat recent stretch is stated in the em dash and carries no colour class', () => {
    render(createElement(PersonalSummary, { boards: flatStretch }))
    const trend = screen.getByTestId('insights-trailing-form')
    expect(trend.textContent).toContain('—')
    const deltaSpan = trend.querySelector('span')
    expect(deltaSpan?.className).not.toContain('text-accent-solid')
    expect(deltaSpan?.className).not.toContain('text-destructive')
  })

  // Finding 3: the arrow glyph is the only OTHER signal besides colour, which
  // is precisely the colour-only distinction AttemptDistribution's own
  // comment says this codebase avoids. The glyph must be hidden from a
  // screen reader (its Unicode name says nothing) and a real word must stand
  // in for it.
  test('the trend glyph is aria-hidden and carries a visually-hidden text alternative', () => {
    render(createElement(PersonalSummary, { boards: worseRecentStretch }))
    const trend = screen.getByTestId('insights-trailing-form')
    const glyph = trend.querySelector('[aria-hidden="true"]')
    expect(glyph?.textContent).toBe('▼')
    const alt = trend.querySelector('.sr-only')
    expect(alt?.textContent).toBe('Worsened')
  })
})
