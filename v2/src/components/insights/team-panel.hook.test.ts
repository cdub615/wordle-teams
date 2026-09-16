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

const panel = (data: TeamPanelData, teamName?: string) =>
  render(createElement(TeamPanel, { data, teamName }))

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

describe('a month with boards', () => {
  test('renders all four views', () => {
    panel(data)
    expect(screen.getByTestId('insights-head-to-head')).not.toBeNull()
    expect(screen.getByTestId('insights-team-averages')).not.toBeNull()
    expect(screen.getByTestId('insights-team-days')).not.toBeNull()
    expect(screen.getByTestId('insights-team-consistency')).not.toBeNull()
  })

  test('names the teammate and states the record over shared days', () => {
    // EXACTLY ONE OPPONENT (a two-person team) now renders the versus block
    // instead of a list row, so wins and losses appear as two SEPARATE
    // tabular-nums figures rather than a combined "1-1" string — this
    // assertion changed shape along with the markup, not the coverage: it
    // still pins both figures' values, just individually rather than as one
    // substring.
    panel(data)
    const versus = screen.getByTestId('insights-versus')
    expect(versus.textContent).toContain('Alan Turing')
    // The denominator matters: a record without it implies a whole month.
    expect(versus.textContent).toContain('2 shared days')
    const figures = screen.getAllByTestId('insights-versus-figure')
    expect(figures).toHaveLength(2)
    expect(figures[0]?.textContent).toBe('1')
    expect(figures[1]?.textContent).toBe('1')
  })

  test('does not compare the viewer with themselves', () => {
    // The viewer's side of the versus block is labelled "You", matching the
    // rest of this feature's voice (daily-team-fact.tsx), so their own name
    // never appears here — not even in the block that exists specifically to
    // compare them with a teammate.
    panel(data)
    expect(screen.getByTestId('insights-head-to-head').textContent).not.toContain('Ada Lovelace')
  })

  test('a two-or-more-opponent team keeps the list, not the versus block', () => {
    // Three members means two opponents — this must NOT hit the
    // exactly-one-opponent branch. A regression that widened the versus
    // condition (e.g. `records.length >= 1`) would render a scoreboard for
    // only one of the two opponents and silently drop the other.
    const threeRoster = [
      ...roster,
      { playerId: 'them', firstName: 'Grace', lastName: 'Hopper' },
    ]
    panel({
      viewerId: 'me',
      roster: threeRoster,
      stats: {
        members: threeRoster.map(({ playerId }) => ({
          playerId,
          boards: 1,
          attempts: playerId === 'me' ? 3 : 4,
          solved: 1,
          failed: 0,
        })),
        days: [
          {
            puzzleDay: '2026-09-01',
            entries: threeRoster.map(({ playerId }) => ({
              playerId,
              attempts: playerId === 'me' ? 3 : 4,
            })),
          },
        ],
      },
    })
    expect(screen.queryByTestId('insights-versus')).toBeNull()
    const record = screen.getByTestId('insights-head-to-head').textContent ?? ''
    expect(record).toContain('Alan Turing')
    expect(record).toContain('Grace Hopper')
    expect(record).toContain('1-0')
  })
})

describe('the card title names the team', () => {
  test('uses the given team name', () => {
    panel(data, 'The Wordlers')
    expect(screen.getByText('The Wordlers')).not.toBeNull()
  })

  test('falls back to "Your team" when no name is given', () => {
    panel(data)
    expect(screen.getByText('Your team')).not.toBeNull()
  })

  test('the empty state also falls back to "Your team"', () => {
    panel({ viewerId: 'me', roster, stats: null })
    expect(screen.getByText('Your team')).not.toBeNull()
  })

  test('the empty state also honours a given team name', () => {
    panel({ viewerId: 'me', roster, stats: null }, 'The Wordlers')
    expect(screen.getByText('The Wordlers')).not.toBeNull()
  })
})

describe('averages render as bars, scaled against the worst mean', () => {
  test('states the direction, since a shorter bar is the good outcome here', () => {
    panel(data)
    expect(screen.getByTestId('insights-team-averages').textContent).toContain(
      'avg guesses · lower is better',
    )
  })

  test('the worst mean gets a full-width bar and a better mean a shorter one', () => {
    // 'me' averages 4 over two boards (3, 5); 'you' averages 4 over two boards
    // (4, 4) too in the base fixture, so use a fixture with a genuine spread:
    // 'me' at 3, 'you' at 5 — 'you' is worse (more guesses) and must get the
    // full-width (100%) bar, 'me' the shorter one, never the reverse.
    const spread: TeamPanelData = {
      viewerId: 'me',
      roster,
      stats: {
        members: [
          { playerId: 'me', boards: 1, attempts: 3, solved: 1, failed: 0 },
          { playerId: 'you', boards: 1, attempts: 5, solved: 1, failed: 0 },
        ],
        days: [
          {
            puzzleDay: '2026-09-01',
            entries: [
              { playerId: 'me', attempts: 3 },
              { playerId: 'you', attempts: 5 },
            ],
          },
        ],
      },
    }
    const { container } = panel(spread)
    const bars = container.querySelectorAll('[data-testid="insights-team-averages"] .bg-muted-foreground')
    expect(bars).toHaveLength(2)
    // 'me' (3) then 'you' (5), matching roster and member order.
    expect((bars[0] as HTMLElement).style.width).toBe('60%')
    expect((bars[1] as HTMLElement).style.width).toBe('100%')
  })

  test('a member with no boards gets no bar at all, only the sentence', () => {
    const { container } = panel({
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
    const bars = container.querySelectorAll('[data-testid="insights-team-averages"] .bg-muted-foreground')
    expect(bars).toHaveLength(1)
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
