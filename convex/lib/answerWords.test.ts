// convex/lib/answerWords.test.ts
/**
 * The list is pinned to one source commit (see answerWords.ts's header), so its
 * size is asserted EXACTLY: a truncated paste or a stray duplicate changes it.
 *
 * THE FIVE v1 GROUP WORDS, measured against this list on 2026-10-08: CRANE,
 * SLATE and STARE are answer words; ADIEU and ORATE are NOT. Both are therefore
 * grandfathered (spec v2 §4.2), and the last block pins that so a list swap that
 * changes it is a visible decision rather than a silent one.
 */
import { describe, expect, test } from 'vitest'
import { ANSWER_WORDS, isAnswerWord, normalizeWord } from './answerWords.ts'

describe('ANSWER_WORDS', () => {
  test('holds the 2,309 words of the pinned source', () => {
    expect(ANSWER_WORDS.size).toBe(2309)
  })

  test('every entry is five lowercase letters', () => {
    const bad = [...ANSWER_WORDS].filter((w) => !/^[a-z]{5}$/.test(w))
    expect(bad).toEqual([])
  })

  test.each(['crane', 'slate', 'stare', 'cigar', 'zonal'])('%s is an answer word', (w) => {
    expect(ANSWER_WORDS.has(w)).toBe(true)
  })
})

describe('normalizeWord', () => {
  test.each([
    ['crane', 'crane'],
    ['CRANE', 'crane'],
    ['  Crane\t', 'crane'],
    ['\nSLATE\n', 'slate'],
  ])('%j normalizes to %j', (input, out) => {
    expect(normalizeWord(input)).toBe(out)
  })

  test.each(['', '     ', 'cran', 'cranes', 'cr4ne', 'cr ne', 'cr-ne', 'crané', 'ＣＲＡＮＥ'])(
    '%j is not a word',
    (input) => {
      expect(normalizeWord(input)).toBeNull()
    },
  )
})

describe('isAnswerWord', () => {
  test.each(['crane', ' Crane ', 'SLATE', 'stare'])('%j is true', (input) => {
    expect(isAnswerWord(input)).toBe(true)
  })

  test.each(['xxxxx', 'cran', 'cranes', 'cr4ne', '', 'crane slate'])('%j is false', (input) => {
    expect(isAnswerWord(input)).toBe(false)
  })
})

describe('the v1 group words (decides grandfathering, spec v2 §4.2)', () => {
  test.each([
    ['crane', true],
    ['slate', true],
    ['stare', true],
    ['adieu', false],
    ['orate', false],
  ])('%s on the list: %s', (w, onList) => {
    expect(isAnswerWord(w)).toBe(onList)
  })
})
