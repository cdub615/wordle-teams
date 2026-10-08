// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params?: { slug: string }; children: unknown }) =>
    createElement('a', { href: params ? to.replace('$slug', params.slug) : to, ...rest }, children as never),
}))

import { LeaguesCard, leaguesCardInput } from './leagues-card.tsx'

afterEach(cleanup)

const featured = {
  slug: 'starting-words',
  name: 'Starting Words',
  featured: true,
  groups: ['CRANE', 'SLATE'].map((name, i) => ({ _id: `g${i}`, name, memberCount: 0 })),
}
const row = (slug: string, rank: number | null) => ({
  league: { slug, name: slug },
  leagueId: slug,
  group: { _id: 'g0', name: 'CRANE' },
  since: '2026-10-01',
  pending: null,
  rank,
  average: rank ? 3.8 : null,
  boards: 12,
})

describe('LeaguesCard', () => {
  test('not in a league: offers the featured league inline', () => {
    const onJoin = vi.fn()
    render(createElement(LeaguesCard, { mine: [], featured, onJoin, busy: false }))
    expect(screen.getByRole('heading', { name: 'Pick your opener' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Pick your opener' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'SLATE' }))
    expect(onJoin).toHaveBeenCalledWith('g1')
  })
  test('busy disables the picker', () => {
    render(createElement(LeaguesCard, { mine: [], featured, onJoin: vi.fn(), busy: true }))
    expect((screen.getByRole('button', { name: 'SLATE' }) as HTMLButtonElement).disabled).toBe(true)
  })
  test('in a league: one row with rank and average, linking to the league', () => {
    render(createElement(LeaguesCard, { mine: [row('starting-words', 1)], featured, onJoin: vi.fn(), busy: false }))
    const link = screen.getByRole('link', { name: /CRANE/ })
    expect(link.getAttribute('href')).toBe('/leagues/starting-words')
    expect(link.textContent).toContain('#1')
    expect(link.textContent).toContain('3.8')
    expect(screen.queryByRole('button', { name: 'SLATE' })).toBeNull()
  })
  test('an unranked group says so rather than showing a number', () => {
    render(createElement(LeaguesCard, { mine: [row('starting-words', null)], featured, onJoin: vi.fn(), busy: false }))
    expect(screen.getByRole('link', { name: /CRANE/ }).textContent).toContain('not yet ranked')
  })
  test('caps at HOME_CARD_MAX_LEAGUES with See all', () => {
    render(createElement(LeaguesCard, { mine: ['a', 'b', 'c', 'd'].map((s) => row(s, null)), featured, onJoin: vi.fn(), busy: false }))
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toContain('See all')
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })
  test('a member is shown their league even with no featured league', () => {
    render(createElement(LeaguesCard, { mine: [row('starting-words', 2)], featured: null, onJoin: vi.fn(), busy: false }))
    expect(screen.getByRole('link', { name: /CRANE/ }).textContent).toContain('#2')
  })
  test('nothing at all when there is no featured league and no membership', () => {
    const { container } = render(createElement(LeaguesCard, { mine: [], featured: null, onJoin: vi.fn(), busy: false }))
    expect(container.innerHTML).toBe('')
  })
})

describe('leaguesCardInput', () => {
  const enabled = { enabled: true as const, leagues: [{ ...featured, slug: 'other', featured: false }, featured] }
  const team = { everJoined: false, offerPicker: true }
  const mine = [row('starting-words', 1)]
  test('dark or unanswered myLeagues: nothing', () => {
    expect(leaguesCardInput({ enabled: false }, enabled, team)).toBeNull()
    expect(leaguesCardInput(undefined, enabled, team)).toBeNull()
  })
  test('a member gets their rows and no picker, wherever the card is and whatever the list says', () => {
    for (const offerPicker of [true, false]) {
      expect(leaguesCardInput({ enabled: true, leagues: mine }, undefined, { everJoined: true, offerPicker })).toEqual({ mine, featured: null })
      expect(leaguesCardInput({ enabled: true, leagues: mine }, enabled, { everJoined: true, offerPicker })).toEqual({ mine, featured: null })
    }
  })
  test('a never-joined TEAM player is offered the featured league', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [] }, enabled, team)).toEqual({ mine: [], featured })
  })
  test('a never-joined TEAMLESS player gets no card: onboarding makes the offer', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [] }, enabled, { everJoined: false, offerPicker: false })).toBeNull()
  })
  test('a leaver (ever joined, no current rows) is never re-offered the picker', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [] }, enabled, { everJoined: true, offerPicker: true })).toBeNull()
    expect(leaguesCardInput({ enabled: true, leagues: [] }, enabled, { everJoined: true, offerPicker: false })).toBeNull()
  })
  test('a never-joined team player with a dark, failed or featureless list: nothing', () => {
    expect(leaguesCardInput({ enabled: true, leagues: [] }, { enabled: false }, team)).toBeNull()
    expect(leaguesCardInput({ enabled: true, leagues: [] }, undefined, team)).toBeNull()
    expect(leaguesCardInput({ enabled: true, leagues: [] }, { enabled: true, leagues: [{ ...featured, featured: false }] }, team)).toBeNull()
  })
})
