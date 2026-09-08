import { attemptsFor } from '../../convex/lib/board.ts'
import { monthOf } from '../../convex/lib/puzzleDay.ts'
import { openerRank, type OpenerBenchmark } from './insights-benchmark.ts'
import type { PuzzleDay, PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * Layer 2 — a player's own history, and the join to Layer 1 that is the product.
 *
 * THE JOIN IS THE HEADLINE, NOT A RANK COLUMN BOLTED ONTO A TABLE. The spec's
 * sentence — "You have opened with MUSIC 41 times. It ranks 4,102nd. You average
 * 4.6 guesses with it and 3.9 with CRANE" — is this module's counts joined to the
 * benchmark's ranks. Either half alone is ordinary; together they are the thing
 * the spec says no other product can say. So `openerRepertoire` returns the rank
 * beside the count and the mean, as one row, rather than leaving a caller to pair
 * them up.
 *
 * PURE, over rows the caller has already read. No cohort and no other player, so
 * no privacy rule applies here — every number is the player's own.
 *
 * ATTEMPTS COME FROM convex/lib/board.ts, NOT FROM guesses.length. A failed board
 * scores 7, and copied v1 rows can carry a seven-entry array because v1 appended
 * a '' sentinel to a failed six-guess board. attemptsFor knows both; a length
 * would be wrong on exactly the boards a player most wants explained.
 *
 * `answer` IS OPTIONAL ON dailyScores, so every read of it here is `?? ''` —
 * matching convex/lib/scoring.ts, which already does exactly that at the one
 * other place attempts are computed server-side. A row without an answer must
 * not break a statistic; it must not silently become a different rule either.
 */

export type PersonalBoard = {
  puzzleDay: PuzzleDay
  guesses: string[]
  answer?: string
}

/** The minimum history before the numbers mean anything. See `isThin`. */
export const MIN_BOARDS_FOR_STATS = 5

/**
 * IS THERE ENOUGH HISTORY TO SAY ANYTHING? A DESIGNED STATE, NOT A BUG.
 *
 * The spec is explicit that Layer 2 is empty for 368 of 392 accounts and that
 * this is acceptable, because the ~24 players with real history are the
 * willingness-to-pay population. So "not enough boards yet" is a real state with
 * real copy, and the alternative — a mean over one board, a streak of one, a
 * repertoire of a single opener — would be worse than empty: it looks like a
 * product that has nothing to say rather than one waiting for data.
 */
export function isThin(boards: PersonalBoard[]): boolean {
  return boards.length < MIN_BOARDS_FOR_STATS
}

export type OpenerRow = {
  word: string
  count: number
  /** Mean attempts on the boards that opened with this word, to one decimal. */
  meanAttempts: number
  /** Its benchmark rank, or null when the corpus does not hold the word. */
  rank: number | null
}

/**
 * The player's openers, most used first, each joined to its benchmark rank.
 *
 * SORTED BY COUNT AND THEN BY WORD, so the order is total. Ties broken by
 * anything unstable would reshuffle the list between renders for no reason the
 * player could see.
 *
 * A word the corpus does not hold gets `rank: null` and stays in the list. It is
 * still the player's opener and they still have a mean for it — dropping the row
 * would hide their own history because a third party's word list is incomplete,
 * and 26 of our boards are in exactly that position.
 */
export function openerRepertoire(
  boards: PersonalBoard[],
  benchmark: OpenerBenchmark,
): OpenerRow[] {
  const tally = new Map<string, { count: number; attempts: number }>()

  for (const board of boards) {
    const opener = board.guesses[0]
    if (opener === undefined || opener.length === 0) continue
    const word = opener.toUpperCase()
    const row = tally.get(word) ?? { count: 0, attempts: 0 }
    row.count += 1
    row.attempts += attemptsFor(board.guesses, board.answer ?? '')
    tally.set(word, row)
  }

  return [...tally]
    .map(([word, { count, attempts }]) => ({
      word,
      count,
      meanAttempts: round1(attempts / count),
      rank: openerRank(benchmark, word),
    }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
}

/**
 * The spec's sentence, for the player's most-used opener, or null when there is
 * not enough to say it with.
 *
 * NEEDS TWO OPENERS, because the sentence is a COMPARISON — "4.6 with MUSIC and
 * 3.9 with CRANE". With one opener there is nothing to compare against and the
 * sentence collapses into a statistic, which is not the thing worth paying for.
 * Returning null lets the caller show the plain repertoire instead of a
 * half-sentence.
 */
export function headlineComparison(rows: OpenerRow[]): {
  most: OpenerRow
  other: OpenerRow
} | null {
  const [most, ...rest] = rows
  if (most === undefined) return null
  // The best comparison is the one the player would most want: their next most
  // used opener, not their best or worst, so the sentence is about their habits.
  const other = rest[0]
  if (other === undefined) return null
  return { most, other }
}

export type MonthRow = {
  month: PuzzleMonth
  boards: number
  meanAttempts: number
}

/**
 * Mean attempts per calendar month, oldest first.
 *
 * GROUPED ON puzzleDay's MONTH, never on the stored instant. That is the whole
 * reason puzzleDay exists — grouping by an instant across 57 timezones is v1's
 * bug — and `monthOf` is a string slice on 'YYYY-MM-DD', so it cannot drift.
 */
export function attemptsByMonth(boards: PersonalBoard[]): MonthRow[] {
  const tally = new Map<PuzzleMonth, { boards: number; attempts: number }>()

  for (const board of boards) {
    const month = monthOf(board.puzzleDay)
    const row = tally.get(month) ?? { boards: 0, attempts: 0 }
    row.boards += 1
    row.attempts += attemptsFor(board.guesses, board.answer ?? '')
    tally.set(month, row)
  }

  return [...tally]
    .map(([month, { boards: count, attempts }]) => ({
      month,
      boards: count,
      meanAttempts: round1(attempts / count),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

export type Streaks = {
  /** Consecutive days up to and including the most recent board. */
  current: number
  /** The longest run of consecutive days anywhere in their history. */
  longest: number
}

/**
 * Runs of consecutive PUZZLE DAYS.
 *
 * ON DAYS, NOT ON ROWS. A player who backfills last Tuesday extends the streak
 * that Tuesday belongs to, which is the behaviour anyone would expect and the
 * reason this counts calendar gaps rather than walking a sorted list of rows.
 *
 * `current` IS ANCHORED TO THEIR LAST BOARD, NOT TO TODAY, and that is a
 * deliberate reading. Anchoring to today would report 0 for anyone who has not
 * played yet this morning — including at 00:05 in their own timezone — which
 * turns a statistic about their history into a nag about the current moment.
 * The label the UI puts on it should say "through <day>" rather than imply now.
 *
 * DUPLICATE DAYS ARE COLLAPSED, AND THE REASON IS THE OPPOSITE OF THE OBVIOUS
 * ONE. v1 has no uniqueness constraint on (player, day) and production holds five
 * such pairs (wordle-teams-rac). A duplicate does not INFLATE a streak — the gap
 * between a day and itself is zero, not one, so it never counts as a next day.
 * It BREAKS one: in a run of 1st, 2nd, 2nd, 3rd the middle pair resets the
 * counter and a genuine three-day streak is reported as two. Found by mutation
 * testing, after an earlier version of this comment claimed the inflation story
 * and the test written from it passed with the deduplication removed.
 */
export function streaks(boards: PersonalBoard[]): Streaks {
  const days = [...new Set(boards.map((board) => board.puzzleDay))].sort()
  if (days.length === 0) return { current: 0, longest: 0 }

  let longest = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = isNextDay(days[i - 1], days[i]) ? run + 1 : 1
    if (run > longest) longest = run
  }
  // `run` ends holding the length of the final run, which is the current one.
  return { current: run, longest }
}

const MS_PER_DAY = 86_400_000

function isNextDay(earlier: PuzzleDay, later: PuzzleDay): boolean {
  return utcOf(later) - utcOf(earlier) === MS_PER_DAY
}

/** UTC so a DST boundary cannot make two adjacent days look 23 or 25 hours apart. */
function utcOf(day: PuzzleDay): number {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date)
}

/**
 * How consistent their scores are: the mean, and the spread around it.
 *
 * POPULATION STANDARD DEVIATION, not the sample estimate. These boards are the
 * player's whole history rather than a sample drawn from a larger population of
 * their play, so dividing by n is the right one — and it also means a
 * single-board history reports 0 spread instead of dividing by zero.
 */
export function consistency(boards: PersonalBoard[]): {
  meanAttempts: number
  spread: number
  solved: number
  failed: number
} {
  if (boards.length === 0) return { meanAttempts: 0, spread: 0, solved: 0, failed: 0 }

  const attempts = boards.map((board) => attemptsFor(board.guesses, board.answer ?? ''))
  const mean = attempts.reduce((total, n) => total + n, 0) / attempts.length
  const variance =
    attempts.reduce((total, n) => total + (n - mean) ** 2, 0) / attempts.length

  // 7 is the sentinel attemptsFor uses for a board that was never solved.
  const failed = attempts.filter((n) => n === 7).length

  return {
    meanAttempts: round1(mean),
    spread: round1(Math.sqrt(variance)),
    solved: attempts.length - failed,
    failed,
  }
}

/** One decimal, and never `-0`, which renders as "-0.0". */
function round1(value: number): number {
  return Math.round(value * 10) / 10 + 0
}
