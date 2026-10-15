// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { ClueLadderCard } from './card.tsx'

afterEach(cleanup)

const renderLink = (children: ReactNode) => createElement('a', { href: '/play' }, children)

describe('ClueLadderCard', () => {
  test.each([
    [{ status: 'not-started' as const }, 'Play', 'Five shapes, one order. Fewer clues, more points.', 'bg-primary'],
    [{ status: 'playing' as const, cluesRevealed: 2 }, 'Continue', 'Clue 2', 'bg-primary'],
    [{ status: 'solved' as const, lockedAtClue: 3 }, 'See the explanation', 'Solved on clue 3', 'bg-secondary'],
    [{ status: 'failed' as const }, 'See the explanation', 'X', 'bg-secondary'],
  ])('%o shows %s', (play, name, text, tone) => {
    render(createElement(ClueLadderCard, { play, renderLink }))
    expect(screen.getByText(text)).toBeTruthy()
    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(screen.getByRole('link', { name }).getAttribute('href')).toBe('/play')
    expect(links[0].className).toContain(tone)
  })

  test('the X line reads "X: not solved" to a screen reader', () => {
    render(createElement(ClueLadderCard, { play: { status: 'failed' }, renderLink }))
    const x = screen.getByText('X')
    expect(x.closest('p')?.textContent).toBe('X: not solved')
    expect(screen.getByText(': not solved').className).toContain('sr-only')
  })

  test('is a labelled region', () => {
    render(createElement(ClueLadderCard, { play: { status: 'not-started' }, renderLink }))
    expect(screen.getByRole('region', { name: "Today's clue ladder" })).toBeTruthy()
  })
})
