import { describe, expect, test } from 'vitest'
import { monthOptions } from './month-picker'

describe('monthOptions', () => {
  test('returns exactly three months, NEWEST FIRST, starting at the month passed in', () => {
    // DESCENDING, which is the owner's call and a deliberate divergence from v1
    // (wordle-teams-l23h) — v1's getMonthsFromScoreDate walks forward and pushes
    // the current month last. The month a reader almost always wants is the
    // current one, and it belongs at the top rather than at the end of a list
    // that the pro gate will make much longer.
    expect(monthOptions('2026-08')).toEqual(['2026-08', '2026-07', '2026-06'])
  })

  test('walks back correctly across a year boundary', () => {
    expect(monthOptions('2026-01')).toEqual(['2026-01', '2025-12', '2025-11'])
  })

  test('the first entry is the month passed in, and the last is the oldest', () => {
    // ASSERTED AS A DIRECTION, not only as a literal array, so a mutation that
    // reverses the list is named by the failure rather than showing up as two
    // arrays a reader has to diff.
    const options = monthOptions('2026-08')

    expect(options[0]).toBe('2026-08')
    expect(options[options.length - 1]).toBe('2026-06')
    // And strictly monotonic. PuzzleMonth is 'YYYY-MM', so lexical comparison IS
    // chronological comparison — which is what makes this cheap rather than a
    // date parse per entry, and it stays true when the pro gate lengthens the
    // list.
    expect([...options].sort().reverse()).toEqual(options)
  })
})
