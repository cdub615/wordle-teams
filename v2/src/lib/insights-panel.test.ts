import { describe, expect, test } from 'vitest'
import {
  benchmarkFor,
  difficultySentence,
  openerRankSentence,
  upsellFor,
} from './insights-panel'
import type { InsightsBenchmark } from './insights-benchmark'

const credit = {
  attribution: 'FiveLetterWords.io, research release v2026-09-01',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  citation: 'FiveLetterWords.io (2026-09-01). [Data set].',
}

const benchmark = (words: string[], firstDay: string, percentiles: number[]): InsightsBenchmark => ({
  openers: { ...credit, release: 'v2026-09-01', count: words.length, words: words.join('') },
  difficulty: {
    ...credit,
    release: 'current',
    snapshotId: 'current-2026-09-07-abc',
    firstDay,
    count: percentiles.length,
    percentiles,
  },
})

const set = benchmark(['slant', 'crane', 'orate'], '2026-09-01', [10, 50, 95])

describe('benchmarkFor', () => {
  test('reports the opener rank and the day difficulty together', () => {
    const result = benchmarkFor(set, { puzzleDay: '2026-09-03', guesses: ['CRANE', 'SPEED'] })
    expect(result.opener).toEqual({ word: 'CRANE', rank: 2, outOf: 3 })
    expect(result.difficulty).toEqual({ percentile: 95, label: 'Hard for the solver' })
  })

  /**
   * THE HALVES ARE INDEPENDENT, and this is the case that proves it matters: a
   * board played today has no difficulty row — the corpus publishes only
   * globally completed days — but its opener rank is perfectly good. Collapsing
   * both into one "no benchmark" would throw away the working half on the single
   * most common board there is.
   */
  test('an uncovered day still reports the opener rank', () => {
    const result = benchmarkFor(set, { puzzleDay: '2026-12-25', guesses: ['ORATE'] })
    expect(result.difficulty).toBeNull()
    expect(result.opener).toEqual({ word: 'ORATE', rank: 3, outOf: 3 })
  })

  test('an unknown opener still reports the day difficulty', () => {
    const result = benchmarkFor(set, { puzzleDay: '2026-09-02', guesses: ['XXXXX'] })
    expect(result.opener).toBeNull()
    expect(result.difficulty).toEqual({ percentile: 50, label: 'Middle of the pack' })
  })

  // Absent must be null so the UI cannot render a confident zero.
  test.each([['XXXXX'], ['ASDFG'], ['CTANE']])('%s is absent, never rank 0', (word) => {
    expect(benchmarkFor(set, { puzzleDay: '2026-09-01', guesses: [word] }).opener).toBeNull()
  })

  test('a board with no guesses at all has no opener', () => {
    const result = benchmarkFor(set, { puzzleDay: '2026-09-01', guesses: [] })
    expect(result.opener).toBeNull()
    expect(result.difficulty).not.toBeNull()
  })

  test('normalises our uppercase guesses against the lowercase corpus', () => {
    expect(benchmarkFor(set, { puzzleDay: '2026-09-01', guesses: ['slant'] }).opener?.rank).toBe(1)
    expect(benchmarkFor(set, { puzzleDay: '2026-09-01', guesses: ['SLANT'] }).opener?.rank).toBe(1)
  })
})

describe('openerRankSentence', () => {
  test.each([
    [1, '1st of 14,855'],
    [2, '2nd of 14,855'],
    [3, '3rd of 14,855'],
    [4, '4th of 14,855'],
    [11, '11th of 14,855'],
    [12, '12th of 14,855'],
    [13, '13th of 14,855'],
    [21, '21st of 14,855'],
    [4102, '4,102nd of 14,855'],
    [14855, '14,855th of 14,855'],
  ])('rank %i reads as %s', (rank, sentence) => {
    expect(openerRankSentence({ word: 'CRANE', rank, outOf: 14855 })).toBe(sentence)
  })
})

describe('difficultySentence', () => {
  test('phrases the percentile as a comparison rather than a score', () => {
    expect(difficultySentence({ percentile: 87, label: 'Tricky' })).toBe(
      'Harder than 87% of past puzzles',
    )
  })
})

describe('upsellFor', () => {
  test('a free player with a board is told what pro adds', () => {
    expect(upsellFor({ layer1: 'free', boardCount: 1 })).toContain('every board')
  })

  test('a pro player is not sold anything', () => {
    expect(upsellFor({ layer1: 'full', boardCount: 40 })).toBeNull()
  })

  test('a player with no boards gets an empty state, not a pitch', () => {
    // Selling history to someone who has none is the wrong first impression.
    expect(upsellFor({ layer1: 'free', boardCount: 0 })).toBeNull()
  })
})
