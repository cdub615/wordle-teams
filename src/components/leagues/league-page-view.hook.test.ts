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
  kind: 'picked' as const,
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
  region: undefined,
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
    kind: 'picked' as const,
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

  test('"Find a group" only for a word league: a large FIXED league has no search', () => {
    // It searches 5-letter words (decision 5), so it is wrong for any other group source.
    showLarge()
    expect(screen.getByRole('search', { name: 'Find a group' })).toBeTruthy()
    cleanup()
    const seven = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG'].map((name, i) => ({ _id: `f${i}`, slug: name.toLowerCase(), name, memberCount: i }))
    showLarge({ groupSource: 'fixed', pickable: seven, popular: seven.slice(0, 6), groups: seven.slice(0, 1) })
    expect(screen.queryByRole('search')).toBeNull()
    expect(screen.queryByText('Find a group')).toBeNull()
  })
})

/**
 * The region league (v2b): placement is automatic, so the RegionPanel stands
 * in for the membership line, the join section and the switch section. Since
 * B5 myLeagues sends a region row, so without the region branch the page would
 * treat it as a picked membership and offer Switch and Leave league.
 */
describe('LeaguePageView for the region league', () => {
  const regions = ['US Eastern', 'US Central', 'US Mountain', 'US Pacific', 'Alaska', 'Hawaii', 'UK & Ireland', 'Western Europe', 'Eastern Europe', 'India', 'East Asia', 'Australia & Pacific'].map(
    (name, i) => ({ _id: `r${i}`, slug: `r${i}`, name, memberCount: 0 }),
  )
  const shown = [
    { groupId: 'r0', rank: 1, average: 3.7, boards: 400, contributors: 60 },
    { groupId: 'r1', rank: 2, average: 3.9, boards: 300, contributors: 40 },
  ]
  const regionView = {
    large: true as const,
    kind: 'region' as const,
    groupSource: 'fixed' as const,
    leagueId: 'R',
    pickable: regions,
    popular: regions.slice(0, 6),
    league: { slug: 'regions', name: 'Regions' },
    month: '2026-10',
    groups: regions.slice(0, 2),
    shown,
    viewer: null,
    unrankedCount: 0,
    standings: shown,
    lastMonth: null,
    monthsWon: [],
  }
  const regionRow = {
    kind: 'region' as const,
    league: { slug: 'regions', name: 'Regions' },
    leagueId: 'R',
    group: { _id: 'r1', name: 'US Central' },
    since: '2026-10-01',
    pending: null,
  }
  const placed = { state: 'placed' as const, group: { _id: 'r1', name: 'US Central' }, countsFrom: '2026-10-01', next: null }
  const showRegion = (overrides: Record<string, unknown> = {}) =>
    show({
      slug: 'regions',
      standings: { enabled: true, view: regionView },
      mine: { enabled: true, leagues: [regionRow] },
      region: { status: placed, onLeave: vi.fn(), onRejoin: vi.fn() },
      ...overrides,
    })

  test('a placed player gets the panel, and no picker, membership line, switch or Leave league', () => {
    showRegion()
    expect(screen.getByRole('region', { name: 'Your region' })).toBeTruthy()
    expect(screen.getByTestId('region-status').textContent).toBe('You’re in US Central, based on your time zone.')
    expect(screen.queryByTestId('league-membership')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Join the opener wars' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Switch group' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Switch group' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pick a group' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Leave league' })).toBeNull()
    // Standings still mark the viewer's region, from the region row.
    expect(screen.getByTestId('standing-US Central').textContent).toContain('you')
  })

  test('an opted-out player (no region row) gets Rejoin, and no picker to join with', () => {
    const onRejoin = vi.fn()
    showRegion({ mine: { enabled: true, leagues: [] }, region: { status: { state: 'opted-out' }, onLeave: vi.fn(), onRejoin } })
    expect(screen.queryByRole('heading', { name: 'Join the opener wars' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Choose a group' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pick a group' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rejoin' }))
    expect(onRejoin).toHaveBeenCalledTimes(1)
  })

  test('Leave region goes to the region callback, never to onLeave', () => {
    const onLeave = vi.fn()
    const leaveRegion = vi.fn()
    showRegion({ onLeave, region: { status: placed, onLeave: leaveRegion, onRejoin: vi.fn() } })
    fireEvent.click(screen.getByRole('button', { name: 'Leave region' }))
    expect(leaveRegion).toHaveBeenCalledTimes(1)
    expect(onLeave).not.toHaveBeenCalled()
  })

  test('busy reaches the panel', () => {
    showRegion({ busy: true })
    expect((screen.getByRole('button', { name: 'Leave region' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('no "Find a group": regions are not words', () => {
    showRegion()
    expect(screen.queryByRole('search')).toBeNull()
    expect(screen.queryByText('Find a group')).toBeNull()
  })

  test('the contribution row and nudge render as for any league', () => {
    showRegion()
    expect(screen.getByRole('button', { name: 'See how much you move US Central' })).toBeTruthy()
    expect(screen.getByTestId('league-nudge').textContent).toContain('US Central is 0.2 guesses off the lead')
  })

  test('a picked league never renders the region panel', () => {
    show({ region: { status: placed, onLeave: vi.fn(), onRejoin: vi.fn() } })
    expect(screen.queryByRole('region', { name: 'Your region' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Join the opener wars' })).toBeTruthy()
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
