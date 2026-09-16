// @vitest-environment jsdom
//
// jsdom and `.hook.test.ts` with createElement, matching every other component
// test here — vitest.config.ts's glob is `src/**/*.test.ts`, so .tsx would not run.
//
// dailyTeamFact's own outcomes are covered in lib/insights-team.test.ts. This
// file is about the SENTENCES, because the requirement wordle-teams-jqs4 puts
// first is a copy requirement: when nobody else has played, it must say so rather
// than claim a win over zero people.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DailyTeamFact } from './daily-team-fact.tsx'
import type { TeamMonth } from '#/lib/insights-team.ts'

afterEach(cleanup)

const TODAY = '2026-09-08'

const statsOf = (entries: Record<string, number>, memberIds: string[]): TeamMonth => ({
  members: memberIds.map((playerId) => ({
    playerId,
    boards: entries[playerId] === undefined ? 0 : 1,
    attempts: entries[playerId] ?? 0,
    solved: entries[playerId] === undefined ? 0 : 1,
    failed: 0,
  })),
  days: [
    {
      puzzleDay: TODAY,
      entries: memberIds
        .filter((id) => entries[id] !== undefined)
        .map((playerId) => ({ playerId, attempts: entries[playerId] })),
    },
  ],
})

const fact = (stats: TeamMonth | null, onSeeFullMonth?: () => void, teamName?: string) =>
  render(
    createElement(DailyTeamFact, { stats, viewerId: 'me', today: TODAY, onSeeFullMonth, teamName }),
  )

describe('the free daily team fact', () => {
  test('says how many teammates the viewer beat, in words', () => {
    fact(statsOf({ me: 3, a: 4, b: 5, c: 2 }, ['me', 'a', 'b', 'c']))
    expect(screen.getByTestId('insights-daily-fact-text').textContent).toBe(
      'You beat two of three teammates who have played today.',
    )
  })

  test('uses the singular for one teammate', () => {
    fact(statsOf({ me: 3, a: 4 }, ['me', 'a']))
    expect(screen.getByTestId('insights-daily-fact-text').textContent).toContain(
      'one of one teammate who have played today',
    )
  })

  /**
   * The requirement the task puts first, and the state most likely to look broken:
   * on a small team early in the day this is the common case, and "you beat 0 of 0
   * teammates" reads as a loss and a bug at once.
   */
  test('says nobody else has played rather than claiming a win over zero', () => {
    fact(statsOf({ me: 3 }, ['me', 'a', 'b']))
    const text = screen.getByTestId('insights-daily-fact-text').textContent ?? ''
    expect(text).toContain('none of your 2 teammates have played yet')
    expect(text).not.toContain('beat')
    expect(text).not.toContain('zero of zero')
  })

  test('a solo team is asked to invite somebody, not told they won', () => {
    fact(statsOf({ me: 3 }, ['me']))
    const text = screen.getByTestId('insights-daily-fact-text').textContent ?? ''
    expect(text).toContain('Invite a teammate')
    expect(text).not.toContain('beat')
  })

  test('renders nothing at all before the viewer has entered today', () => {
    // Not an empty card: they are being asked for a board, and the dashboard
    // already asks.
    fact(statsOf({ a: 4 }, ['me', 'a']))
    expect(screen.queryByTestId('insights-daily-fact')).toBeNull()
  })

  test('and nothing when there is no aggregate at all', () => {
    fact(null)
    expect(screen.queryByTestId('insights-daily-fact')).toBeNull()
  })
})

describe('the paywall hook', () => {
  test('offers "see the full month" once there is a comparison to expand', () => {
    const onSeeFullMonth = vi.fn()
    fact(statsOf({ me: 3, a: 4 }, ['me', 'a']), onSeeFullMonth)

    const link = screen.getByTestId('insights-see-full-month')
    expect(link.textContent).toContain('See the full month')
    fireEvent.click(link)
    expect(onSeeFullMonth).toHaveBeenCalledOnce()
  })

  /**
   * The affordance is what this task owes; the destination belongs to
   * wordle-teams-iht. Offering it where there is nothing to expand would be
   * advertising the paid surface off an empty one.
   */
  test('and does not offer it when nobody else has played', () => {
    fact(statsOf({ me: 3 }, ['me', 'a']))
    expect(screen.queryByTestId('insights-see-full-month')).toBeNull()
  })
})

/*
  THE CARD'S HEADING, WHICH IS NOT ITS TITLE.

  This card paints no title — its design is one sentence — but it hosts the team
  dropdown, and it had no heading at all. A reader navigating by heading skipped
  the region entirely and landed on a bare "Team: ..." button with nothing to
  say what it belonged to. The heading is the fix; a painted title is not.

  The ROUTE's half of this — that the real team name is what gets passed — is in
  routes/-insights-team-scope.hook.test.ts. What lives here is the contract:
  present in every shape, and never empty.
*/
describe('the sr-only heading', () => {
  test('names the team, hidden, whether or not the card draws a header', () => {
    fact(statsOf({ me: 3, a: 4 }, ['me', 'a']), undefined, 'The Wordlers')
    const heading = screen.getByRole('heading', { level: 2, name: 'The Wordlers' })
    expect(heading.className).toContain('sr-only')
    // No controls in this render, so there is no CardHeader — the heading must
    // not have been tucked inside one.
    expect(screen.getByTestId('insights-daily-fact').contains(heading)).toBe(true)
  })

  test('falls back rather than coming out empty, the same way TeamPanel does', () => {
    // `teamName` is optional, and an empty heading is worse than a vague one.
    fact(statsOf({ me: 3, a: 4 }, ['me', 'a']))
    expect(screen.getByRole('heading', { level: 2, name: 'Your team' })).not.toBeNull()
  })
})
