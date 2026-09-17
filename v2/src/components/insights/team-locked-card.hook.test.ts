// @vitest-environment jsdom
//
// jsdom and `.hook.test.ts` with createElement, matching every other component
// test here — vitest.config.ts's glob is `src/**/*.test.ts`, so .tsx would not run.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TeamLockedCard } from './team-locked-card.tsx'
import type { TeamRankTeaser } from '../../../convex/lib/teamStats.ts'

afterEach(cleanup)

const ROSTER = [
  { playerId: 'me', firstName: 'Ada', lastName: 'Lovelace' },
  { playerId: 'a', firstName: 'Grace', lastName: 'Hopper' },
  { playerId: 'b', firstName: 'Alan', lastName: 'Turing' },
]

const card = (rank: TeamRankTeaser, over: { roster?: typeof ROSTER } = {}) =>
  render(
    createElement(TeamLockedCard, {
      teamName: 'Alpha Analysts',
      month: '2026-09',
      roster: over.roster ?? ROSTER,
      viewerId: 'me',
      rank,
      onUpgrade: vi.fn(),
      onInvite: vi.fn(),
    }),
  )

describe('the headline says what would make the numbers appear', () => {
  test('ranked: the standing itself', () => {
    card({ kind: 'ranked', rank: 3, of: 5 })
    // A TYPOGRAPHIC APOSTROPHE, matching every other shipped string here —
    // daily-team-fact.tsx's "Enter today’s board to see how you compare." and
    // the e2e assertions that match on it.
    expect(screen.getByTestId('insights-locked-headline').textContent).toBe(
      'You’re 3rd of 5 this month',
    )
  })

  test('ranked: the ordinal is right at 1, 2, 3 and beyond', () => {
    // `ordinal` is lib/format-day.ts's, NOT a local copy — that helper already
    // exists and already handles the teens. This stays as a CALL-SITE check
    // (that the headline uses it at all), not a second test of the helper.
    for (const [rank, expected] of [
      [1, '1st'],
      [2, '2nd'],
      [3, '3rd'],
      [4, '4th'],
      [11, '11th'],
      [21, '21st'],
    ] as const) {
      cleanup()
      card({ kind: 'ranked', rank, of: 30 })
      expect(screen.getByTestId('insights-locked-headline').textContent).toContain(expected)
    }
  })

  test('not-played: asks the reader for a board', () => {
    card({ kind: 'not-played' })
    const text = screen.getByTestId('insights-locked-headline').textContent ?? ''
    expect(text).toContain('See where you rank')
    expect(screen.getByTestId('insights-locked-note').textContent).toContain('Enter a board')
  })

  test('nobody-else: does NOT blame the reader', () => {
    // A diligent player whose teammates have not shown up. The two missing-rank
    // states exist as separate tags precisely so this sentence is not the one
    // above (wordle-teams-iht.2).
    card({ kind: 'nobody-else' })
    const text = screen.getByTestId('insights-locked-headline').textContent ?? ''
    expect(text).toContain('only one playing')
    expect(screen.getByTestId('insights-locked-note').textContent).toContain('teammates')
  })

  test('solo: names the missing thing as a team', () => {
    card({ kind: 'solo' }, { roster: [ROSTER[0]!] })
    expect(screen.getByTestId('insights-locked-headline').textContent).toContain(
      'Team insights need a team',
    )
  })
})

describe('the rows', () => {
  test('carry the real teammates, and never the viewer, in head to head', () => {
    card({ kind: 'ranked', rank: 3, of: 5 })
    const rows = screen.getByTestId('insights-locked-h2h')
    expect(rows.textContent).toContain('Grace Hopper')
    expect(rows.textContent).toContain('Alan Turing')
    // You do not play yourself.
    expect(rows.textContent).not.toContain('Ada Lovelace')
  })

  test('a solo team gets a generic row instead, since there are no names', () => {
    card({ kind: 'solo' }, { roster: [ROSTER[0]!] })
    expect(screen.getByTestId('insights-locked-h2h').textContent).toContain('Your teammates')
  })

  test('NO DIGIT EVER APPEARS IN A REDACTED SLOT', () => {
    // THE REGRESSION TEST FOR THE WHOLE DESIGN. The figures do not reach the
    // client at all since wordle-teams-iht.3, so anything numeric in a value
    // slot is necessarily invented — which is the "invented team's head-to-head"
    // this feature exists to avoid. Scoped to the slots, not the card: the
    // ranked headline legitimately contains "3rd of 5".
    card({ kind: 'ranked', rank: 3, of: 5 })
    for (const slot of screen.getAllByTestId('insights-locked-value')) {
      expect(slot.textContent ?? '').not.toMatch(/\d/)
    }
  })

  test('every redacted slot says something to a screen reader', () => {
    // A grey bar conveys nothing without sight. Each slot carries its own
    // sr-only label naming what is hidden.
    card({ kind: 'ranked', rank: 3, of: 5 })
    const slots = screen.getAllByTestId('insights-locked-value')
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      expect((slot.textContent ?? '').trim().length).toBeGreaterThan(0)
    }
  })
})

describe('the call to action', () => {
  test('offers the upgrade in the three states where it would deliver', () => {
    for (const rank of [
      { kind: 'ranked', rank: 3, of: 5 },
      { kind: 'not-played' },
      { kind: 'nobody-else' },
    ] as TeamRankTeaser[]) {
      cleanup()
      const onUpgrade = vi.fn()
      render(
        createElement(TeamLockedCard, {
          teamName: 'Alpha Analysts',
          month: '2026-09',
          roster: ROSTER,
          viewerId: 'me',
          rank,
          onUpgrade,
          onInvite: vi.fn(),
        }),
      )
      fireEvent.click(screen.getByTestId('insights-locked-cta'))
      expect(onUpgrade).toHaveBeenCalledOnce()
      expect(screen.queryByTestId('insights-locked-cta')!.textContent).toContain('Unlock')
    }
  })

  test('but asks a SOLO team to invite instead, because upgrading buys them nothing', () => {
    // team-panel.tsx tells a solo player outright that there is "nobody to
    // compare with". Selling the upgrade here would be selling a dud.
    const onUpgrade = vi.fn()
    const onInvite = vi.fn()
    render(
      createElement(TeamLockedCard, {
        teamName: 'Alpha Analysts',
        month: '2026-09' as const,
        roster: [ROSTER[0]!],
        viewerId: 'me',
        rank: { kind: 'solo' },
        onUpgrade,
        onInvite,
      }),
    )
    const cta = screen.getByTestId('insights-locked-cta')
    expect(cta.textContent).toContain('Invite')
    fireEvent.click(cta)
    expect(onInvite).toHaveBeenCalledOnce()
    expect(onUpgrade).not.toHaveBeenCalled()
  })
})

describe('the card frame', () => {
  test('gives the region a heading, as every sibling card does', () => {
    card({ kind: 'ranked', rank: 3, of: 5 })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Alpha Analysts')
  })

  test('names the team and the month', () => {
    card({ kind: 'ranked', rank: 3, of: 5 })
    const head = screen.getByTestId('insights-locked-scope').textContent ?? ''
    expect(head).toContain('Alpha Analysts')
    // "Sep 2026", NOT "September". format-day.ts's formatMonthLabel is a
    // `{ month: 'short', year: 'numeric' }` formatter, and daily-benchmark and
    // trend-panel already render months that way — matching them matters more
    // than the longer word.
    expect(head).toContain('Sep 2026')
  })
})
