// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { AttemptDistribution } from './attempt-distribution.tsx'

afterEach(cleanup)

const rows = [
  { label: '1' as const, count: 0, isModal: false },
  { label: '2' as const, count: 7, isModal: false },
  { label: '3' as const, count: 62, isModal: false },
  { label: '4' as const, count: 104, isModal: true },
  { label: '5' as const, count: 81, isModal: false },
  { label: '6' as const, count: 46, isModal: false },
  { label: 'X' as const, count: 7, isModal: false },
]

describe('AttemptDistribution', () => {
  test('it is a list, so a screen reader gets the numbers rather than a shrug', () => {
    render(createElement(AttemptDistribution, { rows }))
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  test('every row renders, including the empty one', () => {
    render(createElement(AttemptDistribution, { rows }))
    expect(screen.getByTestId('insights-distribution-1').textContent).toContain('0')
  })

  test('only the modal row takes the accent', () => {
    render(createElement(AttemptDistribution, { rows }))
    expect(screen.getByTestId('insights-distribution-4-fill').className).toContain('bg-accent-solid')
    expect(screen.getByTestId('insights-distribution-3-fill').className).toContain('bg-muted')
  })

  test('bars are scaled against the largest row, not the total', () => {
    render(createElement(AttemptDistribution, { rows }))
    expect(screen.getByTestId('insights-distribution-4-fill').style.width).toBe('100%')
    expect(screen.getByTestId('insights-distribution-2-fill').style.width).toBe('7%')
  })
})
