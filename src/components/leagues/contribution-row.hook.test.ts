// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ContributionRow } from './contribution-row.tsx'

afterEach(cleanup)

describe('ContributionRow', () => {
  test('locked: an upgrade button, never a number', () => {
    const onUpgrade = vi.fn()
    render(createElement(ContributionRow, { view: { locked: true }, groupName: 'SLATE', onUpgrade }))
    fireEvent.click(screen.getByRole('button', { name: 'See how much you move SLATE' }))
    expect(onUpgrade).toHaveBeenCalled()
  })
  test('negative shift reads as pulling the average down', () => {
    render(createElement(ContributionRow, { view: { locked: false, contribution: { mine: 3.6, group: 3.9, shift: -0.1 } }, groupName: 'SLATE', onUpgrade: vi.fn() }))
    expect(screen.getByTestId('league-contribution').textContent).toBe("Your 3.6 vs SLATE's 3.9 — you pull SLATE down by 0.1 guesses")
  })
  test('positive shift reads as pushing it up', () => {
    render(createElement(ContributionRow, { view: { locked: false, contribution: { mine: 4.4, group: 4, shift: 0.2 } }, groupName: 'SLATE', onUpgrade: vi.fn() }))
    expect(screen.getByTestId('league-contribution').textContent).toBe("Your 4.4 vs SLATE's 4 — you push SLATE up by 0.2 guesses")
  })
  test('no boards yet', () => {
    render(createElement(ContributionRow, { view: { locked: false, contribution: null }, groupName: 'SLATE', onUpgrade: vi.fn() }))
    expect(screen.getByTestId('league-contribution').textContent).toBe('Play a board to see what you add to SLATE.')
  })
})
