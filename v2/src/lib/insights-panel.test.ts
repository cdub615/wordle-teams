import { describe, expect, test } from 'vitest'
import {
  ALL,
  benchmarkFor,
  boardsForLayer1,
  filterBoards,
  monthOptionsFor,
  openerOptionsFor,
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

const day = (puzzleDay: string, opener: string) => ({ puzzleDay, guesses: [opener, 'SPEED'] })

describe('boardsForLayer1', () => {
  const boards = [day('2026-09-03', 'CRANE'), day('2026-09-02', 'ORATE'), day('2026-09-01', 'SLANT')]

  test('pro sees every board', () => {
    expect(boardsForLayer1(boards, 'full')).toHaveLength(3)
  })

  /**
   * THE LEAK THIS FIXES. The query returns full history whenever Layer 2 is
   * unlocked, and the TRIAL unlocks Layer 2 without Layer 1 — so a trialist's
   * payload holds every board while their Layer 1 access is still 'free'.
   * Rendering the payload directly showed them the paid benchmark list.
   */
  test('free sees only the most recent board, however many the payload holds', () => {
    expect(boardsForLayer1(boards, 'free')).toEqual([day('2026-09-03', 'CRANE')])
  })

  test('and the server has already put the most recently ENTERED board first', () => {
    // Not the latest puzzle day — see convex/insights.ts. Order is the server's.
    const backfilled = [day('2026-08-30', 'ORATE'), day('2026-09-07', 'CRANE')]
    expect(boardsForLayer1(backfilled, 'free')).toEqual([day('2026-08-30', 'ORATE')])
  })

  test('no boards stays no boards rather than throwing', () => {
    expect(boardsForLayer1([], 'free')).toEqual([])
  })
})

describe('monthOptionsFor', () => {
  test('lists the months with boards, most recent first', () => {
    expect(
      monthOptionsFor([day('2026-08-31', 'CRANE'), day('2026-09-01', 'ORATE'), day('2026-09-30', 'CRANE')]),
    ).toEqual(['2026-09', '2026-08'])
  })

  test('is empty with no boards', () => {
    expect(monthOptionsFor([])).toEqual([])
  })
})

describe('openerOptionsFor', () => {
  test('orders by the player’s own use, matching the repertoire panel', () => {
    const boards = [
      day('2026-09-01', 'ORATE'),
      day('2026-09-02', 'CRANE'),
      day('2026-09-03', 'CRANE'),
    ]
    expect(openerOptionsFor(boards)).toEqual(['CRANE', 'ORATE'])
  })

  test('normalises case and skips a board with no guesses', () => {
    const boards = [
      { puzzleDay: '2026-09-01', guesses: ['crane', 'SPEED'] },
      { puzzleDay: '2026-09-02', guesses: [] },
    ]
    expect(openerOptionsFor(boards)).toEqual(['CRANE'])
  })
})

describe('filterBoards', () => {
  const boards = [
    day('2026-09-03', 'CRANE'),
    day('2026-09-02', 'ORATE'),
    day('2026-08-30', 'CRANE'),
  ]

  test('ALL on both is everything', () => {
    expect(filterBoards(boards, { month: ALL, opener: ALL })).toHaveLength(3)
  })

  test('filters by month alone', () => {
    expect(filterBoards(boards, { month: '2026-09', opener: ALL })).toHaveLength(2)
  })

  test('filters by opener alone', () => {
    expect(filterBoards(boards, { month: ALL, opener: 'CRANE' })).toHaveLength(2)
  })

  test('and the two combine, so "CRANE in September" is reachable', () => {
    expect(filterBoards(boards, { month: '2026-09', opener: 'CRANE' })).toEqual([
      day('2026-09-03', 'CRANE'),
    ])
  })

  test('a combination matching nothing is empty rather than everything', () => {
    // The failure that would make a filter look broken: falling back to unfiltered.
    expect(filterBoards(boards, { month: '2026-08', opener: 'ORATE' })).toEqual([])
  })
})
