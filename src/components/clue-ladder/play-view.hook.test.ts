// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_SLOTS } from '#/lib/clue-ladder-board.ts'
import type { Order } from '../../../convex/lib/clueLadder/orders.ts'
import { ClueLadderPlayView } from './play-view.tsx'
import type { ClueLadderTodayView } from './today.ts'

// Radix Popover (Lock in's confirm) measures its content; jsdom has no
// ResizeObserver. Same stub as challenges.hook.test.ts.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(cleanup)

const answer: Order = ['star', 'circle', 'square', 'triangle', 'diamond']
const other: Order = ['circle', 'star', 'square', 'triangle', 'diamond']
const playing: ClueLadderTodayView = {
  status: 'playing',
  date: '2026-10-20',
  cluesRevealed: 2,
  clues: ['The triangle is at one end.', 'The circle is not in the third slot.'],
  scratch: [null, null, null, null, null],
}
const solved: ClueLadderTodayView = {
  status: 'solved',
  date: '2026-10-20',
  cluesRevealed: 2,
  clues: playing.clues,
  scratch: [...answer],
  lockedAtClue: 2,
  lockedOrder: [...answer],
  answer: [...answer],
  remaining: [24, 1],
  possibleAtLockIn: [answer],
}
const failed: ClueLadderTodayView = {
  status: 'failed',
  date: '2026-10-20',
  cluesRevealed: 1,
  clues: [playing.clues[0]],
  scratch: [...other],
  lockedAtClue: 1,
  lockedOrder: [...other],
  answer: [...answer],
  remaining: [24, 6, 1],
  possibleAtLockIn: [answer, other],
}

function view(over: Partial<Parameters<typeof ClueLadderPlayView>[0]> = {}) {
  const props = {
    play: playing,
    slots: EMPTY_SLOTS,
    exhausted: false,
    pending: false,
    startFailed: false,
    onRetry: vi.fn(),
    onSlotsChange: vi.fn(),
    onNextClue: vi.fn(),
    onLockIn: vi.fn(),
    onShare: vi.fn(),
    ...over,
  }
  const { rerender } = render(createElement(ClueLadderPlayView, props))
  return { ...props, rerender: (more: typeof over) => rerender(createElement(ClueLadderPlayView, { ...props, ...more })) }
}

const lockIn = () => screen.getByRole('button', { name: 'Lock in' }) as HTMLButtonElement
const nextClue = () => screen.getByRole('button', { name: 'Next clue' }) as HTMLButtonElement
const slot = (n: number) => screen.getByRole('button', { name: new RegExp(`^Slot ${n},`) }) as HTMLButtonElement

describe('ClueLadderPlayView', () => {
  test('not started: no board, and nothing to press while the game is set up', () => {
    // The line saying so is the page's live status (play-page.hook.test.ts).
    view({ play: { status: 'not-started', date: '2026-10-20' } })
    expect(screen.queryByRole('group', { name: 'Your order' })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('not started, and the start failed: Try again asks for another', () => {
    const props = view({ play: { status: 'not-started', date: '2026-10-20' }, startFailed: true })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(props.onRetry).toHaveBeenCalledOnce()
  })

  test('playing: the revealed clues, and Lock in off until every slot is filled', () => {
    view()
    expect(within(screen.getByRole('list', { name: 'Clues' })).getAllByRole('listitem')).toHaveLength(2)
    expect(lockIn().disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
  })

  test('playing: the board shows the slots it is given and hands changes back', () => {
    const props = view({ slots: ['star', null, null, null, null] })
    expect(slot(1).getAttribute('aria-label')).toBe('Slot 1, star')
    fireEvent.click(slot(1))
    expect(props.onSlotsChange).toHaveBeenCalledExactlyOnceWith([null, null, null, null, null])
  })

  test('a full board turns Lock in on', () => {
    view({ slots: answer })
    expect(lockIn().disabled).toBe(false)
  })

  test('Next clue asks for one', () => {
    const props = view()
    expect(nextClue().disabled).toBe(false)
    fireEvent.click(nextClue())
    expect(props.onNextClue).toHaveBeenCalledOnce()
  })

  test('Next clue is off once the server has said there are no more', () => {
    view({ exhausted: true })
    expect(nextClue().disabled).toBe(true)
  })

  test('while a call is pending the board, Next clue and Lock in are all off', () => {
    view({ slots: answer, pending: true })
    expect(nextClue().disabled).toBe(true)
    expect(lockIn().disabled).toBe(true)
    for (const n of [1, 2, 3, 4, 5]) expect(slot(n).disabled).toBe(true)
  })

  test('the board is live when nothing is pending', () => {
    view({ slots: answer })
    for (const n of [1, 2, 3, 4, 5]) expect(slot(n).disabled).toBe(false)
  })

  test('Lock in alone does nothing until confirmed', () => {
    const props = view({ slots: answer })
    fireEvent.click(lockIn())
    expect(props.onLockIn).not.toHaveBeenCalled()
  })

  test('Lock in, confirmed, hands over the order on the board', () => {
    const props = view({ slots: answer })
    fireEvent.click(lockIn())
    fireEvent.click(screen.getByRole('button', { name: 'Yes, lock in' }))
    expect(props.onLockIn).toHaveBeenCalledExactlyOnceWith(answer)
  })

  test('the confirm stays open while the lock-in is pending, then gives way to the result', () => {
    const props = view({ slots: answer })
    fireEvent.click(lockIn())
    fireEvent.click(screen.getByRole('button', { name: 'Yes, lock in' }))
    props.rerender({ slots: answer, pending: true })
    expect(screen.getByText("One try. If it's wrong, today is an X.")).toBeTruthy()
    props.rerender({ play: solved, slots: answer, pending: false })
    expect(screen.queryByText("One try. If it's wrong, today is an X.")).toBeNull()
    expect(screen.getByRole('heading', { name: 'Solved on clue 2' })).toBeTruthy()
  })

  test('finished: the result, and Share hands over the numbered line', () => {
    const props = view({ play: solved })
    expect(screen.getByRole('heading', { name: 'Solved on clue 2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Lock in' })).toBeNull()
    expect(screen.getByText('Clue ladder #6: solved on clue 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(props.onShare).toHaveBeenCalledExactlyOnceWith('Clue ladder #6: solved on clue 2')
  })

  test('finished: the answer and the ladder come from the play', () => {
    view({ play: solved })
    expect(screen.getByRole('img', { name: 'Answer: star, circle, square, triangle, diamond' })).toBeTruthy()
    const steps = screen.getByRole('list', { name: 'Orders still possible after each clue' }).querySelectorAll('li')
    expect([...steps].map((li) => li.dataset.count)).toEqual(['120', '24', '1'])
    expect(steps[2].dataset.locked).toBe('true')
  })

  test('failed: an X with the player’s order, the orders that fitted, and an X share line', () => {
    const props = view({ play: failed })
    expect(screen.getByRole('heading', { name: 'X: not solved' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Answer: star, circle, square, triangle, diamond' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Your order: circle, star, square, triangle, diamond' })).toBeTruthy()
    expect(screen.getByText('You had a 1 in 2 chance.')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'The other was: star, circle, square, triangle, diamond' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(props.onShare).toHaveBeenCalledExactlyOnceWith('Clue ladder #6: X')
  })

  test('finished: the caller’s actions sit under the result', () => {
    view({ play: solved, actions: createElement('a', { href: '/scores' }, 'Team scores') })
    expect(screen.getByRole('link', { name: 'Team scores' })).toBeTruthy()
  })
})
