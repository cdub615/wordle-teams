// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Id } from '../../convex/_generated/dataModel'
import { ScoresGrid, ScoresTable } from './scores-table.tsx'

vi.mock('@convex-dev/react-query', () => ({ convexQuery: () => ({}) }))
vi.mock('@tanstack/react-query', () => ({ useSuspenseQuery: () => ({ data: wordleMonth }) }))

afterEach(cleanup)

const system = {
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: 0,
  failed: -1,
  nA: 0,
}
const id = (s: string) => s as Id<'players'>

// Only ScoresTable reads a query; ScoresGrid takes its data as props.
const wordleMonth = {
  team: { playWeekends: false, system },
  players: [
    {
      id: 'a',
      firstName: 'Al',
      lastName: 'One',
      scores: [
        { puzzleDay: '2026-08-03', answer: 'CRANE', guesses: ['SLATE', 'CRANE'] },
        { puzzleDay: '2026-08-04', answer: 'CRANE', guesses: ['AAAAA', 'BBBBB', 'CCCCC', 'DDDDD', 'EEEEE', 'FFFFF'] },
      ],
    },
  ],
}

// A month wholly in the past, so every day is due and the totals are fixed.
const MONTH = '2026-08'

describe('ScoresGrid', () => {
  const players = [
    { id: id('b'), firstName: 'Bea', lastName: 'Two', days: [{ puzzleDay: '2026-08-03', attempts: 2 }] },
    {
      id: id('a'),
      firstName: 'Al',
      lastName: 'One',
      days: [
        { puzzleDay: '2026-08-03', attempts: 1 },
        { puzzleDay: '2026-08-04', attempts: 7 },
      ],
    },
  ]

  test('totals attempts with the given system and sorts by total', () => {
    const { container } = render(
      createElement(ScoresGrid, { teamId: 't' as Id<'teams'>, month: MONTH, players, system, playWeekends: true }),
    )
    const rows = [...container.querySelectorAll('tbody tr')]
    // Al: 5 + (-1) = 4. Bea: 3. Missed days score nA = 0.
    expect(rows.map((r) => r.lastElementChild?.textContent)).toEqual(['4', '3'])
  })

  test('a failed day shows X', () => {
    const { container } = render(
      createElement(ScoresGrid, { teamId: 't' as Id<'teams'>, month: MONTH, players, system, playWeekends: true }),
    )
    const al = container.querySelectorAll('tbody tr')[0]
    expect(al.querySelector('[data-day="2026-08-04"]')?.textContent).toBe('X')
    expect(al.querySelector('[data-day="2026-08-03"]')?.textContent).toBe('1')
  })

  test('a duplicated day shows its last row but counts its first', () => {
    // Today's behaviour, kept on purpose: the cell map is `new Map(...)`, so the
    // last row wins there, while monthTotal keeps the first row for a day.
    const dup = [
      {
        id: id('d'),
        firstName: 'Di',
        lastName: 'Dup',
        days: [
          { puzzleDay: '2026-08-05', attempts: 1 },
          { puzzleDay: '2026-08-05', attempts: 2 },
        ],
      },
    ]
    const { container } = render(
      createElement(ScoresGrid, { teamId: 't' as Id<'teams'>, month: MONTH, players: dup, system, playWeekends: true }),
    )
    const row = container.querySelectorAll('tbody tr')[0]
    expect(row.querySelector('[data-day="2026-08-05"]')?.textContent).toBe('2')
    // 5 for the first row's one guess, not 3 for the second row's two.
    expect(row.lastElementChild?.textContent).toBe('5')
  })
})

describe('ScoresTable', () => {
  test('hands the grid Wordle boards as attempts, with the team’s weekend rule', () => {
    const { container } = render(createElement(ScoresTable, { teamId: 't' as Id<'teams'>, month: MONTH }))
    const al = container.querySelectorAll('tbody tr')[0]
    expect(al.querySelector('[data-day="2026-08-03"]')?.textContent).toBe('2')
    expect(al.querySelector('[data-day="2026-08-04"]')?.textContent).toBe('X')
    // 2026-08-01 is a Saturday, and this team does not play weekends.
    expect(al.querySelector('[data-day="2026-08-01"]')?.textContent).toBe('N/A')
    // 3 for two guesses, -1 for the X.
    expect(al.lastElementChild?.textContent).toBe('2')
  })
})
