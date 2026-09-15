// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, because this renders the
// real component and fires real keydowns at it. `.hook.test.ts` and
// createElement by hand, matching every other component test in src/ and
// vitest.config.ts's `src/**/*.test.ts` glob.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { BoardInput } from './board-input.tsx'
import type { Cursor } from './entry-cursor.ts'

/**
 * sonner is stubbed rather than rendered: the real toaster is a live region of
 * its own, so `getByRole('status')` in any test that shares this DOM would go
 * ambiguous the moment a toast appears (see form.hook.test.ts). `vi.hoisted`
 * because `vi.mock` is lifted above the const it would otherwise close over.
 */
const { warnings } = vi.hoisted(() => ({ warnings: [] as Array<string> }))
vi.mock('sonner', () => ({
  toast: { warning: (message: string) => warnings.push(message) },
}))

afterEach(() => {
  cleanup()
  warnings.length = 0
})

const GAPPED = ['', '', 'SLATE', '', '', '']

/** The contentEditable that owns the keystroke stream. */
const board = () => screen.getByRole('region', { name: 'Wordle Board' })

function mount(props: { guesses: Array<string>; answer: string; cursor?: Cursor | null }) {
  const calls: Array<Array<string>> = []
  render(
    createElement(BoardInput, {
      guesses: props.guesses,
      setGuesses: (guesses: Array<string>) => calls.push(guesses),
      answer: props.answer,
      hasExistingScore: false,
      submitting: false,
      submitDisabled: false,
      cursor: props.cursor ?? null,
    }),
  )
  return calls
}

/**
 * THE SHIPPING BUG (wordle-teams-lz3w), REACHED THE WAY A PLAYER REACHES IT.
 *
 * A gapped board is a designed-for shape: prefillFrom (import-prefill.ts)
 * assembles the board BY ROW INDEX from a screenshot parse and leaves a row it
 * could not read blank, reporting it through `missingRows`. So
 * ['', '', 'SLATE', '', '', ''] is what the form holds after an import that read
 * one row of six — and the first thing a player does there is start typing into
 * row 0, or press Backspace because they changed their mind.
 */
describe('BoardInput backspace on a gapped board', () => {
  test('never touches a row the cursor is not in', () => {
    const calls = mount({ guesses: GAPPED, answer: 'CRANE' })
    fireEvent.keyDown(board(), { key: 'Backspace' })
    // THE BOARD IS WRITTEN BACK, UNCHANGED, rather than not written at all: the
    // cursor is at row 0 column 0 with content below it, so there is nothing
    // behind it to delete and nothing to walk back into. Asserted as a whole
    // array, not just row 2 — an empty `calls` would satisfy a loop over it, and
    // the point is that the row the reader got RIGHT still reads 'SLATE'.
    expect(calls).toEqual([GAPPED])
  })
})

/**
 * The rest of the keystroke stream through the real component. Until this file
 * existed, `board-input.test.ts` asserted the two pure helpers and NOTHING
 * asserted the handler that calls them — which is how a backwards scan and a
 * forwards scan shipped side by side in the same function pair.
 */
describe('BoardInput typing', () => {
  test('types into the first row with room, gap or no gap', () => {
    const calls = mount({ guesses: GAPPED, answer: 'CRANE' })
    fireEvent.keyDown(board(), { key: 'c' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['C', '', 'SLATE', '', '', ''])
  })

  test('mid-row backspace deletes the letter behind the cursor', () => {
    const calls = mount({ guesses: ['CRANE', 'SL', '', '', '', ''], answer: 'PIVOT' })
    fireEvent.keyDown(board(), { key: 'Backspace' })
    expect(calls[0]).toEqual(['CRANE', 'S', '', '', '', ''])
  })

  /**
   * A SOLVED BOARD HAS NO CARET AND BACKSPACE STILL WORKS. `cursorFor` returns
   * null here while `boardIsValid` is true, and that combination is how a player
   * edits a board they mistyped into a solve — so a null cursor must not be read
   * as "ignore every key" (entry-cursor.ts's `backspace` doc).
   */
  test('backspace stays live on a solved board', () => {
    const calls = mount({ guesses: ['SLATE', 'CRANE', '', '', '', ''], answer: 'CRANE' })
    fireEvent.keyDown(board(), { key: 'Backspace' })
    expect(calls[0]).toEqual(['SLATE', 'CRAN', '', '', '', ''])
  })

  test('typing past a solved row writes nothing at all', () => {
    const calls = mount({ guesses: ['SLATE', 'CRANE', '', '', '', ''], answer: 'CRANE' })
    fireEvent.keyDown(board(), { key: 'x' })
    expect(calls).toEqual([])
  })

  /**
   * NOT MERELY "TYPES NOTHING" — WRITES NOTHING. Every refusal returns the input
   * normalised through `toRows`, so writing it back would hand form.tsx a fresh
   * array and re-fire its `useEffect(…, [guesses])` scroll on every arrow key.
   */
  test('a non-letter key writes nothing', () => {
    const calls = mount({ guesses: GAPPED, answer: 'CRANE' })
    fireEvent.keyDown(board(), { key: 'ArrowLeft' })
    fireEvent.keyDown(board(), { key: 'Shift' })
    fireEvent.keyDown(board(), { key: '5' })
    expect(calls).toEqual([])
  })

  // The paste shortcut, which had been typed as a literal "v" before the
  // modifier check went in. Tab likewise has to reach the browser to move focus.
  test('Tab and Ctrl/Cmd combos are left to the browser', () => {
    const calls = mount({ guesses: GAPPED, answer: 'CRANE' })
    const tab = fireEvent.keyDown(board(), { key: 'Tab' })
    const paste = fireEvent.keyDown(board(), { key: 'v', ctrlKey: true })
    // fireEvent returns false when the event was preventDefault'd.
    expect(tab).toBe(true)
    expect(paste).toBe(true)
    expect(calls).toEqual([])
  })

  test('every other key is preventDefaulted, so nothing lands in the DOM', () => {
    mount({ guesses: GAPPED, answer: 'CRANE' })
    expect(fireEvent.keyDown(board(), { key: 'c' })).toBe(false)
    expect(fireEvent.keyDown(board(), { key: 'Backspace' })).toBe(false)
  })
})

describe('BoardInput Enter', () => {
  test('clicks the submit button when the board is complete', () => {
    mount({ guesses: ['SLATE', 'CRANE', '', '', '', ''], answer: 'CRANE' })
    let clicks = 0
    document.getElementById('board-submit')?.addEventListener('click', () => {
      clicks += 1
    })
    fireEvent.keyDown(board(), { key: 'Enter' })
    expect(clicks).toBe(1)
  })

  test('warns instead of submitting an incomplete board', () => {
    mount({ guesses: GAPPED, answer: 'CRANE' })
    let clicks = 0
    document.getElementById('board-submit')?.addEventListener('click', () => {
      clicks += 1
    })
    fireEvent.keyDown(board(), { key: 'Enter' })
    expect(clicks).toBe(0)
    expect(warnings).toEqual(['Board must be complete to submit'])
  })
})

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
