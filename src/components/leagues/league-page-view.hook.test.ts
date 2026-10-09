// @vitest-environment jsdom
//
// The /leagues/$slug page's logic, rendered without a router or a backend: the
// route owns only queries, mutations and toasts, so everything a viewer sees
// per state is decided here.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  large: false as const,
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
  today: '2026-10-07',
  standings: { enabled: true as const, view },
  mine: { enabled: true as const, leagues: [] as (typeof crane)[] },
  contribution: { enabled: true as const, locked: true as const },
  busy: false,
  onJoin: vi.fn(),
  onSwitch: vi.fn(),
  onLeave: vi.fn(),
  onJoinWord: vi.fn(),
  onSwitchWord: vi.fn(),
  find: { onFind: vi.fn(), result: null },
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
    expect(screen.getByRole('heading', { name: 'Join the opener wars' })).toBeTruthy()
    expect(screen.getByText('Pick a side — your boards count whatever word you start with.')).toBeTruthy()
    const picker = screen.getByRole('group', { name: 'Choose a group' })
    fireEvent.click(within(picker).getByRole('button', { name: 'SLATE' }))
    expect(onJoin).toHaveBeenCalledWith('g1')
    expect(screen.queryByRole('group', { name: 'Switch group' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Leave league' })).toBeNull()
    expect(screen.queryByTestId('league-membership')).toBeNull()
    // A fixed league keeps its group buttons: no word box, no search.
    expect(screen.queryByLabelText('Any Wordle answer word')).toBeNull()
    expect(screen.queryByRole('search')).toBeNull()
  })

  test('the join note never promises "tomorrow" alone: a join opens on the 1st after another group this month', () => {
    show()
    expect(screen.getByText('Your boards count from tomorrow, or from the 1st if you were in another group this month.')).toBeTruthy()
    expect(screen.queryByText('Your boards count for your group from tomorrow.')).toBeNull()
  })

  test('a membership that has not started yet names its start day', () => {
    show({ mine: { enabled: true, leagues: [{ ...crane, since: '2026-10-08' }] } })
    expect(screen.getByTestId('league-membership').textContent).toBe('You play for CRANE from October 8')
    cleanup()
    show({ today: '2026-10-31', mine: { enabled: true, leagues: [{ ...crane, since: '2026-11-01' }] } })
    expect(screen.getByTestId('league-membership').textContent).toBe('You play for CRANE from November 1')
  })

  test('a membership that starts today has started: no start day', () => {
    show({ today: '2026-10-08', mine: { enabled: true, leagues: [{ ...crane, since: '2026-10-08' }] } })
    expect(screen.getByTestId('league-membership').textContent).toBe('You play for CRANE')
  })

  test('a member sees their group, the switch picker and leave', () => {
    const onLeave = vi.fn()
    const onSwitch = vi.fn()
    show({ mine: { enabled: true, leagues: [crane] }, onLeave, onSwitch })
    expect(screen.getByTestId('league-membership').textContent).toBe('You play for CRANE')
    expect(screen.queryByRole('group', { name: 'Choose a group' })).toBeNull()
    const picker = screen.getByRole('group', { name: 'Switch group' })
    expect(within(picker).getByRole('button', { name: 'CRANE' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(picker).getByRole('button', { name: 'SLATE' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(picker).getByRole('button', { name: 'ADIEU' }))
    expect(onSwitch).toHaveBeenCalledWith('g2')
    fireEvent.click(screen.getByRole('button', { name: 'Leave league' }))
    expect(onLeave).toHaveBeenCalledWith(crane)
    expect(screen.getByTestId('standing-CRANE').textContent).toContain('you')
  })

  test('the switch note matches the state: a not-yet-started membership is changed in place, until it starts', () => {
    // Owner hand test 2026-10-08: joined today (starts tomorrow), a switch
    // retargets the membership at once, so "takes effect on the 1st" was false.
    show({ mine: { enabled: true, leagues: [{ ...crane, since: '2026-10-08' }] } })
    expect(screen.getByText('Changes apply at once until it starts on October 8.')).toBeTruthy()
    expect(screen.queryByText('A switch takes effect on the 1st.')).toBeNull()
    cleanup()
    show({ today: '2026-10-31', mine: { enabled: true, leagues: [{ ...crane, since: '2026-11-01' }] } })
    expect(screen.getByText('Changes apply at once until it starts on November 1.')).toBeTruthy()
  })

  test('the switch note for a started membership: a switch takes effect on the 1st', () => {
    show({ mine: { enabled: true, leagues: [crane] } })
    expect(screen.getByText('A switch takes effect on the 1st.')).toBeTruthy()
    expect(screen.queryByText(/Changes apply at once until/)).toBeNull()
    cleanup()
    // Starting TODAY has started.
    show({ today: '2026-10-08', mine: { enabled: true, leagues: [{ ...crane, since: '2026-10-08' }] } })
    expect(screen.getByText('A switch takes effect on the 1st.')).toBeTruthy()
  })

  test('Leave is an outlined button, not plain-looking ghost text', () => {
    // The -insights.hook.test.ts className idiom; border-input is the outline
    // variant's border (components/ui/button.tsx), absent from ghost.
    show({ mine: { enabled: true, leagues: [crane] } })
    expect(screen.getByRole('button', { name: 'Leave league' }).className).toContain('border-input')
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
    expect(screen.getByRole('group', { name: 'Choose a group' })).toBeTruthy()
  })

  test('the contribution row renders only for members', () => {
    const onUpgrade = vi.fn()
    show({ onUpgrade })
    expect(screen.queryByRole('button', { name: 'See how much you move CRANE' })).toBeNull()
    cleanup()
    show({ mine: { enabled: true, leagues: [crane] }, onUpgrade })
    fireEvent.click(screen.getByRole('button', { name: 'See how much you move CRANE' }))
    expect(onUpgrade).toHaveBeenCalledWith('leagues')
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

/**
 * A word league (`large`) gets the open-word picker, the sliced table,
 * "Find a group" and at most one upgrade nudge (spec v2 §4.5, §4.6, §5).
 */
describe('LeaguePageView for a large league', () => {
  const popular = [
    { _id: 'g0', slug: 'crane', name: 'CRANE', memberCount: 5 },
    { _id: 'g1', slug: 'slate', name: 'SLATE', memberCount: 4 },
  ]
  const shown = [
    { groupId: 'g0', rank: 1, average: 3.8, boards: 142, contributors: 9 },
    { groupId: 'g1', rank: 2, average: 4.1, boards: 96, contributors: 6 },
  ]
  const largeView = {
    large: true as const,
    groupSource: 'answer-words' as const,
    leagueId: 'l1',
    pickable: null,
    league: { slug: 'starting-words', name: 'Starting Words' },
    month: '2026-10',
    groups: [
      { _id: 'g0', slug: 'crane', name: 'CRANE', memberCount: 5 },
      { _id: 'g1', slug: 'slate', name: 'SLATE', memberCount: 4 },
    ],
    popular,
    shown,
    viewer: null,
    unrankedCount: 2,
    standings: shown,
    lastMonth: null,
    monthsWon: [],
  }
  const slate = { ...crane, group: { _id: 'g1', name: 'SLATE' } }
  const pious = { ...crane, group: { _id: 'g9', name: 'PIOUS' } }
  const showLarge = (viewOverrides: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) =>
    show({ standings: { enabled: true, view: { ...largeView, ...viewOverrides } }, ...overrides })

  test('a non-member gets the word picker: popular quick picks and any answer word, joined by word', () => {
    const onJoinWord = vi.fn()
    const onJoin = vi.fn()
    showLarge({}, { onJoinWord, onJoin })
    expect(screen.getByRole('heading', { name: 'Join the opener wars' })).toBeTruthy()
    expect(screen.getByLabelText('Any Wordle answer word')).toBeTruthy()
    const picker = screen.getByRole('group', { name: 'Choose a group' })
    fireEvent.click(within(picker).getByRole('button', { name: 'SLATE' }))
    expect(onJoinWord).toHaveBeenCalledWith('l1', 'slate')
    expect(onJoin).not.toHaveBeenCalled()
  })

  test('the word box submits as Join for a non-member and Switch for a member', () => {
    showLarge({})
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
    cleanup()
    showLarge({}, { mine: { enabled: true, leagues: [slate] } })
    expect(screen.getByRole('button', { name: 'Switch' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
  })

  test('a member switches by word, with their group pressed', () => {
    const onSwitchWord = vi.fn()
    const onSwitch = vi.fn()
    showLarge({}, { mine: { enabled: true, leagues: [slate] }, onSwitchWord, onSwitch })
    const picker = screen.getByRole('group', { name: 'Switch group' })
    expect(within(picker).getByRole('button', { name: 'SLATE' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(picker).getByRole('button', { name: 'CRANE' }))
    expect(onSwitchWord).toHaveBeenCalledWith('l1', 'crane')
    expect(onSwitch).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Any Wordle answer word')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Leave league' })).toBeTruthy()
  })

  test("the viewer's row is appended after the shown rows, with the unranked count", () => {
    const viewer = { groupId: 'g9', rank: 14, average: 4.6, boards: 20, contributors: 2 }
    showLarge(
      { viewer, standings: [...shown, viewer], groups: [...largeView.groups, { _id: 'g9', slug: 'pious', name: 'PIOUS', memberCount: 1 }] },
      { mine: { enabled: true, leagues: [pious] } },
    )
    const rows = screen.getAllByRole('listitem').map((li) => li.getAttribute('data-testid'))
    expect(rows.filter((r) => r?.startsWith('standing-'))).toEqual(['standing-CRANE', 'standing-SLATE', 'standing-PIOUS'])
    expect(screen.getByTestId('standing-PIOUS').getAttribute('aria-current')).toBe('true')
    expect(screen.getByText('2 more groups not ranked yet')).toBeTruthy()
  })

  test('Find a group goes through onFind and renders the route’s result', () => {
    const onFind = vi.fn()
    showLarge({}, { find: { onFind, result: { word: 'slate', standing: { group: { name: 'SLATE' }, boards: 0, average: null } } } })
    const search = screen.getByRole('search', { name: 'Find a group' })
    fireEvent.change(within(search).getByLabelText('Find a group'), { target: { value: 'crane' } })
    fireEvent.click(within(search).getByRole('button', { name: 'Find' }))
    expect(onFind).toHaveBeenCalledWith('crane')
    expect(screen.getByTestId('league-find-result').textContent).toBe('No one plays for SLATE this month')
  })

  test('a locked member behind the leader gets the behind nudge, opening the upgrade with its origin', () => {
    const onUpgrade = vi.fn()
    showLarge({}, { mine: { enabled: true, leagues: [slate] }, onUpgrade })
    const nudge = screen.getByTestId('league-nudge')
    expect(nudge.textContent).toContain('SLATE is 0.3 guesses off the lead — see where you lose guesses.')
    fireEvent.click(within(nudge).getByRole('button', { name: 'Upgrade' }))
    expect(onUpgrade).toHaveBeenCalledWith('leagues-behind')
  })

  test('no nudge for an unlocked (Pro or trial) member, while the contribution loads, or for a non-member', () => {
    showLarge({}, { mine: { enabled: true, leagues: [slate] }, contribution: { enabled: true, locked: false, contribution: null } })
    expect(screen.queryByTestId('league-nudge')).toBeNull()
    cleanup()
    showLarge({}, { mine: { enabled: true, leagues: [slate] }, contribution: undefined })
    expect(screen.queryByTestId('league-nudge')).toBeNull()
    cleanup()
    showLarge()
    expect(screen.queryByTestId('league-nudge')).toBeNull()
  })

  test('the leader gets no behind nudge, but a closed month below 1st gets the result nudge', () => {
    const onUpgrade = vi.fn()
    showLarge({}, { mine: { enabled: true, leagues: [crane] } })
    expect(screen.queryByTestId('league-nudge')).toBeNull()
    cleanup()
    showLarge({ lastMonth: { month: '2026-09', winnerGroupId: 'g1', viewerRank: 3 } }, { mine: { enabled: true, leagues: [crane] }, onUpgrade })
    const nudge = screen.getByTestId('league-nudge')
    expect(nudge.textContent).toContain('CRANE finished 3rd in September — see where your own guesses go.')
    fireEvent.click(within(nudge).getByRole('button', { name: 'Upgrade' }))
    expect(onUpgrade).toHaveBeenCalledWith('league-result')
  })

  test('a small fixed league gets the behind nudge too, and no result nudge (it has no viewer rank)', () => {
    const onUpgrade = vi.fn()
    show({ mine: { enabled: true, leagues: [{ ...crane, group: { _id: 'g1', name: 'SLATE' } }] }, onUpgrade })
    const nudge = screen.getByTestId('league-nudge')
    expect(nudge.textContent).toContain('SLATE is 0.1 guesses off the lead — see where you lose guesses.')
    fireEvent.click(within(nudge).getByRole('button', { name: 'Upgrade' }))
    expect(onUpgrade).toHaveBeenCalledWith('leagues-behind')
    cleanup()
    // The leader, after a closed month: the small shape cannot say where it finished.
    show({ standings: { enabled: true, view: { ...view, lastMonth: { month: '2026-09', winnerGroupId: 'g1' } } }, mine: { enabled: true, leagues: [crane] } })
    expect(screen.queryByTestId('league-nudge')).toBeNull()
    cleanup()
    // Unlocked on a fixed league: still never.
    show({ mine: { enabled: true, leagues: [{ ...crane, group: { _id: 'g1', name: 'SLATE' } }] }, contribution: { enabled: true, locked: false, contribution: null } })
    expect(screen.queryByTestId('league-nudge')).toBeNull()
  })

  test('a large FIXED league (7 groups) picks by group over every group, never by word', async () => {
    const seven = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG'].map((name, i) => ({ _id: `f${i}`, slug: name.toLowerCase(), name, memberCount: i }))
    const onJoin = vi.fn()
    const onJoinWord = vi.fn()
    showLarge({ groupSource: 'fixed', pickable: seven, popular: seven.slice(0, 6), groups: seven.slice(0, 1) }, { onJoin, onJoinWord })
    expect(screen.queryByLabelText('Any Wordle answer word')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pick a group' }))
    const sheet = await screen.findByRole('dialog')
    for (const g of seven) expect(within(sheet).getByRole('button', { name: g.name })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'GG' }))
    expect(onJoin).toHaveBeenCalledWith('f6')
    expect(onJoinWord).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
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
