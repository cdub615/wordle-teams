// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ALL_ORDERS, type Order } from '../../../convex/lib/clueLadder/orders.ts'
import { ClueLadderFinished, type ClueLadderResult } from './finished.tsx'

afterEach(cleanup)

const answer: Order = ['star', 'circle', 'square', 'triangle', 'diamond']
const other: Order = ['circle', 'star', 'square', 'triangle', 'diamond']

const solved = {
  result: { status: 'solved', lockedAtClue: 3, lockedOrder: answer } as ClueLadderResult,
  answer,
  remaining: [24, 6, 2, 1],
  possibleAtLockIn: [answer, other],
  shareText: 'Clue ladder #4: solved on clue 3',
  onShare: vi.fn(),
}

describe('ClueLadderFinished', () => {
  test('a solve names the clue', () => {
    render(createElement(ClueLadderFinished, solved))
    expect(screen.getByRole('heading', { name: 'Solved on clue 3' })).toBeTruthy()
  })

  test('the result heading takes focus on mount, so the confirm unmounting does not drop it to the page', () => {
    render(createElement(ClueLadderFinished, solved))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Solved on clue 3' }))
    cleanup()
    render(createElement(ClueLadderFinished, { ...solved, result: { status: 'failed', lockedAtClue: 3, lockedOrder: other } }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'X: not solved' }))
  })

  test('the answer is announced as one row', () => {
    render(createElement(ClueLadderFinished, solved))
    expect(screen.getByRole('img', { name: 'Answer: star, circle, square, triangle, diamond' })).toBeTruthy()
  })

  test('the ladder runs from 120 and marks the lock-in step', () => {
    render(createElement(ClueLadderFinished, solved))
    const steps = screen.getByRole('list', { name: 'Orders still possible after each clue' }).querySelectorAll('li')
    expect([...steps].map((li) => li.dataset.count)).toEqual(['120', '24', '6', '2', '1'])
    expect(steps[3].dataset.locked).toBe('true')
    expect(steps[3].textContent).toContain('you locked in')
    expect(screen.getAllByText(/you locked in/)).toHaveLength(1)
    expect(steps[3].textContent).toContain('After clue 3: 2')
    expect(steps[0].textContent).toContain('Start: 120')
    expect(document.querySelectorAll('[data-locked]')).toHaveLength(1)
  })

  test('an early lock-in shows the odds and the other order', () => {
    render(createElement(ClueLadderFinished, solved))
    expect(screen.getByText('You had a 1 in 2 chance.')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'The other was: circle, star, square, triangle, diamond' })).toBeTruthy()
  })

  test('a lock-in on the proving clue shows no odds', () => {
    render(createElement(ClueLadderFinished, {
        ...solved,
        result: { status: 'solved', lockedAtClue: 4, lockedOrder: answer },
        possibleAtLockIn: [answer],
      }))
    expect(screen.queryByText(/You had a 1 in/)).toBeNull()
  })

  test('an X shows the player’s order beside the answer', () => {
    render(
      createElement(ClueLadderFinished, {
        ...solved,
        result: { status: 'failed', lockedAtClue: 3, lockedOrder: other },
        shareText: 'Clue ladder #4: X',
      }),
    )
    expect(screen.getByRole('heading', { name: 'X: not solved' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Your order: circle, star, square, triangle, diamond' })).toBeTruthy()
    // The orders "other" than the one the player chose: here, the answer.
    expect(screen.getByRole('img', { name: 'The other was: star, circle, square, triangle, diamond' })).toBeTruthy()
  })

  test('three or more possibilities use the plural', () => {
    const third: Order = ['square', 'circle', 'star', 'triangle', 'diamond']
    render(createElement(ClueLadderFinished, {
        ...solved,
        result: { status: 'solved', lockedAtClue: 2, lockedOrder: answer },
        possibleAtLockIn: [answer, other, third],
      }))
    expect(screen.getByText('You had a 1 in 3 chance.')).toBeTruthy()
    expect(screen.getByText('The others were:')).toBeTruthy()
  })

  test('the share line is shown and Share calls back', () => {
    const onShare = vi.fn()
    render(createElement(ClueLadderFinished, { ...solved, onShare }))
    expect(screen.getByText('Clue ladder #4: solved on clue 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(onShare).toHaveBeenCalledTimes(1)
  })

  test('a solve has no Your order row', () => {
    render(createElement(ClueLadderFinished, solved))
    expect(screen.queryByRole('img', { name: /^Your order/ })).toBeNull()
  })

  test('actions render when passed', () => {
    render(createElement(ClueLadderFinished, { ...solved, actions: createElement('button', null, 'Back to scores') }))
    expect(screen.getByRole('button', { name: 'Back to scores' })).toBeTruthy()
  })

  test('an X whose order did not fit lists what fit and gives no odds', () => {
    const third: Order = ['square', 'circle', 'star', 'triangle', 'diamond']
    render(
      createElement(ClueLadderFinished, {
        ...solved,
        result: { status: 'failed', lockedAtClue: 3, lockedOrder: third },
        possibleAtLockIn: [answer, other],
      }),
    )
    expect(screen.queryByText(/You had a 1 in/)).toBeNull()
    expect(screen.queryByText(/The others? (was|were)/)).toBeNull()
    expect(screen.getByText('Your order didn\u2019t fit the clues you had.')).toBeTruthy()
    expect(screen.getByText('The orders that fit were:')).toBeTruthy()
    expect(screen.getAllByRole('img', { name: /^A possible order:/ })).toHaveLength(2)
  })

  test('an X whose order did not fit with one fitting order uses the singular', () => {
    const third: Order = ['square', 'circle', 'star', 'triangle', 'diamond']
    render(
      createElement(ClueLadderFinished, {
        ...solved,
        result: { status: 'failed', lockedAtClue: 3, lockedOrder: third },
        possibleAtLockIn: [answer],
      }),
    )
    expect(screen.getByRole('img', { name: 'The order that fit was: star, circle, square, triangle, diamond' })).toBeTruthy()
    expect(screen.queryByText('The orders that fit were:')).toBeNull()
  })

  test('a play that ran out of time shows X, no lock-in and no odds', () => {
    render(
      createElement(ClueLadderFinished, {
        result: { status: 'timedOut' },
        answer,
        remaining: [24, 6, 2, 1],
        possibleAtLockIn: [],
        shareText: 'Clue ladder #4: X',
        onShare: vi.fn(),
      }),
    )
    expect(screen.getByRole('heading', { name: 'X: not solved' })).toBeTruthy()
    expect(screen.getByText('Time ran out.')).toBeTruthy()
    expect(screen.queryByRole('img', { name: /^Your order/ })).toBeNull()
    expect(document.querySelectorAll('[data-locked]')).toHaveLength(0)
    expect(screen.queryByText(/you locked in/)).toBeNull()
    expect(screen.queryByText(/You had a 1 in|didn.t fit/)).toBeNull()
  })

  test('the result type cannot describe a solve without its lock-in', () => {
    // @ts-expect-error a solve must name the clue and the order
    const bad: ClueLadderResult = { status: 'solved' }
    // @ts-expect-error a loss must name the clue and the order
    const badX: ClueLadderResult = { status: 'failed', lockedAtClue: 2 }
    const ok: ClueLadderResult = { status: 'timedOut' }
    expect([bad, badX, ok]).toHaveLength(3)
  })
})

describe('ClueLadderFinished lists six orders at most', () => {
  /** The first `n` orders possible, locked in on `locked`. */
  const lockedIn = (n: number, locked: Order, status: 'solved' | 'failed' = 'solved') => ({
    ...solved,
    result: { status, lockedAtClue: 1, lockedOrder: locked } as ClueLadderResult,
    possibleAtLockIn: ALL_ORDERS.slice(0, n),
  })
  const more = () => screen.queryByText(/^and \d+ more$/)

  test('six others are all listed, with no "more" line', () => {
    render(createElement(ClueLadderFinished, lockedIn(7, ALL_ORDERS[0])))
    expect(screen.getByText('You had a 1 in 7 chance.')).toBeTruthy()
    expect(screen.getAllByRole('img', { name: /^Another possible order:/ })).toHaveLength(6)
    expect(more()).toBeNull()
  })

  test('seven others: six listed, then "and 1 more"', () => {
    render(createElement(ClueLadderFinished, lockedIn(8, ALL_ORDERS[0])))
    expect(screen.getByText('You had a 1 in 8 chance.')).toBeTruthy()
    expect(screen.getAllByRole('img', { name: /^Another possible order:/ })).toHaveLength(6)
    expect(screen.getByText('and 1 more')).toBeTruthy()
  })

  test('more than seven counts the rest', () => {
    render(createElement(ClueLadderFinished, lockedIn(30, ALL_ORDERS[0])))
    expect(screen.getAllByRole('img', { name: /^Another possible order:/ })).toHaveLength(6)
    expect(screen.getByText('and 23 more')).toBeTruthy()
  })

  test('six orders that fit an order that did not are all listed', () => {
    render(createElement(ClueLadderFinished, lockedIn(6, ALL_ORDERS[100], 'failed')))
    expect(screen.getAllByRole('img', { name: /^A possible order:/ })).toHaveLength(6)
    expect(more()).toBeNull()
  })

  test('seven that fit: six listed, then "and 1 more"', () => {
    render(createElement(ClueLadderFinished, lockedIn(7, ALL_ORDERS[100], 'failed')))
    expect(screen.getAllByRole('img', { name: /^A possible order:/ })).toHaveLength(6)
    expect(screen.getByText('and 1 more')).toBeTruthy()
  })
})
