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

/**
 * THE THREE TIERS ARE NOT A SPECTRUM, which is the whole reason this function
 * composes rather than branching on a boolean. insightsAccess (convex/lib/
 * insightsAccess.ts) grants:
 *
 *   free     layer1 'free'  layer2 'none'  layer3 'free'
 *   trial    layer1 'free'  layer2 'full'  layer3 'full'
 *   pro      layer1 'full'  layer2 'full'  layer3 'full'
 *
 * A TRIALIST'S LAYER 1 IS THE SAME 'free' AS A FREE PLAYER'S — the trial grants
 * the two upper layers and deliberately withholds the board list. So the tier
 * cannot be read off layer1, and a fixed sentence keyed to it pitched a
 * trialist the history and team panels already on their screen.
 */
describe('upsellFor', () => {
  const free = { layer1: 'free', layer2: 'none', layer3: 'free' } as const
  const trial = { layer1: 'free', layer2: 'full', layer3: 'full' } as const
  const pro = { layer1: 'full', layer2: 'full', layer3: 'full' } as const

  test('a free player on a team is told about all three locked layers', () => {
    const copy = upsellFor({ ...free, boardCount: 1, onATeam: true })
    expect(copy).toBe(
      'Free shows your most recent board and one team fact a day. Pro opens your full playing history, your team’s analytics, and every board you have ever entered.',
    )
  })

  /**
   * TeamSection RETURNS NULL FOR A PLAYER ON NO TEAM (routes/insights.tsx), and
   * a v1 migrant can be exactly that. Promising team analytics to someone with
   * no team promises something they cannot see even after paying.
   */
  test('a free player on no team is never promised team analytics', () => {
    const copy = upsellFor({ ...free, boardCount: 1, onATeam: false })
    expect(copy).toBe(
      'Free shows your most recent board. Pro opens your full playing history and every board you have ever entered.',
    )
    expect(copy).not.toMatch(/team/i)
  })

  /**
   * THE REGRESSION THIS ISSUE WAS FILED FOR, in the other direction. A trialist
   * already sees PersonalHistory and the full TeamPanel; the only thing still
   * withheld from them is the board list.
   */
  test('a trialist is pitched only the boards, not the history and team they already see', () => {
    const copy = upsellFor({ ...trial, boardCount: 40, onATeam: true })
    expect(copy).toBe(
      'Free shows your most recent board. Pro shows every board you have ever entered.',
    )
    expect(copy).not.toMatch(/history|team/i)
  })

  test('a pro player is not sold anything', () => {
    expect(upsellFor({ ...pro, boardCount: 40, onATeam: true })).toBeNull()
  })

  test('a player with no boards gets an empty state, not a pitch', () => {
    // Selling history to someone who has none is the wrong first impression.
    expect(upsellFor({ ...free, boardCount: 0, onATeam: true })).toBeNull()
  })

  /**
   * `onATeam` IS UNDEFINED UNTIL getMyTeams RESOLVES, and guessing costs a
   * visible edit to copy the reader may already be part-way through. The same
   * rule chat's roster resolution follows (src/lib/chat-roster.ts): withholding
   * for a few hundred milliseconds is quiet, asserting something and then
   * changing it is not.
   */
  test('an unresolved roster withholds the pitch rather than guessing at the team clause', () => {
    expect(upsellFor({ ...free, boardCount: 1, onATeam: undefined })).toBeNull()
  })

  /**
   * WHY THE PITCH WAS LEFT LAST ON THE PAGE, recorded as an assertion rather
   * than as an opinion.
   *
   * The page's order was corrected once already on the owner's feedback — "Your
   * Team and Your History are buried below miles of daily insights" — so a
   * pitch below DailyBenchmark invites the same objection. It does not carry,
   * and the reason is that the two conditions are mutually exclusive: the
   * "miles" are the day-by-day list, `boardsForLayer1` caps that list at ONE
   * board for anyone whose layer1 is not 'full', and layer1 not being 'full' is
   * the precise condition for the pitch existing at all. Nobody is ever shown
   * this sentence at the bottom of a long page.
   *
   * IF A FUTURE CHANGE BREAKS THAT PAIRING — layer1 granted to the free tier, or
   * the pitch shown to a pro player — this test fails, and placement becomes a
   * live question again rather than a settled one. That is what it is for.
   */
  test('the pitch and a long board list never appear on the same page', () => {
    const many = Array.from({ length: 400 }, (_, index) => index)

    for (const access of [free, trial]) {
      expect(upsellFor({ ...access, boardCount: many.length, onATeam: true })).not.toBeNull()
      expect(boardsForLayer1(many, access.layer1)).toHaveLength(1)
    }

    expect(upsellFor({ ...pro, boardCount: many.length, onATeam: true })).toBeNull()
    expect(boardsForLayer1(many, pro.layer1)).toHaveLength(400)
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
