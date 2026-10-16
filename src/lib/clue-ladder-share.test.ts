import { describe, expect, test } from 'vitest'
import { addDays } from '../../convex/lib/puzzleDay.ts'
import { CLUE_LADDER_DAY_ONE, clueLadderNumber, clueLadderShareText } from './clue-ladder-share.ts'

describe('clueLadderNumber', () => {
  test('day one is #1, and each day after adds one', () => {
    expect(clueLadderNumber(CLUE_LADDER_DAY_ONE)).toBe(1)
    expect(clueLadderNumber('2026-10-16')).toBe(2)
    expect(clueLadderNumber('2026-11-01')).toBe(18)
  })

  test('whole days across a clock change', () => {
    // US clocks go back on 2026-11-01; Europe's moved on 2026-10-25. Date.UTC
    // arithmetic is what guarantees whole days; under TZ=UTC (what CI runs) this
    // test cannot tell a local-time implementation from it.
    expect(clueLadderNumber('2026-11-02') - clueLadderNumber('2026-10-24')).toBe(9)
    // Spring forward: US 2027-03-14, Europe 2027-03-28.
    expect(clueLadderNumber('2027-03-29') - clueLadderNumber('2027-03-13')).toBe(16)
  })

  test('never below 1: a player a day behind plays the day before day one', () => {
    expect(clueLadderNumber(addDays(CLUE_LADDER_DAY_ONE, -1))).toBe(1)
    expect(clueLadderNumber(addDays(CLUE_LADDER_DAY_ONE, -5))).toBe(1)
  })
})

describe('clueLadderShareText', () => {
  test('solved names the clue; failed is an X', () => {
    expect(clueLadderShareText({ date: '2026-10-20', status: 'solved', lockedAtClue: 3 })).toBe(
      'Clue ladder #6: solved on clue 3',
    )
    expect(clueLadderShareText({ date: '2026-10-20', status: 'failed', lockedAtClue: 2 })).toBe('Clue ladder #6: X')
  })
})
