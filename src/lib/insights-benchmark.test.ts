import { describe, expect, test } from 'vitest'
import {
  benchmarkCredit,
  dayDifficulty,
  difficultyLabel,
  openerRank,
  type DifficultyBenchmark,
  type OpenerBenchmark,
} from './insights-benchmark'

const credit = {
  attribution: 'FiveLetterWords.io, research release v2026-09-01',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  citation: 'FiveLetterWords.io (2026-09-01). [Data set].',
}

const openers = (...words: string[]): OpenerBenchmark => ({
  ...credit,
  release: 'v2026-09-01',
  count: words.length,
  words: words.join(''),
})

const difficulty = (firstDay: string, ...percentiles: number[]): DifficultyBenchmark => ({
  ...credit,
  release: 'current',
  snapshotId: 'current-2026-09-07-3d47e96c14e42803',
  firstDay,
  count: percentiles.length,
  percentiles,
})

describe('openerRank', () => {
  test('rank is 1-based position, so it reads as "Nth of 14,855"', () => {
    const set = openers('slant', 'clast', 'alist')
    expect(openerRank(set, 'slant')).toBe(1)
    expect(openerRank(set, 'clast')).toBe(2)
    expect(openerRank(set, 'alist')).toBe(3)
  })

  test('our guesses are uppercase and the corpus is lowercase', () => {
    expect(openerRank(openers('slant', 'crane'), 'CRANE')).toBe(2)
    expect(openerRank(openers('slant', 'crane'), 'CrAnE')).toBe(2)
  })

  // The real openers our players entered that the corpus does not hold
  // (wordle-teams-0cmj). Absent must be null, never a rank.
  test.each(['XXXXX', 'ASDFG', 'CTANE', 'HJFOA'])('%s is absent, not rank 0', (word) => {
    expect(openerRank(openers('slant', 'crane', 'orate'), word)).toBeNull()
  })

  test('a word of the wrong length is absent rather than a partial match', () => {
    const set = openers('slant', 'crane')
    expect(openerRank(set, 'cran')).toBeNull()
    expect(openerRank(set, 'cranes')).toBeNull()
    expect(openerRank(set, '')).toBeNull()
  })

  /**
   * The hazard the packed encoding creates. `words` is one concatenated string, so
   * a naive indexOf matches across a word boundary and would invent a rank for a
   * word that is not in the corpus.
   */
  test('a match straddling two words is not a rank', () => {
    // 'crane' + 'sloth' contains 'anesl' at offset 2.
    const set = openers('crane', 'sloth')
    expect(set.words).toContain('anesl')
    expect(openerRank(set, 'anesl')).toBeNull()
  })

  test('a straddling match does not hide a real one that follows it', () => {
    // 'anesl' straddles at offset 2; the same five letters are also a real entry
    // at offset 10. Resuming the scan past the straddle must still find it.
    const set = openers('crane', 'sloth', 'anesl')
    expect(openerRank(set, 'anesl')).toBe(3)
  })

  test('a real entry OVERLAPPING its own straddle is still found', () => {
    // The case that pins how far the scan resumes. 'aaaaa' straddles at offset 1
    // and is a genuine entry at offset 5 — four characters later, INSIDE the
    // straddle. Resuming at `at + 5` rather than `at + 1` steps clean over the
    // real match and reports the word as absent. Mutation-checked: without this,
    // that stride change survives the whole suite.
    const set = openers('xaaaa', 'aaaaa')
    expect(openerRank(set, 'aaaaa')).toBe(2)
  })

  test('a word appearing only as a straddle late in the list is still absent', () => {
    const set = openers('aaaaa', 'bbbbb', 'crane', 'sloth')
    expect(openerRank(set, 'anesl')).toBeNull()
  })
})

describe('difficultyLabel', () => {
  // Both sides of every boundary, because a threshold tested on one side is
  // vacuous — the spec says so about Layer 4 and it is just as true here.
  test.each([
    [0, 'Easier for the solver'],
    [34, 'Easier for the solver'],
    [35, 'Middle of the pack'],
    [64, 'Middle of the pack'],
    [65, 'Tricky'],
    [89, 'Tricky'],
    [90, 'Hard for the solver'],
    [100, 'Hard for the solver'],
  ])('%i is %s', (percentile, label) => {
    expect(difficultyLabel(percentile)).toBe(label)
  })
})

describe('dayDifficulty', () => {
  const set = difficulty('2021-06-19', 19, 28, 95)

  test('the first day is index 0', () => {
    expect(dayDifficulty(set, '2021-06-19')).toEqual({
      percentile: 19,
      label: 'Easier for the solver',
    })
  })

  test('later days are offsets from the first', () => {
    expect(dayDifficulty(set, '2021-06-20')?.percentile).toBe(28)
    expect(dayDifficulty(set, '2021-06-21')).toEqual({
      percentile: 95,
      label: 'Hard for the solver',
    })
  })

  test('a day before the corpus begins is absent, not percentile 0', () => {
    expect(dayDifficulty(set, '2021-06-18')).toBeNull()
    expect(dayDifficulty(set, '2020-01-01')).toBeNull()
  })

  // The common miss rather than an edge case: today is always past the end, and
  // so is every day since the corpus was last refreshed.
  test('a day past the end of the corpus is absent', () => {
    expect(dayDifficulty(set, '2021-06-22')).toBeNull()
    expect(dayDifficulty(set, '2026-09-08')).toBeNull()
  })

  test('crosses month and year boundaries by real day count', () => {
    const long = difficulty('2021-12-30', ...Array.from({ length: 5 }, (_, i) => i * 10))
    expect(long.percentiles).toHaveLength(5)
    expect(dayDifficulty(long, '2021-12-31')?.percentile).toBe(10)
    expect(dayDifficulty(long, '2022-01-01')?.percentile).toBe(20)
    expect(dayDifficulty(long, '2022-01-03')?.percentile).toBe(40)
  })

  test('spans a leap day without drifting', () => {
    const leap = difficulty('2024-02-28', 1, 2, 3)
    expect(dayDifficulty(leap, '2024-02-29')?.percentile).toBe(2)
    expect(dayDifficulty(leap, '2024-03-01')?.percentile).toBe(3)
  })
})

describe('benchmarkCredit', () => {
  test('reads attribution out of the artifact so it cannot drift from the data', () => {
    const set = {
      openers: openers('slant'),
      difficulty: difficulty('2021-06-19', 19),
    }
    expect(benchmarkCredit(set)).toEqual({
      attribution: 'FiveLetterWords.io, research release v2026-09-01',
      licence: 'CC BY 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
      citation: 'FiveLetterWords.io (2026-09-01). [Data set].',
      release: 'v2026-09-01',
      snapshotId: 'current-2026-09-07-3d47e96c14e42803',
    })
  })
})
