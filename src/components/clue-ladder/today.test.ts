import { describe, expect, test } from 'vitest'
import { cardPlayOf, type ClueLadderTodayView } from './today.ts'

const base = { date: '2026-10-20', clues: ['a', 'b'], scratch: [null, null, null, null, null] }
const finished = {
  ...base,
  cluesRevealed: 2,
  lockedAtClue: 2,
  lockedOrder: ['star', 'circle', 'square', 'triangle', 'diamond'],
  answer: ['star', 'circle', 'square', 'triangle', 'diamond'],
  remaining: [24, 1],
  possibleAtLockIn: [],
} satisfies Omit<Extract<ClueLadderTodayView, { lockedAtClue: number }>, 'status'>

describe('cardPlayOf', () => {
  test.each<[ClueLadderTodayView, ReturnType<typeof cardPlayOf>]>([
    [{ status: 'not-started', date: '2026-10-20' }, { status: 'not-started' }],
    [{ status: 'playing', cluesRevealed: 2, ...base }, { status: 'playing', cluesRevealed: 2 }],
    [{ status: 'solved', ...finished }, { status: 'solved', lockedAtClue: 2 }],
    [{ status: 'failed', ...finished }, { status: 'failed' }],
  ])('%j', (view, card) => {
    expect(cardPlayOf(view)).toEqual(card)
  })
})
