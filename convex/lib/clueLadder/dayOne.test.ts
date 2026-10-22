import { describe, expect, test } from 'vitest'
import { addDays } from '../puzzleDay.ts'
import { CLUE_LADDER_DAY_ONE, clueLadderCountsFrom } from './dayOne.ts'

const at = (day: string, time = '12:00:00Z') => Date.parse(`${day}T${time}`)

describe('clueLadderCountsFrom', () => {
  test('a stored switch-on day wins, even one before the launch day', () => {
    const stored = addDays(CLUE_LADDER_DAY_ONE, -3)
    expect(clueLadderCountsFrom({ clueLadderOnSince: stored, createdAt: at(CLUE_LADDER_DAY_ONE), _creationTime: 0 })).toBe(stored)
  })

  test('a team created before launch counts from the launch day', () => {
    expect(clueLadderCountsFrom({ createdAt: at(addDays(CLUE_LADDER_DAY_ONE, -400)), _creationTime: 0 })).toBe(CLUE_LADDER_DAY_ONE)
  })

  test('a team created after launch counts from its creation day, in UTC', () => {
    const later = addDays(CLUE_LADDER_DAY_ONE, 30)
    expect(clueLadderCountsFrom({ createdAt: at(later, '23:59:59Z'), _creationTime: 0 })).toBe(later)
    expect(clueLadderCountsFrom({ createdAt: at(later, '00:00:00Z'), _creationTime: 0 })).toBe(later)
  })

  test('_creationTime stands in for a missing createdAt', () => {
    const later = addDays(CLUE_LADDER_DAY_ONE, 5)
    expect(clueLadderCountsFrom({ _creationTime: at(later) })).toBe(later)
    expect(clueLadderCountsFrom({ createdAt: at(addDays(CLUE_LADDER_DAY_ONE, -1)), _creationTime: at(later) })).toBe(
      CLUE_LADDER_DAY_ONE,
    )
  })
})
