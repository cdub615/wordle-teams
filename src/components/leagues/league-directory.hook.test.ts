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
})
