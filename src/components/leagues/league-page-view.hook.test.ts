// @vitest-environment jsdom
//
// The /leagues/$slug page's logic, rendered without a router or a backend: the
// route owns only queries, mutations and toasts, so everything a viewer sees
// per state is decided here.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { LeaguePageView, leaveMessage, membershipIn } from './league-page-view.tsx'

// A plain anchor: the real Link needs a RouterProvider, and nothing here is
// about routing. `...rest` keeps what Button asChild merges onto it.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) =>
    createElement('a', { href: to, ...rest }, children),
}))

afterEach(cleanup)

const groups = ['CRANE', 'SLATE', 'ADIEU'].map((name, i) => ({ _id: `g${i}`, name, memberCount: 3 }))
const view = {
  league: { slug: 'starting-words', name: 'Starting Words' },
  month: '2026-10',
  groups,
  standings: [
    { groupId: 'g0', rank: 1, average: 3.8, boards: 142, contributors: 9 },
    { groupId: 'g1', rank: 2, average: 3.9, boards: 96, contributors: 6 },
    { groupId: 'g2', rank: null, average: null, boards: 6, contributors: 2 },
  ],
  lastMonth: null,
  monthsWon: [],
}
const crane = {
  league: { slug: 'starting-words', name: 'Starting Words' },
  leagueId: 'l1',
  group: { _id: 'g0', name: 'CRANE' },
  since: '2026-10-02',
  pending: null,
}
const switching = { ...crane, pending: { group: { _id: 'g1', name: 'SLATE' }, from: '2026-11-01' } }

const props = (overrides: Record<string, unknown> = {}) => ({
  slug: 'starting-words',
  standings: { enabled: true as const, view },
  mine: { enabled: true as const, leagues: [] as (typeof crane)[] },
  contribution: { enabled: true as const, locked: true as const },
  busy: false,
  onJoin: vi.fn(),
  onSwitch: vi.fn(),
  onLeave: vi.fn(),
  onUpgrade: vi.fn(),
  ...overrides,
})

const show = (overrides: Record<string, unknown> = {}) =>
  render(createElement(LeaguePageView, props(overrides) as Parameters<typeof LeaguePageView>[0]))

describe('LeaguePageView', () => {
  test('dark: says leagues are not available, and nothing else', () => {
    show({ standings: { enabled: false } })
    expect(screen.getByText('Leagues aren’t available yet.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Standings' })).toBeNull()
    cleanup()
    show({ mine: { enabled: false } })
    expect(screen.getByText('Leagues aren’t available yet.')).toBeTruthy()
  })

  test('unknown slug: says so and links to all leagues', () => {
    show({ standings: { enabled: true, view: null } })
    expect(screen.getByText('That league doesn’t exist.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See all leagues' }).getAttribute('href')).toBe('/leagues')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Leagues')
  })

  test('a non-member gets the opener picker and no switch or leave', () => {
    const onJoin = vi.fn()
    show({ onJoin })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Starting Words')
    const picker = screen.getByRole('group', { name: 'Pick your opener' })
    fireEvent.click(within(picker).getByRole('button', { name: 'SLATE' }))
    expect(onJoin).toHaveBeenCalledWith('g1')
    expect(screen.queryByRole('group', { name: 'Switch group' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Leave league' })).toBeNull()
    expect(screen.queryByTestId('league-membership')).toBeNull()
  })

  test('a member sees their group, the switch picker and leave', () => {
    const onLeave = vi.fn()
    const onSwitch = vi.fn()
    show({ mine: { enabled: true, leagues: [crane] }, onLeave, onSwitch })
    expect(screen.getByTestId('league-membership').textContent).toBe('You play for CRANE')
    expect(screen.queryByRole('group', { name: 'Pick your opener' })).toBeNull()
    const picker = screen.getByRole('group', { name: 'Switch group' })
    expect(within(picker).getByRole('button', { name: 'CRANE' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(picker).getByRole('button', { name: 'SLATE' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(picker).getByRole('button', { name: 'ADIEU' }))
    expect(onSwitch).toHaveBeenCalledWith('g2')
    fireEvent.click(screen.getByRole('button', { name: 'Leave league' }))
    expect(onLeave).toHaveBeenCalledWith(crane)
    expect(screen.getByTestId('standing-CRANE').textContent).toContain('you')
  })

  test('a pending switch is named, and its group is the pressed one', () => {
    show({ mine: { enabled: true, leagues: [switching] } })
    expect(screen.getByTestId('league-membership').textContent).toBe('You play for CRANE · switching to SLATE on November 1')
    const picker = screen.getByRole('group', { name: 'Switch group' })
    expect(within(picker).getByRole('button', { name: 'SLATE' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(picker).getByRole('button', { name: 'CRANE' }).getAttribute('aria-pressed')).toBe('false')
  })

  test('a membership of ANOTHER league is not this one', () => {
    show({ mine: { enabled: true, leagues: [{ ...crane, league: { slug: 'other', name: 'Other' } }] } })
    expect(screen.getByRole('group', { name: 'Pick your opener' })).toBeTruthy()
  })

  test('the contribution row renders only for members', () => {
    const onUpgrade = vi.fn()
    show({ onUpgrade })
    expect(screen.queryByRole('button', { name: 'See how much you move CRANE' })).toBeNull()
    cleanup()
    show({ mine: { enabled: true, leagues: [crane] }, onUpgrade })
    fireEvent.click(screen.getByRole('button', { name: 'See how much you move CRANE' }))
    expect(onUpgrade).toHaveBeenCalled()
    cleanup()
    show({ mine: { enabled: true, leagues: [crane] }, contribution: undefined })
    expect(screen.queryByRole('button', { name: 'See how much you move CRANE' })).toBeNull()
  })

  test('busy disables every control', () => {
    show({ mine: { enabled: true, leagues: [crane] }, busy: true })
    expect((screen.getByRole('button', { name: 'Leave league' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'SLATE' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('membershipIn', () => {
  test('finds this league only, and nothing while loading or dark', () => {
    expect(membershipIn(undefined, 'starting-words')).toBeNull()
    expect(membershipIn({ enabled: false }, 'starting-words')).toBeNull()
    expect(membershipIn({ enabled: true, leagues: [crane] }, 'other')).toBeNull()
    expect(membershipIn({ enabled: true, leagues: [crane] }, 'starting-words')).toBe(crane)
  })
})

describe('leaveMessage', () => {
  test('a counted membership: same group tomorrow, another from the 1st', () => {
    expect(leaveMessage('CRANE', '2026-10-02', '2026-10-15')).toBe(
      'You left CRANE. Rejoin CRANE from tomorrow, or join another group from November 1.',
    )
  })
  test('December rolls into January', () => {
    expect(leaveMessage('CRANE', '2026-12-02', '2026-12-31')).toBe(
      'You left CRANE. Rejoin CRANE from tomorrow, or join another group from January 1.',
    )
  })
  test('a membership that had not started counted nothing', () => {
    expect(leaveMessage('CRANE', '2026-10-16', '2026-10-15')).toBe('You left CRANE before any of your boards counted for it.')
  })
})
