// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime, because this renders the
// real component. `.hook.test.ts` and createElement by hand, matching every
// other component test in src/ and vitest.config.ts's `src/**/*.test.ts` glob.
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { AnswerSlots } from './answer-slots.tsx'

afterEach(cleanup)

const slots = () => screen.getAllByTestId('answer-slot')

describe('AnswerSlots', () => {
  test('renders five slots, one per letter of the answer', () => {
    render(createElement(AnswerSlots, { answer: '', cursorIndex: 0, onSelect: () => {} }))
    expect(slots()).toHaveLength(5)
  })

  test('shows each typed letter in its own slot', () => {
    render(createElement(AnswerSlots, { answer: 'CR', cursorIndex: 2, onSelect: () => {} }))
    expect(slots()[0].textContent).toBe('C')
    expect(slots()[1].textContent).toBe('R')
    expect(slots()[2].textContent).toBe('')
  })

  /**
   * THE RENDERED CARET IS THE WHOLE POINT OF THIS COMPONENT. The box it
   * replaces was a shadcn Input with caret-transparent — a focused field with a
   * bright ring and no caret, which is the standard signature of a DISABLED
   * field and is most of why players did not know to type (wty4.1.6).
   */
  test('marks exactly one slot as the cursor', () => {
    render(createElement(AnswerSlots, { answer: 'CR', cursorIndex: 2, onSelect: () => {} }))
    const marked = slots().filter((slot) => slot.getAttribute('data-cursor') === 'true')
    expect(marked).toHaveLength(1)
    expect(slots()[2].getAttribute('data-cursor')).toBe('true')
  })

  // Index 5 is a legal insertion point with only five slots to render it in.
  // It is reachable by clicking back to correct a complete answer.
  test('a cursor one past the end marks the last slot, trailing', () => {
    render(createElement(AnswerSlots, { answer: 'CRANE', cursorIndex: 5, onSelect: () => {} }))
    expect(slots()[4].getAttribute('data-cursor')).toBe('true')
    expect(slots()[4].getAttribute('data-cursor-trailing')).toBe('true')
  })

  test('no slot is marked when the cursor is elsewhere', () => {
    render(createElement(AnswerSlots, { answer: 'CRANE', cursorIndex: null, onSelect: () => {} }))
    expect(slots().filter((slot) => slot.getAttribute('data-cursor') === 'true')).toHaveLength(0)
  })

  test('announces the answer so far to a screen reader', () => {
    render(createElement(AnswerSlots, { answer: 'CR', cursorIndex: 2, onSelect: () => {} }))
    expect(screen.getByLabelText("Today's Wordle answer, 2 of 5 letters: C R")).toBeDefined()
  })
})

/**
 * THE CARET ITSELF, NOT THE ATTRIBUTE THAT DESCRIBES IT.
 *
 * Every test above asserts `data-cursor`, which a component that renders the
 * attribute and no caret satisfies completely — and a draft of this very
 * component did exactly that, passing all six. The rendered caret IS this
 * component's reason to exist: the field it replaces was a shadcn Input with
 * caret-transparent, and a focused box with no blinking caret is the standard
 * signature of a DISABLED field, which is most of why players did not know to
 * type (wty4.1.6). A suite that cannot tell the caret is missing cannot defend
 * the fix.
 */
describe('AnswerSlots caret', () => {
  test('the marked slot actually contains a caret element', () => {
    render(createElement(AnswerSlots, { answer: 'CR', cursorIndex: 2, onSelect: () => {} }))
    const marked = slots()[2]
    const caret = marked.querySelector('[data-testid="answer-caret"]')
    expect(caret).not.toBeNull()
    expect(caret?.getAttribute('aria-hidden')).toBe('true')
  })

  test('and no caret is rendered anywhere when the cursor is on the board', () => {
    render(createElement(AnswerSlots, { answer: 'CRANE', cursorIndex: null, onSelect: () => {} }))
    expect(screen.queryByTestId('answer-caret')).toBeNull()
  })

  // The trailing case draws the caret in the LAST slot, not a sixth one.
  test('a trailing cursor puts the caret inside the last slot', () => {
    render(createElement(AnswerSlots, { answer: 'CRANE', cursorIndex: 5, onSelect: () => {} }))
    expect(slots()[4].querySelector('[data-testid="answer-caret"]')).not.toBeNull()
    expect(screen.getAllByTestId('answer-caret')).toHaveLength(1)
  })
})
