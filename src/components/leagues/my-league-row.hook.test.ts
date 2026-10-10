// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params?: { slug: string }; children: unknown }) =>
    createElement('a', { href: params ? to.replace('$slug', params.slug) : to, ...rest }, children as never),
}))

import { MyLeagueRow } from './my-league-row.tsx'

afterEach(cleanup)

const base = { league: { slug: 'starting-words', name: 'Starting Words' }, rank: 1, average: 3.8 }

describe('MyLeagueRow group name (phone width, no horizontal scroll)', () => {
  test('a REGION group is plain text, not mono, and truncates', () => {
    render(createElement(MyLeagueRow, { row: { ...base, kind: 'region', league: { slug: 'regions', name: 'Regions' }, group: { _id: 'r', name: 'Latin America & Caribbean' } } }))
    const name = screen.getByText('Latin America & Caribbean')
    expect(name.className).not.toContain('font-mono')
    expect(name.className).not.toContain('tracking-widest')
    expect(name.className).toContain('truncate')
    expect(name.className).toContain('min-w-0')
    // The visible text still names the link in full (WCAG 2.5.3).
    expect(screen.getByRole('link').textContent).toContain('Latin America & Caribbean')
  })
  test('a PICKED word group keeps the mono tile look, and truncates too', () => {
    render(createElement(MyLeagueRow, { row: { ...base, kind: 'picked', group: { _id: 'g', name: 'CRANE' } } }))
    const name = screen.getByText('CRANE')
    expect(name.className).toContain('font-mono')
    expect(name.className).toContain('truncate')
  })
})
