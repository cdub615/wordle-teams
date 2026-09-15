// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, because this renders the
// real component. `.hook.test.ts` and createElement by hand, matching every
// other component test in src/ and vitest.config.ts's `src/**/*.test.ts` glob.
//
// WHAT LEFT THIS FILE, AND WHERE IT WENT. Every keystroke test here used to fire
// at BoardInput's own contentEditable, because the board was a focus target with
// a keydown handler of its own. form.tsx now wraps the answer slots AND the board
// in ONE contentEditable region and owns the whole stream, so those tests moved
// to form.hook.test.ts and fire at the region — the gapped-board backspace
// (wordle-teams-lz3w), the last-row-only board, the Ctrl/Cmd combos and Enter
// among them. They are asserted through the REAL board there rather than through
// a `setGuesses` spy, which is a strictly better place for them: it is the board
// a player sees.
//
// WHAT STAYS: the cursor adaptation, which is this component's alone to get right
// and is invisible to a typecheck.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { BoardInput, BoardSubmit } from './board-input.tsx'
import type { Cursor } from './entry-cursor.ts'

afterEach(cleanup)

const GAPPED = ['', '', 'SLATE', '', '', '']

/** The board half of the entry region. */
const board = () => screen.getByRole('region', { name: 'Wordle Board' })

function mount(props: {
  guesses: Array<string>
  answer: string
  cursor?: Cursor | null
  onSelect?: () => void
}) {
  render(
    createElement(BoardInput, {
      guesses: props.guesses,
      answer: props.answer,
      cursor: props.cursor ?? null,
      onSelect: props.onSelect,
    }),
  )
}

/**
 * THE ADAPTATION TO `<WordleBoard>`, WHICH IS THIS COMPONENT'S TO GET RIGHT.
 * `cursorFor` is non-null in the answer zone too, and that caret belongs to
 * answer-slots.tsx — two carets on screen at once is the failure the `zone` test
 * in the render exists to prevent, and it is invisible to a typecheck.
 */
describe('BoardInput cursor', () => {
  test('marks the tile a board cursor names, row and column', () => {
    mount({ guesses: GAPPED, answer: 'CRANE', cursor: { zone: 'board', row: 3, index: 2 } })
    expect(screen.getByTestId('board-cursor').id).toBe('4-3')
  })

  test('marks no tile for an answer-zone cursor', () => {
    mount({ guesses: GAPPED, answer: 'CR', cursor: { zone: 'answer', index: 2 } })
    expect(screen.queryByTestId('board-cursor')).toBeNull()
  })

  test('marks no tile when there is no cursor', () => {
    mount({ guesses: GAPPED, answer: 'CRANE' })
    expect(screen.queryByTestId('board-cursor')).toBeNull()
  })
})

/**
 * THE SHELL, PINNED AS A SHELL. A future change that gives this component back a
 * keydown handler or a contentEditable of its own re-creates the second focus
 * target the whole feature exists to remove — and every gate in this repo would
 * stay green, because both stream handlers would still work in isolation.
 */
describe('BoardInput owns no keystrokes', () => {
  test('is not an editing host and takes no focus of its own', () => {
    mount({ guesses: GAPPED, answer: 'CRANE' })
    expect(board().getAttribute('contenteditable')).toBeNull()
    expect(board().getAttribute('tabindex')).toBeNull()
  })

  test('swallows no key: a keydown here is left for the region above to handle', () => {
    mount({ guesses: GAPPED, answer: 'CRANE' })
    // fireEvent returns false when the event was preventDefault'd. Nothing here
    // prevents anything, so the key reaches form.tsx's handler by bubbling.
    expect(fireEvent.keyDown(board(), { key: 'c' })).toBe(true)
    expect(fireEvent.keyDown(board(), { key: 'Backspace' })).toBe(true)
  })

  /**
   * MOUSEDOWN, NOT CLICK, for the reason AnswerSlots' own `onSelect` gives: it
   * has to land before the focus/blur pair a click on the other zone would
   * otherwise settle first.
   */
  test('reports a mousedown so the caller can move the caret here', () => {
    let selected = 0
    mount({ guesses: GAPPED, answer: 'CRANE', onSelect: () => (selected += 1) })
    fireEvent.mouseDown(board())
    expect(selected).toBe(1)
  })
})

/**
 * The desktop submit, which is a SEPARATE export precisely so form.tsx can put it
 * OUTSIDE the contentEditable region while the board goes inside it.
 */
describe('BoardSubmit', () => {
  test('carries the id form.tsx’s Enter key reaches it by', () => {
    render(createElement(BoardSubmit, { submitting: false, disabled: false }))
    const button = document.getElementById('board-submit')
    expect(button).toBeTruthy()
    expect(button?.getAttribute('type')).toBe('submit')
    expect(button?.hasAttribute('disabled')).toBe(false)
  })

  test('is disabled while submitting, and says so to a screen reader too', () => {
    render(createElement(BoardSubmit, { submitting: true, disabled: false }))
    const button = document.getElementById('board-submit')
    expect(button?.hasAttribute('disabled')).toBe(true)
    expect(button?.getAttribute('aria-disabled')).toBe('true')
  })
})
