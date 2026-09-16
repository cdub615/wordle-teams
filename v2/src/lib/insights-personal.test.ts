import { describe, expect, test } from 'vitest'
import {
  MIN_BOARDS_FOR_STATS,
  TRAILING_FORM_MIN_BOARDS,
  TRAILING_FORM_WINDOW,
  attemptDistribution,
  attemptsByMonth,
  consistency,
  headlineComparison,
  isThin,
  openerAdvice,
  openerRepertoire,
  streaks,
  trailingForm,
  type OpenerRow,
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

/** An unsolved board: six guesses, none the answer. */
const failed = (day: string, opener: string): PersonalBoard => ({
  puzzleDay: day,
  answer: 'SPEED',
  guesses: [opener, 'MOIST', 'MOIST', 'MOIST', 'MOIST', 'MOIST'],
})

/** The i-th day after 2026-01-01, as a puzzleDay string. */
const dateAt = (i: number): string =>
  new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)

/** An OpenerRow with the fields openerAdvice actually reads. Rank is unused here. */
const openerRow = (word: string, count: number, meanAttempts: number): OpenerRow => ({
  word,
  count,
  meanAttempts,
  rank: null,
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

describe('attemptDistribution', () => {
  test('it counts 1 through 6 and folds the failure sentinel into X', () => {
    const rows = attemptDistribution([
      board('2026-08-01', 'CRANE', 3),
      board('2026-08-02', 'CRANE', 3),
      board('2026-08-03', 'CRANE', 4),
      failed('2026-08-04', 'CRANE'),
    ])
    expect(rows.map((r) => r.label)).toEqual(['1', '2', '3', '4', '5', '6', 'X'])
    expect(rows.find((r) => r.label === '3')!.count).toBe(2)
    expect(rows.find((r) => r.label === '4')!.count).toBe(1)
    expect(rows.find((r) => r.label === 'X')!.count).toBe(1)
  })

  test('the modal row is the most common, and ties go to the lower attempt count', () => {
    const rows = attemptDistribution([
      board('2026-08-01', 'CRANE', 3),
      board('2026-08-02', 'CRANE', 4),
    ])
    expect(rows.find((r) => r.isModal)!.label).toBe('3')
    expect(rows.filter((r) => r.isModal)).toHaveLength(1)
  })

  test('no history means no modal row, rather than a spurious one at 1', () => {
    const rows = attemptDistribution([])
    expect(rows.every((r) => r.count === 0)).toBe(true)
    expect(rows.some((r) => r.isModal)).toBe(false)
  })
})

describe('trailingForm', () => {
  test('null below the floor', () => {
    const boards = Array.from({ length: TRAILING_FORM_MIN_BOARDS - 1 }, (_, i) =>
      board(dateAt(i), 'CRANE', 4),
    )
    expect(trailingForm(boards)).toBeNull()
  })

  test('at exactly the floor it reports', () => {
    const boards = Array.from({ length: TRAILING_FORM_MIN_BOARDS }, (_, i) =>
      board(dateAt(i), 'CRANE', 4),
    )
    expect(trailingForm(boards)).toEqual({ lifetime: 4, recent: 4, delta: 0, isBest: true })
  })

  test('a better recent window gives positive delta and isBest true', () => {
    const boards = [
      ...Array.from({ length: 11 }, (_, i) => board(dateAt(i), 'CRANE', 5)),
      ...Array.from({ length: TRAILING_FORM_WINDOW }, (_, i) =>
        board(dateAt(11 + i), 'CRANE', 3),
      ),
    ]
    expect(trailingForm(boards)).toEqual({ lifetime: 3.5, recent: 3, delta: 0.5, isBest: true })
  })

  test('a worse recent window gives negative delta and isBest false', () => {
    const boards = [
      ...Array.from({ length: 11 }, (_, i) => board(dateAt(i), 'CRANE', 2)),
      ...Array.from({ length: TRAILING_FORM_WINDOW }, (_, i) =>
        board(dateAt(11 + i), 'CRANE', 4),
      ),
    ]
    expect(trailingForm(boards)).toEqual({ lifetime: 3.5, recent: 4, delta: -0.5, isBest: false })
  })

  test('the window is the most recent by puzzle day, even when the input array is out of chronological order', () => {
    const older = Array.from({ length: 11 }, (_, i) => board(dateAt(i), 'CRANE', 5))
    const recentBoards = Array.from({ length: TRAILING_FORM_WINDOW }, (_, i) =>
      board(dateAt(11 + i), 'CRANE', 3),
    )
    // Deliberately not in puzzle-day order: recent boards first, older boards
    // last, both internally reversed too.
    const shuffled = [...recentBoards].reverse().concat([...older].reverse())
    expect(trailingForm(shuffled)).toEqual({ lifetime: 3.5, recent: 3, delta: 0.5, isBest: true })
  })
})

describe('openerAdvice', () => {
  test('names the saving between the two most-used openers', () => {
    const rows = [openerRow('MUSIC', 10, 4.6), openerRow('CRANE', 6, 3.9)]
    expect(openerAdvice(rows)).toEqual({ from: 'MUSIC', to: 'CRANE', savingPerDay: 0.7 })
  })

  test('no advice when the most-used opener is already better', () => {
    const rows = [openerRow('CRANE', 10, 3.5), openerRow('MUSIC', 6, 4.0)]
    expect(openerAdvice(rows)).toBeNull()
  })

  test('no advice from a barely-used alternative', () => {
    // CRANE would be great advice by the numbers, but four uses is below the floor.
    const rows = [openerRow('MUSIC', 10, 4.6), openerRow('CRANE', 4, 3.0)]
    expect(openerAdvice(rows)).toBeNull()
  })

  test('no advice without two openers, and none for an empty array', () => {
    expect(openerAdvice([openerRow('MUSIC', 10, 4.6)])).toBeNull()
    expect(openerAdvice([])).toBeNull()
  })

  test('no advice when the saving rounds to zero, not just when it is negative', () => {
    // "would save you about 0 guesses a day" is a sentence no product should print.
    const rows = [openerRow('MUSIC', 10, 4.04), openerRow('CRANE', 6, 4.0)]
    expect(openerAdvice(rows)).toBeNull()
  })
})
