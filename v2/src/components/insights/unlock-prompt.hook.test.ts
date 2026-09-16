// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { UnlockPrompt } from './unlock-prompt.tsx'

afterEach(cleanup)

describe('UnlockPrompt', () => {
  const props = {
    what: 'Your form trend',
    need: 40,
    have: 12,
    unit: 'boards',
    value: 'how your last 30 boards compare with your all-time average',
    testId: 'insights-unlock-form',
  }

  test('it names what unlocks, what it gives, and how far away it is', () => {
    render(createElement(UnlockPrompt, props))
    const node = screen.getByTestId('insights-unlock-form')
    expect(node.textContent).toContain('Your form trend unlocks at 40 boards')
    expect(node.textContent).toContain('how your last 30 boards compare')
    expect(node.textContent).toContain('12 / 40')
  })

  test('it exposes progress to assistive tech as a real progressbar', () => {
    render(createElement(UnlockPrompt, props))
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('12')
    expect(bar.getAttribute('aria-valuemax')).toBe('40')
  })

  test('progress never exceeds full, even if have overshoots need', () => {
    render(createElement(UnlockPrompt, { ...props, have: 99 }))
    expect(screen.getByTestId('insights-unlock-form-fill').style.width).toBe('100%')
  })

  test('the fill asks for play, not money, so it never wears the achievement/upsell accent colour', () => {
    render(createElement(UnlockPrompt, props))
    const fill = screen.getByTestId('insights-unlock-form-fill')
    expect(fill.className).toContain('bg-muted-foreground')
    expect(fill.className).not.toContain('bg-accent-solid')
    expect(fill.className).not.toContain('text-success')
    expect(fill.className).not.toContain('bg-success')
    expect(fill.className).not.toContain('bg-wordle-correct')
  })
})
