// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ClueLadderCard } from './card.tsx'

afterEach(cleanup)

describe('ClueLadderCard', () => {
  test.each([
    [{ status: 'not-started' as const }, 'Play', 'Five shapes, one order. Fewer clues, more points.'],
    [{ status: 'playing' as const, cluesRevealed: 2 }, 'Continue', 'Clue 2'],
    [{ status: 'solved' as const, lockedAtClue: 3 }, 'See the explanation', 'Solved on clue 3'],
    [{ status: 'failed' as const }, 'See the explanation', 'X'],
  ])('%o shows %s', (play, button, text) => {
    const onOpen = vi.fn()
    render(createElement(ClueLadderCard, { play, onOpen }))
    expect(screen.getByText(text)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: button }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('is a labelled region', () => {
    render(createElement(ClueLadderCard, { play: { status: 'not-started' }, onOpen: vi.fn() }))
    expect(screen.getByRole('region', { name: "Today's clue ladder" })).toBeTruthy()
  })
})
