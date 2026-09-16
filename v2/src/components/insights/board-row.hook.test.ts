// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import { BoardRow } from './board-row.tsx'

afterEach(cleanup)

const credit = {
  attribution: 'FiveLetterWords.io, research release v2026-09-01',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  citation: 'FiveLetterWords.io (2026-09-01). [Data set].',
}

// SLANT (1st), CRANE (2nd), ORATE (3rd) — the same corpus fixture
// -insights.hook.test.ts uses, so a rank sentence asserted here reads the
// same way it does on the full page. Difficulty covers 2026-09-01..03 only,
// so 2026-09-04 and later are deliberately outside the artifact's range.
const benchmark: InsightsBenchmark = {
  openers: { ...credit, release: 'v2026-09-01', count: 14855, words: 'slantcraneorate' },
  difficulty: {
    ...credit,
    release: 'current',
    snapshotId: 'current-2026-09-07-abc',
    firstDay: '2026-09-01',
    count: 3,
    percentiles: [10, 50, 95],
  },
}

const row = (board: { puzzleDay: string; guesses: string[]; answer?: string }) =>
  render(createElement(BoardRow, { benchmark, board }))

test('renders exactly one insights-board row', () => {
  row({ puzzleDay: '2026-09-03', guesses: ['CRANE', 'SPEED'], answer: 'SPEED' })
  expect(screen.getAllByTestId('insights-board')).toHaveLength(1)
})

/*
  THE FAULT THIS TEST GUARDS AGAINST: MiniBoard renders every tile as the
  neutral 'empty' fill (`.bg-wordle-tile-border`) when it gets no `answer`
  (see that component's own comment) — so if BoardRow ever stopped
  forwarding `board.answer`, the coloured classes below would vanish and
  every tile would carry that neutral class instead.
*/
test('renders the real board, coloured from the answer', () => {
  // CRANE against SPEED: C absent, R absent, A absent, N absent, E present.
  const { container } = row({ puzzleDay: '2026-09-03', guesses: ['CRANE'], answer: 'SPEED' })
  const tiles = container.querySelectorAll('.bg-wordle-absent, .bg-wordle-present, .bg-wordle-correct')
  expect(tiles).toHaveLength(5)
  expect(container.querySelectorAll('.bg-wordle-present')).toHaveLength(1)
  expect(container.querySelectorAll('.bg-wordle-absent')).toHaveLength(4)
  expect(container.querySelectorAll('.bg-wordle-tile-border')).toHaveLength(0)
})

describe('the score', () => {
  test('shows the guess count as N/6, right beside the day', () => {
    row({ puzzleDay: '2026-09-03', guesses: ['CRANE', 'SPEED'], answer: 'SPEED' })
    expect(screen.getByText('2/6')).not.toBeNull()
  })

  /*
    attemptsFor returns 7 as its sentinel for a failed board (convex/lib/
    board.ts). Nobody takes seven guesses, so the row must translate that
    sentinel to 'X' rather than let it leak through as a literal count.
  */
  test('an unsolved board shows X/6, never 7/6', () => {
    row({
      puzzleDay: '2026-09-03',
      guesses: ['CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE'],
      answer: 'SPEED',
    })
    expect(screen.getByText('X/6')).not.toBeNull()
    expect(screen.queryByText('7/6')).toBeNull()
  })

  test('the score is tabular-nums and sits right of the day', () => {
    row({ puzzleDay: '2026-09-03', guesses: ['CRANE', 'SPEED'], answer: 'SPEED' })
    expect(screen.getByText('2/6').className).toContain('tabular-nums')
  })
})

describe('the day', () => {
  test('reads the weekday and ordinal from formatDayHeaderParts', () => {
    // 2026-09-03 is a Thursday.
    row({ puzzleDay: '2026-09-03', guesses: ['CRANE'], answer: 'SPEED' })
    expect(screen.getByText('Thu 3rd')).not.toBeNull()
  })
})

describe('the opener', () => {
  /*
   * BOTH HALVES, BECAUSE ASSERTING ONLY ONE IS HOW THE REGRESSION GOT THROUGH.
   * This previously checked that the sentence "2nd of 14,855" existed somewhere
   * and passed while the row silently lost the word "ranks" — the visible copy
   * went from "Opener CRANE ranks 2nd of 14,855" to "Opener CRANE 2nd of
   * 14,855". Only e2e/insights.spec.ts, which matches the whole phrase, caught
   * it. So: the compact badge a sighted reader sees, AND the full sentence that
   * carries the denominator for assistive tech, pinned separately.
   */
  test('names the word, a compact rank badge, and the full sentence for assistive tech', () => {
    row({ puzzleDay: '2026-09-03', guesses: ['CRANE'], answer: 'SPEED' })
    expect(screen.getByText('CRANE')).not.toBeNull()
    expect(screen.getByText('#2')).not.toBeNull()
    expect(screen.getByText('ranks 2nd of 14,855')).not.toBeNull()
  })

  /*
   * Copied verbatim from BoardCard's own absent state (see
   * -insights.hook.test.ts's identical assertion). NEVER a zero — 'ranks
   * 0th' reads as a real and extreme result, and 26 of our boards have an
   * opener the corpus does not hold.
   */
  test('an opener the corpus does not hold says so, never a zero', () => {
    row({ puzzleDay: '2026-09-03', guesses: ['XXXXX'], answer: 'SPEED' })
    const boardEl = screen.getByTestId('insights-board')
    expect(boardEl.textContent).toContain('is not in the benchmark set')
    expect(boardEl.textContent).not.toContain('0th')
    expect(boardEl.textContent).not.toContain('0 of')
  })
})

describe('the difficulty', () => {
  test('names the label and the sentence', () => {
    row({ puzzleDay: '2026-09-03', guesses: ['CRANE'], answer: 'SPEED' })
    expect(screen.getByText('Hard for the solver')).not.toBeNull()
    expect(screen.getByTestId('insights-board').textContent).toContain(
      'Harder than 95% of past puzzles',
    )
  })

  /*
   * Copied verbatim from BoardCard's own absent state. The common miss
   * rather than an edge case: the corpus publishes only globally completed
   * days, so a day past the artifact's range never has a row.
   */
  test('a day outside the artifact’s range says so, never 0%', () => {
    row({ puzzleDay: '2026-12-25', guesses: ['CRANE'], answer: 'SPEED' })
    const boardEl = screen.getByTestId('insights-board')
    expect(boardEl.textContent).toContain('not rated yet')
    expect(boardEl.textContent).not.toContain('0%')
    // The half that still works must survive the half that does not.
    expect(boardEl.textContent).toContain('2nd of 14,855')
  })
})
