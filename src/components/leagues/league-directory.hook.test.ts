// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params?: { slug: string }; children: unknown }) =>
    createElement('a', { href: params ? to.replace('$slug', params.slug) : to, ...rest }, children as never),
}))

import { LeagueDirectory } from './league-directory.tsx'

afterEach(cleanup)

const league = (slug: string, name: string, disclaimer?: string) => ({ slug, name, disclaimer })
const row = (slug: string, rank: number | null) => ({
  kind: 'picked' as const,
  league: { slug, name: slug },
  group: { _id: 'g0', name: 'CRANE' },
  rank,
  average: rank ? 3.84 : null,
})
const dir = (props: Partial<Parameters<typeof LeagueDirectory>[0]> = {}) =>
  render(
    createElement(LeagueDirectory, {
      leagues: [league('a', 'Alpha'), league('b', 'Beta')],
      mine: [row('a', 2)],
      region: null,
      ...props,
    }),
  )

describe('LeagueDirectory', () => {
  test('renders "Your leagues" and "Join a league" sections', () => {
    dir()
    expect(screen.getByRole('heading', { name: 'Your leagues' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Join a league' })).toBeTruthy()
  })
  test('your row shows group, rank and average, and links to its league', () => {
    dir()
    const mine = within(screen.getByRole('region', { name: 'Your leagues' }))
    expect(mine.getByText('CRANE')).toBeTruthy()
    expect(mine.getByText('#2 · 3.8')).toBeTruthy()
    expect(mine.getByRole('link').getAttribute('href')).toBe('/leagues/a')
  })
  test('the row link is named by its visible text (no aria-label to drift from it)', () => {
    dir()
    const link = within(screen.getByRole('region', { name: 'Your leagues' })).getByRole('link')
    expect(link.hasAttribute('aria-label')).toBe(false)
    expect(link.textContent).toContain('CRANE')
    expect(link.textContent).toContain('#2 · 3.8')
  })
  test('an unranked membership says "not yet ranked"', () => {
    dir({ mine: [row('a', null)] })
    expect(screen.getByText('not yet ranked')).toBeTruthy()
  })
  test('a league you are in is not repeated under "Join a league"', () => {
    dir()
    const join = within(screen.getByRole('region', { name: 'Join a league' }))
    expect(join.getByText('Beta')).toBeTruthy()
    expect(join.queryByText('Alpha')).toBeNull()
  })
  test('a disclaimer renders when present, and only then', () => {
    dir({ leagues: [league('a', 'Alpha'), league('b', 'Beta', 'Not affiliated.'), league('c', 'Gamma')] })
    expect(screen.getAllByText('Not affiliated.')).toHaveLength(1)
  })
  test('with no memberships there is no "Your leagues" section', () => {
    dir({ mine: [] })
    expect(screen.queryByRole('heading', { name: 'Your leagues' })).toBeNull()
  })
  test('when every league is joined there is no "Join a league" section', () => {
    dir({ mine: [row('a', 1), row('b', 1)] })
    expect(screen.queryByRole('heading', { name: 'Join a league' })).toBeNull()
  })

  describe('region status', () => {
    const lg = { leagueId: 'L', slug: 'region', name: 'Region' }
    const leagues = [league('words', 'Starting Words', 'Not affiliated.'), league('region', 'Region')]
    const placed = { state: 'placed' as const, league: lg, group: { _id: 'g1', name: 'Pacific' }, countsFrom: '2026-10-09', next: null }
    const lines = {
      'opted-out': 'You left — rejoin from its page.',
      'no-time-zone': 'Set your time zone to join your region.',
      unmapped: 'Your time zone isn’t part of a region yet.',
    }
    const unplaced = {
      'opted-out': { state: 'opted-out' as const, league: lg },
      'no-time-zone': { state: 'no-time-zone' as const, league: lg },
      unmapped: { state: 'unmapped' as const, timeZone: 'Mars/Base', league: lg },
    }
    const join = () => within(screen.getByRole('region', { name: 'Join a league' }))

    test.each(Object.keys(lines) as (keyof typeof lines)[])('%s shows its line under Join a league, on the region card', (k) => {
      dir({ leagues, mine: [], region: unplaced[k] })
      const card = join().getByText('Region').closest('a')!
      expect(within(card).getByText(lines[k])).toBeTruthy()
      expect(card.getAttribute('href')).toBe('/leagues/region')
      expect(screen.getAllByText(lines[k])).toHaveLength(1)
    })
    test('a placed region appears under Your leagues only, with no status line', () => {
      dir({
        leagues,
        mine: [{ ...row('region', 1), kind: 'region' as never }],
        region: placed,
      })
      expect(within(screen.getByRole('region', { name: 'Your leagues' })).getByRole('link', { name: /region/ })).toBeTruthy()
      expect(join().queryByText('Region')).toBeNull()
      for (const t of Object.values(lines)) expect(screen.queryByText(t)).toBeNull()
    })
    test('region: null (not seeded) shows no status text', () => {
      dir({ leagues, mine: [], region: null })
      for (const t of Object.values(lines)) expect(screen.queryByText(t)).toBeNull()
    })
    test('the Starting Words card is unchanged by an unplaced region', () => {
      dir({ leagues, mine: [], region: unplaced['opted-out'] })
      const card = join().getByText('Starting Words').closest('a')!
      expect(card.textContent).toBe('Starting WordsNot affiliated.')
    })
  })
})
