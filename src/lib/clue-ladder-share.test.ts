import { describe, expect, test } from 'vitest'
import { CLUE_LADDER_DAY_ONE, clueLadderNumber, clueLadderShareText } from './clue-ladder-share.ts'

describe('clueLadderNumber', () => {
  test('day one is #1, and each day after adds one', () => {
    expect(clueLadderNumber(CLUE_LADDER_DAY_ONE)).toBe(1)
    expect(clueLadderNumber('2026-10-16')).toBe(2)
    expect(clueLadderNumber('2026-11-01')).toBe(18)
  })

  test('whole days across a clock change', () => {
    // US clocks go back on 2026-11-01; Europe's moved on 2026-10-25.
    expect(clueLadderNumber('2026-11-02') - clueLadderNumber('2026-10-24')).toBe(9)  })
})

describe('clueLadderShareText', () => {
  test('solved names the clue; failed is an X', () => {
    expect(clueLadderShareText({ date: '2026-10-20', status: 'solved', lockedAtClue: 3 })).toBe(
      'Clue ladder #6: solved on clue 3',
    )
    expect(clueLadderShareText({ date: '2026-10-20', status: 'failed', lockedAtClue: 2 })).toBe('Clue ladder #6: X')
  })
})
