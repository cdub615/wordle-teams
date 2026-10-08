// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GroupPicker } from './group-picker.tsx'

afterEach(cleanup)

const groups = (names: string[]) => names.map((name, i) => ({ _id: `g${i}`, name, memberCount: i }))
const names = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? accessibleName(b))
const accessibleName = (b: HTMLElement) => {
  const clone = b.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[aria-hidden="true"], .sr-only').forEach((n) => n.remove())
  return clone.textContent
}
const FIVE = groups(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])

describe('GroupPicker', () => {
  test('inline buttons at or below PICKER_INLINE_MAX, and a tap picks', () => {
    const onPick = vi.fn()
    render(createElement(GroupPicker, { groups: FIVE, currentGroupId: null, onPick }))
    expect(names()).toEqual(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])
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
    expect(names()).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })
  test('above the cap, a single sheet trigger instead of inline buttons', () => {
    render(createElement(GroupPicker, { groups: groups(['A', 'B', 'C', 'D', 'E', 'F', 'G']), currentGroupId: null, onPick: vi.fn() }))
    expect(names()).toEqual(['Pick a group'])
  })
  test('disabled disables every choice', () => {
    render(createElement(GroupPicker, { groups: FIVE, currentGroupId: null, onPick: vi.fn(), disabled: true }))
    expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })

  test('each choice shows its member count, keeps its name, and describes it for assistive tech', () => {
    render(createElement(GroupPicker, { groups: FIVE, currentGroupId: null, onPick: vi.fn() }))
    const slate = screen.getByRole('button', { name: 'SLATE' })
    expect(slate.textContent).toContain('1')
    const described = document.getElementById(slate.getAttribute('aria-describedby') ?? '')
    expect(described?.textContent).toBe('1 member')
    expect(document.getElementById(screen.getByRole('button', { name: 'ADIEU' }).getAttribute('aria-describedby') ?? '')?.textContent).toBe('2 members')
    expect(screen.getByRole('group', { name: 'League groups' })).not.toBeNull()
  })
  test('sheet mode: search filters, a pick calls back and closes, and search resets', async () => {
    const onPick = vi.fn()
    render(createElement(GroupPicker, { groups: groups(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE', 'RAISE', 'ARISE']), currentGroupId: null, onPick }))
    fireEvent.click(screen.getByRole('button', { name: 'Pick a group' }))
    const box = await screen.findByRole('textbox', { name: 'Search groups' })
    fireEvent.change(box, { target: { value: 'cr' } })
    expect(screen.getByRole('button', { name: 'CRANE' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'SLATE' })).toBeNull()
    fireEvent.change(box, { target: { value: 'zzz' } })
    expect(screen.getByText('No group matches')).not.toBeNull()
    fireEvent.change(box, { target: { value: 'cr' } })
    fireEvent.click(screen.getByRole('button', { name: 'CRANE' }))
    expect(onPick).toHaveBeenCalledWith('g0')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Pick a group' }))
    expect(((await screen.findByRole('textbox', { name: 'Search groups' })) as HTMLInputElement).value).toBe('')
  })
})
