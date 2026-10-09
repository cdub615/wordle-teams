// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WordPicker } from './word-picker.tsx'

afterEach(cleanup)

const POPULAR = ['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE', 'RAISE'].map((name, i) => ({
  _id: `g${i}`,
  slug: name.toLowerCase(),
  name,
  memberCount: 10 - i,
}))

const box = () => screen.getByRole('textbox', { name: 'Any Wordle answer word' }) as HTMLInputElement
const join = () => screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement
const HINT = 'Not a Wordle answer word'

/** Type into the word box; focus first, as a person would, which starts the lazy load. */
const type = (value: string) => {
  fireEvent.focus(box())
  fireEvent.change(box(), { target: { value } })
}

/** The list is lazy-loaded: wait for the import to resolve and Join to enable. */
const joinEnabled = () => waitFor(() => expect(join().disabled).toBe(false))

describe('WordPicker', () => {
  test('a quick pick calls onPick with the word', () => {
    const onPick = vi.fn()
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick }))
    fireEvent.click(screen.getByRole('button', { name: 'CRANE' }))
    expect(onPick).toHaveBeenCalledWith('crane')
  })

  test('a quick pick picks its slug, not its display name', () => {
    const onPick = vi.fn()
    render(createElement(WordPicker, { popular: [{ _id: 'x', slug: 'slate', name: 'Slate!', memberCount: 1 }], currentWord: null, onPick }))
    fireEvent.click(screen.getByRole('button', { name: 'Slate!' }))
    expect(onPick).toHaveBeenCalledWith('slate')
  })

  test('the quick picks are a group labelled "Choose a group" by default, or by label', () => {
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick: vi.fn() }))
    expect(screen.getByRole('group', { name: 'Choose a group' })).not.toBeNull()
    cleanup()
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick: vi.fn(), label: 'Pick your opener' }))
    expect(screen.getByRole('group', { name: 'Pick your opener' })).not.toBeNull()
  })

  test('quick-pick names stay exactly the words, with member counts described', () => {
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick: vi.fn() }))
    const crane = screen.getByRole('button', { name: 'CRANE' })
    expect(document.getElementById(crane.getAttribute('aria-describedby') ?? '')?.textContent).toBe('10 members')
  })

  test('the quick pick matching currentWord is pressed', () => {
    render(createElement(WordPicker, { popular: POPULAR, currentWord: 'slate', onPick: vi.fn() }))
    expect(screen.getByRole('button', { name: 'SLATE' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'CRANE' }).getAttribute('aria-pressed')).toBe('false')
  })

  test('the word box is labelled, keeps a lower-case value, and upper-cases by CSS', () => {
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick: vi.fn() }))
    type('SLa')
    expect(box().value).toBe('sla')
    expect(box().className.split(' ')).toContain('uppercase')
    expect(box().getAttribute('autocapitalize')).toBe('characters')
  })

  test('typing slate and pressing Join calls onPick("slate")', async () => {
    const onPick = vi.fn()
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick }))
    type('slate')
    await joinEnabled()
    fireEvent.click(join())
    expect(onPick).toHaveBeenCalledWith('slate')
  })

  test('the submit button says Join by default and submitLabel when given', () => {
    const { unmount } = render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick: vi.fn() }))
    expect(screen.getByRole('button', { name: 'Join' })).toBeTruthy()
    unmount()
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick: vi.fn(), submitLabel: 'Switch' }))
    expect(screen.getByRole('button', { name: 'Switch' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
  })

  test('Enter (submitting the form) picks a valid word, normalised', async () => {
    const onPick = vi.fn()
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick }))
    type('Ｗｏｒｌｄ')
    await joinEnabled()
    fireEvent.submit(box().form!)
    expect(onPick).toHaveBeenCalledWith('world')
  })

  test('accents fold rather than drop: cráne is CRANE, and valid', async () => {
    const onPick = vi.fn()
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick }))
    type('cráne')
    expect(box().value).toBe('crane')
    await joinEnabled()
    fireEvent.click(join())
    expect(onPick).toHaveBeenCalledWith('crane')
  })

  test('Join stays disabled and no hint shows until the word list has loaded', async () => {
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick: vi.fn() }))
    type('slate')
    // The dynamic import cannot have resolved synchronously.
    expect(join().disabled).toBe(true)
    type('xxxxx')
    expect(screen.queryByText(HINT)).toBeNull()
    await screen.findByText(HINT)
  })

  test('xxxxx shows the hint, leaves Join disabled, and Enter does nothing', async () => {
    const onPick = vi.fn()
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick }))
    type('xxxxx')
    const hint = await screen.findByText(HINT)
    expect(join().disabled).toBe(true)
    expect(box().getAttribute('aria-invalid')).toBe('true')
    expect((box().getAttribute('aria-describedby') ?? '').split(' ')).toContain(hint.id)
    fireEvent.submit(box().form!)
    expect(onPick).not.toHaveBeenCalled()
  })

  test('fewer than five letters: no hint and Join disabled, even once loaded', async () => {
    const onPick = vi.fn()
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick }))
    type('slate')
    await joinEnabled()
    type('slat')
    expect(join().disabled).toBe(true)
    expect(screen.queryByText(HINT)).toBeNull()
    expect(box().getAttribute('aria-invalid')).not.toBe('true')
    fireEvent.submit(box().form!)
    expect(onPick).not.toHaveBeenCalled()
  })

  test('disabled disables every quick pick, the word box and Join', async () => {
    const onPick = vi.fn()
    render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick, disabled: true }))
    expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    expect(box().disabled).toBe(true)
    // Even with a valid word already typed, a disabled picker never submits.
    cleanup()
    const { rerender } = render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick }))
    type('slate')
    await joinEnabled()
    rerender(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick, disabled: true }))
    expect(join().disabled).toBe(true)
    fireEvent.submit(box().form!)
    expect(onPick).not.toHaveBeenCalled()
  })

  test('a list that never loads does not dead-end: Join enables at five letters, with no hint', async () => {
    vi.doMock('../../../convex/lib/answerWords.ts', () => {
      throw new Error('chunk load failed')
    })
    try {
      const onPick = vi.fn()
      render(createElement(WordPicker, { popular: POPULAR, currentWord: null, onPick }))
      type('xxxx')
      // Settle the failed import, then check four letters still can't join.
      await new Promise((r) => setTimeout(r, 50))
      expect(join().disabled).toBe(true)
      type('xxxxx')
      await joinEnabled()
      expect(screen.queryByText(HINT)).toBeNull()
      expect(box().getAttribute('aria-invalid')).not.toBe('true')
      fireEvent.submit(box().form!)
      // The server is the authority: it refuses with UNKNOWN_WORD and the caller toasts.
      expect(onPick).toHaveBeenCalledWith('xxxxx')
    } finally {
      vi.doUnmock('../../../convex/lib/answerWords.ts')
    }
  })
})
