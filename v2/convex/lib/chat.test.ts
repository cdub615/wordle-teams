import { describe, expect, test } from 'vitest'
import {
  BUDGET_THRESHOLD_BYTES,
  RATE_LIMIT_MESSAGES,
  budgetIncrementFor,
  budgetMonthFor,
  isOverBudget,
  nextPostWindow,
  requireBody,
} from './chat.ts'

describe('requireBody', () => {
  test('trims and keeps ordinary text', () => {
    expect(requireBody('  hello  ')).toBe('hello')
  })

  test('keeps emoji intact, which is the whole of v1 rich content', () => {
    expect(requireBody('nice 🎉')).toBe('nice 🎉')
  })

  test('refuses a message that is empty once trimmed', () => {
    expect(() => requireBody('   ')).toThrow()
  })

  test('refuses a message past the length cap', () => {
    expect(() => requireBody('x'.repeat(2001))).toThrow()
  })

  test('accepts a message exactly at the cap', () => {
    expect(requireBody('x'.repeat(2000))).toHaveLength(2000)
  })
})

describe('nextPostWindow', () => {
  test('opens a window for a player who has never posted', () => {
    expect(nextPostWindow({}, 10_000)).toEqual({ postWindowStartedAt: 10_000, postsInWindow: 1 })
  })

  test('counts up inside an open window', () => {
    const current = { postWindowStartedAt: 10_000, postsInWindow: 3 }
    expect(nextPostWindow(current, 10_500)).toEqual({ postWindowStartedAt: 10_000, postsInWindow: 4 })
  })

  // THE REFUSAL. null means "rejected", and it is the only thing standing
  // between a runaway client and an exhausted monthly I/O budget.
  test('refuses once the window is full', () => {
    const full = { postWindowStartedAt: 10_000, postsInWindow: RATE_LIMIT_MESSAGES }
    expect(nextPostWindow(full, 10_500)).toBeNull()
  })

  test('reopens the window once sixty seconds have passed', () => {
    const full = { postWindowStartedAt: 10_000, postsInWindow: RATE_LIMIT_MESSAGES }
    expect(nextPostWindow(full, 70_000)).toEqual({ postWindowStartedAt: 70_000, postsInWindow: 1 })
  })
})

describe('the budget meter', () => {
  // DELIBERATELY CONSERVATIVE: every member is counted as if connected, so the
  // meter trips early rather than late.
  test('charges every member of the team for a wake', () => {
    expect(budgetIncrementFor(5)).toBe(budgetIncrementFor(1) * 5)
  })

  test('is under budget at zero and over it at the threshold', () => {
    expect(isOverBudget(0)).toBe(false)
    expect(isOverBudget(BUDGET_THRESHOLD_BYTES)).toBe(true)
  })

  // Built from a LOCAL Date on purpose, matching toPuzzleDay, so this test
  // does not pass on the host's zone and fail under CI's TZ=UTC.
  test('keys the budget by calendar month', () => {
    expect(budgetMonthFor(new Date(2026, 8, 5, 12).getTime())).toBe('2026-09')
    expect(budgetMonthFor(new Date(2026, 11, 31, 12).getTime())).toBe('2026-12')
  })
})
