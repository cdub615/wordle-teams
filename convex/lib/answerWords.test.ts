// convex/lib/answerWords.test.ts
/**
 * The list is pinned to one source commit (see answerWords.ts's header), so its
 * size is asserted EXACTLY: a truncated paste or a stray duplicate changes it.
 *
 * THE FIVE v1 GROUP WORDS, measured against this list on 2026-10-08: all five
 * (CRANE, SLATE, ADIEU, STARE, ORATE) are answer words, so none is grandfathered
 * (spec v2 §4.2). The last block pins that, so a list swap that changes it is a
 * visible decision rather than a silent one.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ANSWER_WORDS, isAnswerWord, normalizeWord } from './answerWords.ts'

describe('ANSWER_WORDS', () => {
  test('holds the 3,158 words of the pinned source', () => {
    expect(ANSWER_WORDS.size).toBe(3158)
  })

  /**
   * FNV-1a (32-bit) over the words joined by single spaces. The size test cannot
   * see a substituted word; this can. Recompute it only alongside a deliberate,
   * source-pinned list change.
   */
  test('matches the fingerprint of the pinned source', () => {
    let h = 0x811c9dc5
    for (const ch of [...ANSWER_WORDS].join(' ')) {
      h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0
    }
    expect(h.toString(16)).toBe('f5c03d3c')
  })

  test('every entry is five lowercase letters', () => {
    const bad = [...ANSWER_WORDS].filter((w) => !/^[a-z]{5}$/.test(w))
    expect(bad).toEqual([])
  })

  test.each(['crane', 'slate', 'stare', 'cigar', 'zonal'])('%s is an answer word', (w) => {
    expect(ANSWER_WORDS.has(w)).toBe(true)
  })
})

describe('popular openers (spot check against the source, 2026-10-08)', () => {
  test.each([
    ['audio', true],
    ['raise', true],
    ['arise', true],
    ['roate', false],
    ['soare', false],
    ['salet', false],
    ['tares', false],
  ])('%s on the list: %s', (w, onList) => {
    expect(isAnswerWord(w)).toBe(onList)
  })
})

describe('normalizeWord', () => {
  test.each([
    ['crane', 'crane'],
    ['CRANE', 'crane'],
    ['  Crane\t', 'crane'],
    ['\nSLATE\n', 'slate'],
    ['ＣＲＡＮＥ', 'crane'],
    ['cr\u200Bane', 'crane'],
    ['\uFEFFcrane\u200D', 'crane'],
    ['c\u200Cr\u200Dane', 'crane'],
  ])('%j normalizes to %j', (input, out) => {
    expect(normalizeWord(input)).toBe(out)
  })

  test.each(['', '     ', 'cran', 'cranes', 'cr4ne', 'cr ne', 'cr-ne', 'crané', 'cra\u0301ne', 'ÀDIEU', 'naïve'])(
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
    ['adieu', true],
    ['orate', true],
  ])('%s on the list: %s', (w, onList) => {
    expect(isAnswerWord(w)).toBe(onList)
  })
})

/**
 * MIT: "The above copyright notice and this permission notice shall be included
 * in all copies". Vite strips comments from client bundles, so the served file
 * is what carries the notice to the browser; the source header carries it in the
 * repo. Both must hold the full text, not a summary.
 */
describe('the MIT notice travels with the list', () => {
  const SOURCE_URL =
    'https://github.com/alex1770/wordle/blob/8fd3f1bdf884ff6757c24ad1227dc561fab7787d/wordlist_nyt20230701_hidden'
  const NOTICE_LINES = [
    'Copyright (c) 2022 Alex Selby (github alex1770)',
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'The above copyright notice and this permission notice shall be included in all',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
  ]
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  test.each([
    ['convex/lib/answerWords.ts', './answerWords.ts'],
    ['public/third-party-notices.txt', '../../public/third-party-notices.txt'],
  ])('%s holds the source URL and the full licence text', (_name, path) => {
    const text = read(path)
    expect(text).toContain(SOURCE_URL)
    for (const line of NOTICE_LINES) expect(text).toContain(line)
  })
})
