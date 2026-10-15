// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ClueLadderControls } from './controls.tsx'

// Radix Popover measures its content; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

const base = {
  clues: ['The star is not first.', 'The circle is next to the square.'],
  canRevealMore: true,
  canLockIn: false,
  pending: false,
  onNextClue: vi.fn(),
  onLockIn: vi.fn(),
}

describe('ClueLadderControls', () => {
  test('lists the revealed clues, numbered', () => {
    render(createElement(ClueLadderControls, base))
    const items = screen.getByRole('list', { name: 'Clues' }).querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[1].textContent).toContain('Clue 2')
    expect(items[1].textContent).toContain('The circle is next to the square.')
  })

  test('Next clue reveals one more', () => {
    const onNextClue = vi.fn()
    render(createElement(ClueLadderControls, { ...base, onNextClue }))
    fireEvent.click(screen.getByRole('button', { name: 'Next clue' }))
    expect(onNextClue).toHaveBeenCalledTimes(1)
  })

  test('Next clue is disabled when none remain', () => {
    render(createElement(ClueLadderControls, { ...base, canRevealMore: false }))
    expect((screen.getByRole('button', { name: 'Next clue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('Lock in is disabled until all five slots are filled', () => {
    render(createElement(ClueLadderControls, base))
    expect((screen.getByRole('button', { name: 'Lock in' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('Lock in confirms once, then locks in', () => {
    const onLockIn = vi.fn()
    render(createElement(ClueLadderControls, { ...base, canLockIn: true, onLockIn }))
    fireEvent.click(screen.getByRole('button', { name: 'Lock in' }))
    expect(onLockIn).not.toHaveBeenCalled()
    expect(screen.getByText("One try. If it's wrong, today is an X.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, lock in' }))
    expect(onLockIn).toHaveBeenCalledTimes(1)
  })

  test('Lock in is enabled once all five slots are filled', () => {
    render(createElement(ClueLadderControls, { ...base, canLockIn: true }))
    expect((screen.getByRole('button', { name: 'Lock in' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('the visible clue number is hidden from assistive tech, so it is not read twice', () => {
    render(createElement(ClueLadderControls, base))
    const label = screen.getByText('Clue 1')
    expect(label.getAttribute('aria-hidden')).toBe('true')
  })

  test('the clue list is a polite live region', () => {
    render(createElement(ClueLadderControls, base))
    expect(screen.getByRole('list', { name: 'Clues' }).getAttribute('aria-live')).toBe('polite')
  })

  test('confirming keeps the popover open; pending blocks a second click; a failure allows a retry', () => {
    const onLockIn = vi.fn()
    const props = { ...base, canLockIn: true, onLockIn }
    const { rerender } = render(createElement(ClueLadderControls, props))
    fireEvent.click(screen.getByRole('button', { name: 'Lock in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, lock in' }))
    expect(onLockIn).toHaveBeenCalledTimes(1)
    // Still open, not closed by the click.
    expect(screen.getByText("One try. If it's wrong, today is an X.")).toBeTruthy()

    rerender(createElement(ClueLadderControls, { ...props, pending: true }))
    const confirm = screen.getByRole('button', { name: 'Yes, lock in' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onLockIn).toHaveBeenCalledTimes(1)

    // The mutation failed: pending clears and the popover is still there.
    rerender(createElement(ClueLadderControls, props))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, lock in' }))
    expect(onLockIn).toHaveBeenCalledTimes(2)
  })

  test('pending disables both actions', () => {
    render(createElement(ClueLadderControls, { ...base, canLockIn: true, pending: true }))
    expect((screen.getByRole('button', { name: 'Next clue' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Lock in' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
