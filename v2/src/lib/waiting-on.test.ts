import { describe, expect, test } from 'vitest'
import { waitingOnSummary } from './waiting-on.ts'

const members = (...ids: Array<string>) => ids.map((id) => ({ id, label: id.toUpperCase() }))

describe('waitingOnSummary', () => {
  test('counts who has played out of the whole team', () => {
    const s = waitingOnSummary(members('a', 'b', 'c'), new Set(['a']), 3)
    expect(s.total).toBe(3)
    expect(s.playedCount).toBe(1)
  })

  test('members with no score are the ones waited on, in team order', () => {
    const s = waitingOnSummary(members('a', 'b', 'c'), new Set(['b']), 3)
    expect(s.shown).toEqual(['A', 'C'])
    expect(s.othersCount).toBe(0)
  })

  // THE CAP IS THE OFF-BY-ONE. Exactly `limit` waiting must show all of them
  // and say "and 0 others" to nobody.
  test('exactly the limit shows every name and hides none', () => {
    const s = waitingOnSummary(members('a', 'b', 'c'), new Set([]), 3)
    expect(s.shown).toEqual(['A', 'B', 'C'])
    expect(s.othersCount).toBe(0)
  })

  test('one over the limit shows the limit and hides exactly one', () => {
    const s = waitingOnSummary(members('a', 'b', 'c', 'd'), new Set([]), 3)
    expect(s.shown).toEqual(['A', 'B', 'C'])
    expect(s.othersCount).toBe(1)
  })

  test('a large team hides the rest and never grows the shown list', () => {
    const s = waitingOnSummary(members(...'abcdefghij'.split('')), new Set([]), 3)
    expect(s.shown).toHaveLength(3)
    expect(s.othersCount).toBe(7)
    // The full list is still returned, for the disclosure that reveals it.
    expect(s.waiting).toHaveLength(10)
  })

  test('everyone played leaves nothing to wait on', () => {
    const s = waitingOnSummary(members('a', 'b'), new Set(['a', 'b']), 3)
    expect(s.shown).toEqual([])
    expect(s.waiting).toEqual([])
    expect(s.othersCount).toBe(0)
    expect(s.playedCount).toBe(2)
  })

  test('an empty team is all zeroes, not a crash or a NaN', () => {
    const s = waitingOnSummary([], new Set([]), 3)
    expect(s).toEqual({ total: 0, playedCount: 0, waiting: [], shown: [], othersCount: 0 })
  })

  // A played id that is not on the team must not inflate the count past total.
  test('a stale played id for a departed member does not overcount', () => {
    const s = waitingOnSummary(members('a', 'b'), new Set(['a', 'gone']), 3)
    expect(s.playedCount).toBe(1)
    expect(s.total).toBe(2)
  })

  test('a limit of zero shows no names and hides them all', () => {
    const s = waitingOnSummary(members('a', 'b'), new Set([]), 0)
    expect(s.shown).toEqual([])
    expect(s.othersCount).toBe(2)
  })

  // A negative limit must clamp to zero, not slice from the end of the array
  // (Array.slice(0, -1) drops the last element rather than showing none).
  test('a negative limit behaves like zero, not a slice from the end', () => {
    const s = waitingOnSummary(members('a', 'b'), new Set([]), -1)
    expect(s.shown).toEqual([])
    expect(s.othersCount).toBe(2)
  })
})
