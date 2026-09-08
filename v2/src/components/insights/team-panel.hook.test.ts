// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, and `.hook.test.ts` with
// createElement by hand, because vitest.config.ts's glob is `src/**/*.test.ts` —
// a .tsx file would simply not run. Same shape as every other component test here.
//
// The statistics themselves are covered against fixtures in
// lib/insights-team.test.ts. What this file exists for is the part a pure test
// cannot reach: that a null from those functions becomes a SENTENCE rather than a
// dash, a zero, or a NaN — the empty states wordle-teams-g6eb requires to be
// stated rather than accidental.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { TeamPanel, type TeamPanelData } from './team-panel.tsx'

afterEach(cleanup)

const roster = [
  { playerId: 'me', firstName: 'Ada', lastName: 'Lovelace' },
  { playerId: 'you', firstName: 'Alan', lastName: 'Turing' },
]

const panel = (data: TeamPanelData) => render(createElement(TeamPanel, { data }))

const stats = (days: { puzzleDay: string; entries: { playerId: string; attempts: number }[] }[]) => {
  const members = roster.map(({ playerId }) => {
    const mine = days.flatMap((d) => d.entries).filter((e) => e.playerId === playerId)
    return {
      playerId,
      boards: mine.length,
      attempts: mine.reduce((t, e) => t + e.attempts, 0),
      solved: mine.filter((e) => e.attempts !== 7).length,
      failed: mine.filter((e) => e.attempts === 7).length,
    }
  })
  return { members, days }
}

describe('a month with boards', () => {
  const data: TeamPanelData = {
    viewerId: 'me',
    roster,
    stats: stats([
      {
        puzzleDay: '2026-09-01',
        entries: [
          { playerId: 'me', attempts: 3 },
          { playerId: 'you', attempts: 4 },
        ],
      },
      {
        puzzleDay: '2026-09-02',
        entries: [
          { playerId: 'me', attempts: 5 },
          { playerId: 'you', attempts: 4 },
        ],
      },
    ]),
  }

  test('renders all four views', () => {
    panel(data)
    expect(screen.getByTestId('insights-head-to-head')).not.toBeNull()
    expect(screen.getByTestId('insights-team-averages')).not.toBeNull()
    expect(screen.getByTestId('insights-team-days')).not.toBeNull()
    expect(screen.getByTestId('insights-team-consistency')).not.toBeNull()
  })

  test('names the teammate and states the record over shared days', () => {
    panel(data)
    const record = screen.getByTestId('insights-head-to-head').textContent ?? ''
    expect(record).toContain('Alan Turing')
    expect(record).toContain('1-1')
    // The denominator matters: a record without it implies a whole month.
    expect(record).toContain('2 shared days')
  })

  test('does not compare the viewer with themselves', () => {
    panel(data)
    expect(screen.getByTestId('insights-head-to-head').textContent).not.toContain('Ada Lovelace')
  })
})

describe('the empty states, which are stated rather than accidental', () => {
  test('a month nobody has played says so', () => {
    panel({ viewerId: 'me', roster, stats: stats([]) })
    expect(screen.getByTestId('insights-team-empty').textContent).toContain(
      'Nobody on this team has entered a board this month yet',
    )
  })

  test('a missing aggregate is the same empty month, not an error', () => {
    // The rollup writes on the first board of a month, so a month nobody has
    // played has no row at all. That is common, not a failure.
    panel({ viewerId: 'me', roster, stats: null })
    expect(screen.getByTestId('insights-team-empty')).not.toBeNull()
  })

  /** A solo team is the most common shape in this product. */
  test('a one-member team says there is nobody to compare with', () => {
    panel({
      viewerId: 'me',
      roster: [roster[0]],
      stats: {
        members: [{ playerId: 'me', boards: 1, attempts: 3, solved: 1, failed: 0 }],
        days: [{ puzzleDay: '2026-09-01', entries: [{ playerId: 'me', attempts: 3 }] }],
      },
    })
    expect(screen.getByTestId('insights-head-to-head').textContent).toContain(
      'only member of this team',
    )
  })

  test('a member with no boards reads as absent, never as an average of zero', () => {
    // Zero would render as a perfect month rather than an unplayed one.
    panel({
      viewerId: 'me',
      roster,
      stats: {
        members: [
          { playerId: 'me', boards: 1, attempts: 3, solved: 1, failed: 0 },
          { playerId: 'you', boards: 0, attempts: 0, solved: 0, failed: 0 },
        ],
        days: [{ puzzleDay: '2026-09-01', entries: [{ playerId: 'me', attempts: 3 }] }],
      },
    })
    const averages = screen.getByTestId('insights-team-averages').textContent ?? ''
    expect(averages).toContain('no boards this month')
    expect(averages).not.toContain('Alan Turing0')
  })

  test('a teammate with no shared days says so rather than showing 0-0', () => {
    panel({
      viewerId: 'me',
      roster,
      stats: {
        members: [
          { playerId: 'me', boards: 1, attempts: 3, solved: 1, failed: 0 },
          { playerId: 'you', boards: 0, attempts: 0, solved: 0, failed: 0 },
        ],
        days: [{ puzzleDay: '2026-09-01', entries: [{ playerId: 'me', attempts: 3 }] }],
      },
    })
    expect(screen.getByTestId('insights-head-to-head').textContent).toContain('no shared days yet')
  })
})
