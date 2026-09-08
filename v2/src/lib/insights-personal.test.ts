import { describe, expect, test } from 'vitest'
import {
  MIN_BOARDS_FOR_STATS,
  attemptsByMonth,
  consistency,
  headlineComparison,
  isThin,
  openerRepertoire,
  streaks,
  type PersonalBoard,
} from './insights-personal'
import type { OpenerBenchmark } from './insights-benchmark'

const openers: OpenerBenchmark = {
  attribution: 'FiveLetterWords.io, research release v2026-09-01',
  licence: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  citation: 'x',
  release: 'v2026-09-01',
  count: 3,
  words: 'slantcraneorate',
}

/** A solved board in `n` guesses on `day`, opening with `opener`. */
const board = (day: string, opener: string, n: number): PersonalBoard => ({
  puzzleDay: day,
  answer: 'SPEED',
  guesses: [opener, ...Array.from({ length: n - 2 }, () => 'MOIST'), 'SPEED'].slice(0, n),
})

describe('isThin', () => {
  test('under the minimum is thin, at it is not', () => {
    const boards = Array.from({ length: MIN_BOARDS_FOR_STATS }, (_, i) =>
      board(`2026-09-0${i + 1}`, 'CRANE', 4),
    )
    expect(isThin(boards.slice(0, MIN_BOARDS_FOR_STATS - 1))).toBe(true)
    expect(isThin(boards)).toBe(false)
  })

  test('no boards at all is thin, not an error', () => {
    // The designed state for 368 of 392 accounts, per the spec.
    expect(isThin([])).toBe(true)
  })
})

describe('openerRepertoire', () => {
  test('counts each opener and means its attempts, joined to the rank', () => {
    const rows = openerRepertoire(
      [
        board('2026-09-01', 'CRANE', 4),
        board('2026-09-02', 'CRANE', 3),
        board('2026-09-03', 'ORATE', 5),
      ],
      openers,
    )
    expect(rows).toEqual([
      { word: 'CRANE', count: 2, meanAttempts: 3.5, rank: 2 },
      { word: 'ORATE', count: 1, meanAttempts: 5, rank: 3 },
    ])
  })

  /**
   * The row stays. Dropping it would hide the player's own history because a
   * third party's word list is incomplete — 26 of our real boards are like this.
   */
  test('an opener the corpus does not hold keeps its counts and gets a null rank', () => {
    const rows = openerRepertoire([board('2026-09-01', 'XXXXX', 4)], openers)
    expect(rows).toEqual([{ word: 'XXXXX', count: 1, meanAttempts: 4, rank: null }])
  })

  test('is ordered by count, then alphabetically, so it is stable', () => {
    const rows = openerRepertoire(
      [
        board('2026-09-01', 'ORATE', 4),
        board('2026-09-02', 'CRANE', 4),
        board('2026-09-03', 'SLANT', 4),
        board('2026-09-04', 'SLANT', 4),
      ],
      openers,
    )
    expect(rows.map((r) => r.word)).toEqual(['SLANT', 'CRANE', 'ORATE'])
  })

  test('normalises case, since the corpus is lowercase and our guesses are not', () => {
    const rows = openerRepertoire(
      [
        { puzzleDay: '2026-09-01', answer: 'SPEED', guesses: ['crane', 'SPEED'] },
        { puzzleDay: '2026-09-02', answer: 'SPEED', guesses: ['CRANE', 'SPEED'] },
      ],
      openers,
    )
    expect(rows).toEqual([{ word: 'CRANE', count: 2, meanAttempts: 2, rank: 2 }])
  })

  test('a board with no guesses contributes nothing rather than an empty opener', () => {
    const rows = openerRepertoire(
      [{ puzzleDay: '2026-09-01', guesses: [] }, board('2026-09-02', 'CRANE', 3)],
      openers,
    )
    expect(rows).toEqual([{ word: 'CRANE', count: 1, meanAttempts: 3, rank: 2 }])
  })

  /**
   * A FAILED BOARD IS 7, NOT 6, and it must come from attemptsFor rather than
   * guesses.length — this is the board a player most wants explained, so getting
   * it wrong is worse than not showing it.
   */
  test('a failed board counts as 7 attempts', () => {
    const failed: PersonalBoard = {
      puzzleDay: '2026-09-01',
      answer: 'SPEED',
      guesses: ['CRANE', 'MOIST', 'MOIST', 'MOIST', 'MOIST', 'MOIST'],
    }
    expect(openerRepertoire([failed], openers)[0].meanAttempts).toBe(7)
  })

  test("and a copied v1 failure with its '' sentinel is still 7, not 8", () => {
    // v1's upsertBoard appended '' to a failed six-guess board, so copied rows
    // can hold seven entries. A length would report 7 guesses on a 6-guess board
    // and 8 here.
    const copied: PersonalBoard = {
      puzzleDay: '2026-09-01',
      answer: 'SPEED',
      guesses: ['CRANE', 'MOIST', 'MOIST', 'MOIST', 'MOIST', 'MOIST', ''],
    }
    expect(openerRepertoire([copied], openers)[0].meanAttempts).toBe(7)
  })

  test('a row with no answer does not break the statistic', () => {
    // dailyScores.answer is v.optional. `?? ''` matches convex/lib/scoring.ts.
    const rows = openerRepertoire([{ puzzleDay: '2026-09-01', guesses: ['CRANE', 'SPEED'] }], openers)
    expect(rows[0].count).toBe(1)
    expect(Number.isFinite(rows[0].meanAttempts)).toBe(true)
  })
})

describe('headlineComparison', () => {
  test('pairs the two most-used openers, which is the spec sentence', () => {
    const rows = openerRepertoire(
      [
        board('2026-09-01', 'CRANE', 4),
        board('2026-09-02', 'CRANE', 5),
        board('2026-09-03', 'ORATE', 3),
      ],
      openers,
    )
    const headline = headlineComparison(rows)
    expect(headline?.most.word).toBe('CRANE')
    expect(headline?.other.word).toBe('ORATE')
  })

  test('is null with only one opener, because there is nothing to compare', () => {
    const rows = openerRepertoire([board('2026-09-01', 'CRANE', 4)], openers)
    expect(headlineComparison(rows)).toBeNull()
  })

  test('and null with none', () => {
    expect(headlineComparison([])).toBeNull()
  })
})

describe('attemptsByMonth', () => {
  test('groups on the puzzle day’s month, oldest first', () => {
    const rows = attemptsByMonth([
      board('2026-09-01', 'CRANE', 4),
      board('2026-08-31', 'CRANE', 2),
      board('2026-09-30', 'CRANE', 6),
    ])
    expect(rows).toEqual([
      { month: '2026-08', boards: 1, meanAttempts: 2 },
      { month: '2026-09', boards: 2, meanAttempts: 5 },
    ])
  })

  test('is empty for no boards rather than throwing', () => {
    expect(attemptsByMonth([])).toEqual([])
  })
})

describe('streaks', () => {
  test('counts consecutive days', () => {
    expect(
      streaks([
        board('2026-09-01', 'CRANE', 4),
        board('2026-09-02', 'CRANE', 4),
        board('2026-09-03', 'CRANE', 4),
      ]),
    ).toEqual({ current: 3, longest: 3 })
  })

  test('a gap ends a run, and the longest is remembered', () => {
    expect(
      streaks([
        board('2026-09-01', 'CRANE', 4),
        board('2026-09-02', 'CRANE', 4),
        board('2026-09-03', 'CRANE', 4),
        // gap
        board('2026-09-06', 'CRANE', 4),
      ]),
    ).toEqual({ current: 1, longest: 3 })
  })

  test('crosses a month boundary', () => {
    expect(
      streaks([board('2026-08-31', 'CRANE', 4), board('2026-09-01', 'CRANE', 4)]),
    ).toEqual({ current: 2, longest: 2 })
  })

  test('crosses a leap day', () => {
    expect(
      streaks([
        board('2024-02-28', 'CRANE', 4),
        board('2024-02-29', 'CRANE', 4),
        board('2024-03-01', 'CRANE', 4),
      ]),
    ).toEqual({ current: 3, longest: 3 })
  })

  /**
   * Production holds five duplicate (player, day) pairs — wordle-teams-rac.
   *
   * THE DUPLICATE MUST BE INSIDE A RUN, which is the whole point and is what an
   * earlier version of this test got wrong. Two rows on a single isolated day
   * cannot distinguish deduplication from its absence: the gap between a day and
   * itself is zero, so it never counts as a next day either way, and that test
   * passed with the deduplication deleted. A duplicate does not inflate a streak,
   * it BREAKS one.
   */
  test('a duplicate day inside a run does not break the run', () => {
    expect(
      streaks([
        board('2026-09-01', 'CRANE', 4),
        board('2026-09-02', 'CRANE', 4),
        board('2026-09-02', 'ORATE', 5), // the duplicate
        board('2026-09-03', 'CRANE', 4),
      ]),
    ).toEqual({ current: 3, longest: 3 })
  })

  test('and two rows on one isolated day are still one day', () => {
    expect(
      streaks([board('2026-09-01', 'CRANE', 4), board('2026-09-01', 'ORATE', 5)]),
    ).toEqual({ current: 1, longest: 1 })
  })

  test('is order-independent, since rows arrive newest-first', () => {
    expect(
      streaks([board('2026-09-03', 'CRANE', 4), board('2026-09-01', 'CRANE', 4), board('2026-09-02', 'CRANE', 4)]),
    ).toEqual({ current: 3, longest: 3 })
  })

  test('no boards is zero, not a crash', () => {
    expect(streaks([])).toEqual({ current: 0, longest: 0 })
  })
})

describe('consistency', () => {
  test('reports the mean, the spread, and how many were solved', () => {
    const result = consistency([
      board('2026-09-01', 'CRANE', 3),
      board('2026-09-02', 'CRANE', 5),
    ])
    expect(result.meanAttempts).toBe(4)
    expect(result.spread).toBe(1)
    expect(result).toMatchObject({ solved: 2, failed: 0 })
  })

  test('counts a failure as failed and as 7 attempts', () => {
    const result = consistency([
      {
        puzzleDay: '2026-09-01',
        answer: 'SPEED',
        guesses: ['CRANE', 'MOIST', 'MOIST', 'MOIST', 'MOIST', 'MOIST'],
      },
    ])
    expect(result).toMatchObject({ meanAttempts: 7, failed: 1, solved: 0 })
  })

  test('a single board has zero spread rather than a divide by zero', () => {
    expect(consistency([board('2026-09-01', 'CRANE', 4)]).spread).toBe(0)
  })

  test('no boards is all zeros rather than NaN', () => {
    expect(consistency([])).toEqual({ meanAttempts: 0, spread: 0, solved: 0, failed: 0 })
  })

  test('never reports -0', () => {
    // Math.round(-0.04 * 10) / 10 is -0, which renders as "-0.0".
    expect(Object.is(consistency([board('2026-09-01', 'CRANE', 4)]).spread, -0)).toBe(false)
  })
})
