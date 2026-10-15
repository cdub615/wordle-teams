import { describe, expect, test } from 'vitest'
import { pointsFor } from '../scoring.ts'
import { COMPETITIVE_SYSTEM, DEFAULT_SYSTEM } from '../scoringSystem.ts'
import { CLUE_LADDER_FAILED_POINTS, clueLadderSystem } from './points.ts'

describe('clueLadderSystem', () => {
  test('X is fixed at -1 whatever the team uses', () => {
    expect(CLUE_LADDER_FAILED_POINTS).toBe(-1)
    expect(pointsFor(7, clueLadderSystem(DEFAULT_SYSTEM))).toBe(-1)
    expect(pointsFor(7, clueLadderSystem(COMPETITIVE_SYSTEM))).toBe(-1)
  })

  test('every other value is the team\'s own', () => {
    const system = clueLadderSystem(COMPETITIVE_SYSTEM)
    for (const attempts of [1, 2, 3, 4, 5, 6, 0]) {
      expect(pointsFor(attempts, system)).toBe(pointsFor(attempts, COMPETITIVE_SYSTEM))
    }
  })

  test('does not mutate the team system', () => {
    const team = { ...DEFAULT_SYSTEM }
    clueLadderSystem(team)
    expect(team.failed).toBe(DEFAULT_SYSTEM.failed)
  })
})
