// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_SLOTS } from '#/lib/clue-ladder-board.ts'
import { ClueLadderBoard } from './board.tsx'

afterEach(cleanup)

describe('ClueLadderBoard', () => {
  test('tap a tray shape, then a slot, to place it', () => {
    const onChange = vi.fn()
    render(createElement(ClueLadderBoard, { slots: EMPTY_SLOTS, onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'star' }))
    expect(screen.getByRole('button', { name: 'star' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Slot 3, empty' }))
    expect(onChange).toHaveBeenCalledWith([null, null, 'star', null, null])
  })

  test('placing a shape puts it down, so the next tap on a slot is not another placement', () => {
    const onChange = vi.fn()
    render(createElement(ClueLadderBoard, { slots: EMPTY_SLOTS, onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'star' }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 3, empty' }))
    expect(screen.getByRole('button', { name: 'star' }).getAttribute('aria-pressed')).toBe('false')
  })

  test('tapping a slot with nothing selected empties it', () => {
    const onChange = vi.fn()
    render(createElement(ClueLadderBoard, { slots: ['star', null, null, null, null], onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1, star' }))
    expect(onChange).toHaveBeenCalledWith([null, null, null, null, null])
  })

  test('tapping an empty slot with nothing selected does nothing', () => {
    const onChange = vi.fn()
    render(createElement(ClueLadderBoard, { slots: EMPTY_SLOTS, onChange }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1, empty' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  test('the tray holds only unplaced shapes', () => {
    render(createElement(ClueLadderBoard, { slots: ['star', null, null, null, null], onChange: vi.fn() }))
    const tray = screen.getByRole('group', { name: 'Shapes to place' })
    expect(tray.querySelectorAll('button')).toHaveLength(4)
  })

  test('disabled stops every move', () => {
    const onChange = vi.fn()
    render(createElement(ClueLadderBoard, { slots: ['star', null, null, null, null], onChange, disabled: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Slot 1, star' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
