// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GroupPicker } from './group-picker.tsx'

afterEach(cleanup)

const groups = (names: string[]) => names.map((name, i) => ({ _id: `g${i}`, name, memberCount: i }))
const FIVE = groups(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])

describe('GroupPicker', () => {
  test('inline buttons at or below PICKER_INLINE_MAX, and a tap picks', () => {
    const onPick = vi.fn()
    render(createElement(GroupPicker, { groups: FIVE, currentGroupId: null, onPick }))
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])
    fireEvent.click(screen.getByRole('button', { name: 'SLATE' }))
    expect(onPick).toHaveBeenCalledWith('g1')
  })
  test('the current group is pressed', () => {
    render(createElement(GroupPicker, { groups: FIVE, currentGroupId: 'g2', onPick: vi.fn() }))
    expect(screen.getByRole('button', { name: 'ADIEU' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'CRANE' }).getAttribute('aria-pressed')).toBe('false')
  })
  test('exactly PICKER_INLINE_MAX groups are still inline', () => {
    render(createElement(GroupPicker, { groups: groups(['A', 'B', 'C', 'D', 'E', 'F']), currentGroupId: null, onPick: vi.fn() }))
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })
  test('above the cap, a single sheet trigger instead of inline buttons', () => {
    render(createElement(GroupPicker, { groups: groups(['A', 'B', 'C', 'D', 'E', 'F', 'G']), currentGroupId: null, onPick: vi.fn() }))
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Pick a group'])
  })
  test('disabled disables every choice', () => {
    render(createElement(GroupPicker, { groups: FIVE, currentGroupId: null, onPick: vi.fn(), disabled: true }))
    expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })
})
