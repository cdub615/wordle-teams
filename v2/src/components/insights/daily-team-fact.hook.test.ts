// @vitest-environment jsdom
//
// jsdom and `.hook.test.ts` with createElement, matching every other component
// test here — vitest.config.ts's glob is `src/**/*.test.ts`, so .tsx would not run.
//
// dailyTeamFact's own outcomes are covered in lib/insights-team.test.ts. This
// file is about the SENTENCES, because the requirement wordle-teams-jqs4 puts
// first is a copy requirement: when nobody else has played, it must say so rather
// than claim a win over zero people.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { DailyTeamFact } from './daily-team-fact.tsx'
import type { ReactNode } from 'react'
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

const fact = (stats: TeamMonth | null, teamName?: string, controls?: ReactNode) =>
  render(
    createElement(DailyTeamFact, {
      stats,
      viewerId: 'me',
      today: TODAY,
      teamName,
      controls,
    }),
  )

/**
 * A stand-in for the team dropdown team-section.tsx passes when — and only
 * when — the viewer is on two or more teams. What the card branches on is the
 * PRESENCE of a control, never its contents, so a bare element is the honest
 * fixture: coupling these tests to TeamScopeControls would test that component
 * again rather than this one's rule.
 */
const aDropdown = createElement('div', { 'data-testid': 'a-dropdown' }, 'Team: Alpha')

describe('the free daily team fact', () => {
  test('says how many teammates the viewer beat, in words', () => {
    fact(statsOf({ me: 3, a: 4, b: 5, c: 2 }, ['me', 'a', 'b', 'c']))
    expect(screen.getByTestId('insights-daily-fact-text').textContent).toBe(
      'You beat two of three teammates who have played today.',
    )
  })

  test('uses the singular for one teammate — noun AND verb (wordle-teams-f441)', () => {
    // The bug: the noun switched on `compared === 1` and the verb did not, so a
    // two-person team — the commonest team there is — read "one teammate who
    // HAVE played today" on the single most shareable string in the product.
    fact(statsOf({ me: 3, a: 4 }, ['me', 'a']))
    const text = screen.getByTestId('insights-daily-fact-text').textContent ?? ''
    expect(text).toBe('You beat one of one teammate who has played today.')
    expect(text).not.toContain('who have')
  })

  /**
   * The requirement the task puts first, and the state most likely to look broken:
   * on a small team early in the day this is the common case, and "you beat 0 of 0
   * teammates" reads as a loss and a bug at once.
   */
  test('says nobody else has played rather than claiming a win over zero', () => {
    fact(statsOf({ me: 3 }, ['me', 'a', 'b']))
    const text = screen.getByTestId('insights-daily-fact-text').textContent ?? ''
    expect(text).toContain('none of your two teammates have played yet')
    expect(text).not.toContain('beat')
    expect(text).not.toContain('zero of zero')
    // A bare numeral in a sentence written to be pasted into a group chat is the
    // other half of wordle-teams-f441; `count` governs every branch now.
    expect(text).not.toContain('your 2 ')
  })

  test('drops the quantifier entirely when there is exactly one teammate', () => {
    // THE MIRROR OF THE SINGULAR BUG ABOVE, and the one that cannot be fixed by
    // inflecting: "none of your one teammates" and "none of your one teammate"
    // are both worse than the sentence that stops saying "none of".
    fact(statsOf({ me: 3 }, ['me', 'a']))
    const text = screen.getByTestId('insights-daily-fact-text').textContent ?? ''
    expect(text).toBe('You entered today’s board first — your teammate has not played yet.')
    expect(text).not.toContain('none of')
    expect(text).not.toContain('1 teammates')
  })

  test('a solo team is asked to invite somebody, not told they won', () => {
    fact(statsOf({ me: 3 }, ['me']))
    const text = screen.getByTestId('insights-daily-fact-text').textContent ?? ''
    expect(text).toContain('Invite a teammate')
    expect(text).not.toContain('beat')
  })

  test('renders nothing at all before the viewer has entered today', () => {
    // Not an empty card: they are being asked for a board, and the dashboard
    // already asks. Still the rule whenever there is no control to strand.
    fact(statsOf({ a: 4 }, ['me', 'a']))
    expect(screen.queryByTestId('insights-daily-fact')).toBeNull()
  })

  test('and nothing when there is no aggregate at all', () => {
    fact(null)
    expect(screen.queryByTestId('insights-daily-fact')).toBeNull()
  })
})

/*
  THE ONE THING THAT SUSPENDS THE RULE ABOVE (wordle-teams-4b0m).

  The team dropdown lives in this card's HEADER, so returning null before the
  viewer has played took the picker with the sentence — and a free player on two
  or more teams could not change which team /insights was scoped to until they
  had played. That is the default state every morning, and on the free tier
  nothing else on the page is team-scoped, so `?team=` and the stored team were
  frozen for the whole window.

  The decision 4b0m asked for, recorded: the card appears exactly when it is
  carrying a control. A one-team account still gets nothing, because there is no
  picker to strand and the card would be a bare request for a board.
*/
describe('the empty state, when the card is also the team picker', () => {
  test('renders the card, the header and the dropdown before the viewer has played', () => {
    fact(statsOf({ a: 4 }, ['me', 'a']), undefined, aDropdown)

    expect(screen.queryByTestId('insights-daily-fact')).not.toBeNull()
    expect(screen.queryByTestId('a-dropdown')).not.toBeNull()
    expect(screen.getByTestId('insights-daily-fact-text').textContent).toBe(
      'Enter today’s board to see how you compare.',
    )
  })

  test('with no aggregate at all, which is the same window', () => {
    // `stats: null` is a month nobody on the team has played. It reaches
    // dailyTeamFact as the same 'no-board' outcome, and the picker has to
    // survive it for the same reason.
    fact(null, undefined, aDropdown)
    expect(screen.queryByTestId('a-dropdown')).not.toBeNull()
  })

  test('still carries the sr-only heading naming the team', () => {
    // The heading is what gives the dropdown something to belong to in the
    // document, and this is the shape where the dropdown is ALL there is.
    fact(statsOf({ a: 4 }, ['me', 'a']), 'The Wordlers', aDropdown)
    expect(screen.getByRole('heading', { level: 2, name: 'The Wordlers' })).not.toBeNull()
  })

  test('a one-team account gets nothing, control or not', () => {
    // The asymmetry, asserted rather than assumed: no control means no card,
    // which is the rule this whole block is the exception to.
    fact(statsOf({ a: 4 }, ['me', 'a']))
    expect(screen.queryByTestId('insights-daily-fact')).toBeNull()
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
    fact(statsOf({ me: 3, a: 4 }, ['me', 'a']), 'The Wordlers')
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
