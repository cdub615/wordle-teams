import { describe, expect, test } from 'vitest'
import { CLUE_LADDER_ON, clueLadderSwitchOn } from './flag.ts'

describe('clueLadderSwitchOn', () => {
  test('only the exact string turns it on', () => {
    expect(clueLadderSwitchOn(CLUE_LADDER_ON)).toBe(true)
    expect(clueLadderSwitchOn('true')).toBe(true)
  })

  test.each([undefined, '', 'TRUE', '1', 'yes', ' true'])('%j leaves it off', (value) => {
    expect(clueLadderSwitchOn(value)).toBe(false)
  })
})
