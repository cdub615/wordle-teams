import { attemptsFor } from '../../convex/lib/board.ts'
import { monthOf } from '../../convex/lib/puzzleDay.ts'
import { dayDifficulty, openerRank, type DifficultyBenchmark, type OpenerBenchmark } from './insights-benchmark.ts'
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

export type DistributionRow = {
  label: '1' | '2' | '3' | '4' | '5' | '6' | 'X'
  count: number
  /** The most common outcome. At most one row carries it. */
  isModal: boolean
}

const DISTRIBUTION_LABELS = ['1', '2', '3', '4', '5', '6', 'X'] as const

/**
 * How often they solve in each number of guesses — the statistic every Wordle
 * player already knows how to read, and the one this page was missing entirely.
 *
 * SEVEN IS X, NOT A SEVENTH BAR. attemptsFor scores an unsolved board 7, which
 * is a sentinel rather than a count: nobody takes seven guesses. Rendering it as
 * "7" would invent a rule the game does not have.
 *
 * ALL SEVEN ROWS ALWAYS RENDER, including the empty ones. A distribution with
 * missing rows is not a distribution — the gap at 2 is information, and an axis
 * that changes shape between players cannot be compared at a glance.
 *
 * NO MODAL ROW ON AN EMPTY HISTORY. Taking the max of seven zeroes would paint
 * the accent on "1" and claim a most-common outcome that does not exist.
 */
export function attemptDistribution(boards: PersonalBoard[]): DistributionRow[] {
  const counts = new Map<DistributionRow['label'], number>(
    DISTRIBUTION_LABELS.map((label) => [label, 0]),
  )

  for (const board of boards) {
    const attempts = attemptsFor(board.guesses, board.answer ?? '')
    const label: DistributionRow['label'] =
      attempts >= 7 ? 'X' : (String(attempts) as DistributionRow['label'])
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  // Ties go to the lower attempt count because DISTRIBUTION_LABELS is in order
  // and `>` never displaces an equal earlier row.
  let modal: DistributionRow['label'] | null = null
  let best = 0
  for (const label of DISTRIBUTION_LABELS) {
    const count = counts.get(label) ?? 0
    if (count > best) {
      best = count
      modal = label
    }
  }

  return DISTRIBUTION_LABELS.map((label) => ({
    label,
    count: counts.get(label) ?? 0,
    isModal: label === modal,
  }))
}

export const TRAILING_FORM_WINDOW = 30

/**
 * The floor below which there is no comparison to make.
 *
 * AT EXACTLY TRAILING_FORM_WINDOW THE WINDOW IS THE LIFETIME and the delta is
 * necessarily zero — a comparison of a set against itself, dressed up as a
 * result. Forty leaves at least ten boards outside the window, so the figure is
 * measured against something.
 */
export const TRAILING_FORM_MIN_BOARDS = 40

export type TrailingForm = {
  lifetime: number
  recent: number
  /** lifetime - recent. POSITIVE MEANS IMPROVING, because lower is better. */
  delta: number
  /** Whether no earlier window of the same size was better. */
  isBest: boolean
}

/**
 * "Are you getting better lately?" — the comparison the benchmark corpus cannot
 * make, so it is made against the player's own history instead.
 *
 * THIS REPLACES A COMPARISON AGAINST THE BENCHMARK CORPUS THAT CANNOT BE BUILT.
 * The corpus (insights-benchmark.ts) holds opener ranks and per-day difficulty
 * percentiles — no attempt averages at all. There is no "par" score to be
 * better or worse than, so "recent form vs. lifetime form" is the nearest
 * honest substitute: it needs no external data and no player is exempt from
 * having a history to compare against.
 *
 * SORTED BY puzzleDay, NOT ARRAY ORDER. The query's ordering is not part of its
 * contract, and "recent" is a claim about the calendar — a caller that happens
 * to fetch newest-first today must not silently break this if it changes
 * tomorrow.
 *
 * isBest USES A STRICT `<` so the final window never disqualifies itself: its
 * own mean compared against itself is equal, never less, so it always survives
 * the check that asks whether anything did better.
 */
export function trailingForm(boards: PersonalBoard[]): TrailingForm | null {
  if (boards.length < TRAILING_FORM_MIN_BOARDS) return null

  const sorted = [...boards].sort((a, b) => a.puzzleDay.localeCompare(b.puzzleDay))
  const attempts = sorted.map((board) => attemptsFor(board.guesses, board.answer ?? ''))

  const mean = (values: number[]) => values.reduce((total, n) => total + n, 0) / values.length

  const lifetime = mean(attempts)
  const recent = mean(attempts.slice(-TRAILING_FORM_WINDOW))

  let isBest = true
  for (let start = 0; start + TRAILING_FORM_WINDOW <= attempts.length; start++) {
    const windowMean = mean(attempts.slice(start, start + TRAILING_FORM_WINDOW))
    if (windowMean < recent) {
      isBest = false
      break
    }
  }

  return {
    lifetime: round1(lifetime),
    recent: round1(recent),
    delta: round1(lifetime - recent),
    isBest,
  }
}

/**
 * Uses required of the alternative before it is worth recommending.
 *
 * A GUARD, NOT A FEATURE FLOOR. The spec pins two sample-size floors and this is
 * neither; it exists because "switch to CRANE" drawn from two lucky boards is
 * advice this page should not give.
 */
const MIN_OPENER_USES_FOR_ADVICE = 5

export type OpenerAdvice = {
  from: string
  to: string
  /** Mean attempts saved per board, to one decimal. Always positive. */
  savingPerDay: number
}

/**
 * "Switch from X to Y and save N guesses a day" — the one piece of advice this
 * page can back with the player's own numbers.
 *
 * BUILT ON headlineComparison, DELIBERATELY, NOT THE GLOBALLY BEST OPENER.
 * headlineComparison's own comment records why: the comparison is about the
 * player's HABITS — their two most-used openers — not about their best result
 * tried twice. Advice built on a lucky outlier is not advice worth printing.
 *
 * `<= 0`, NOT `< 0`. A saving that rounds to zero is not a reason to switch
 * either — "would save you about 0 guesses a day" is a sentence no product
 * should print, so the same guard that rules out negative savings rules out a
 * rounded-away one.
 */
export function openerAdvice(rows: OpenerRow[]): OpenerAdvice | null {
  const pair = headlineComparison(rows)
  if (pair === null) return null

  const { most, other } = pair
  if (other.count < MIN_OPENER_USES_FOR_ADVICE) return null

  const savingPerDay = round1(most.meanAttempts - other.meanAttempts)
  if (savingPerDay <= 0) return null

  return { from: most.word, to: other.word, savingPerDay }
}

export const TREND_MONTHS = 12

export type Trend = {
  /** The last TREND_MONTHS rows, oldest first. */
  months: MonthRow[]
  /** The best month across their WHOLE history, which may predate the window. */
  best: MonthRow | null
  latestIsBest: boolean
}

/**
 * Bounds `attemptsByMonth`'s ever-growing list at a year, for a chart that must
 * fit a panel rather than scroll forever — while still being honest about a
 * best month that happened before the window started.
 *
 * `best` LOOKS AT ALL ROWS, NOT JUST `months`. A caption reading "your best
 * month yet" has to be true of their whole history, not true-of-the-last-twelve
 * dressed up as a superlative — and a player who peaked thirteen months ago
 * should see that, not a chart that quietly forgets it happened.
 *
 * TIES GO TO THE MOST RECENT MONTH, because the scan uses `<=` (not `<`) so a
 * later row with an equal mean replaces the running best. Between two months a
 * player played identically well, the more recent one is the more useful thing
 * to call out.
 *
 * SORTED DEFENSIVELY, ON A COPY, FOR THE SAME REASON trailingForm IS: ordering
 * is not part of `MonthRow[]`'s contract, and this function's one caller today
 * (`attemptsByMonth`) happening to sort ascending is not a guarantee a future
 * caller inherits. `month` is a 'YYYY-MM' string, which sorts lexicographically
 * exactly like `puzzleDay` does (see convex/lib/puzzleDay.ts), so a plain
 * string sort is correct here too. The cost is trivial next to trailingForm's:
 * this array is a player's months, at most a couple hundred, not their boards.
 */
export function trendWindow(rows: MonthRow[], limit = TREND_MONTHS): Trend {
  if (rows.length === 0) return { months: [], best: null, latestIsBest: false }

  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month))

  let best = sorted[0]!
  for (const row of sorted) {
    // `<=`, not `<`: a later month with an equal mean must replace the running
    // best so a tie resolves to the more recent month.
    if (row.meanAttempts <= best.meanAttempts) best = row
  }

  const months = sorted.slice(-limit)
  const latest = sorted[sorted.length - 1]!

  return { months, best, latestIsBest: latest === best }
}

/**
 * Where "hard" starts.
 *
 * THE CORPUS'S OWN BOUNDARY, NOT ONE INVENTED HERE. difficultyLabel puts
 * "Tricky" at 65-89 and "Hard for the solver" above 89, so >= 65 is exactly
 * "the two harder bands" and this page cannot drift from the label the day-by-
 * day list prints beside it.
 */
export const HARD_DAY_PERCENTILE = 65

/** Boards required in EACH band before the split is stable enough to print. */
export const MIN_BOARDS_PER_BAND = 10

export type DifficultySplitResult =
  | { kind: 'ready'; hard: number; rest: number; hardBoards: number; restBoards: number }
  | { kind: 'thin'; hardBoards: number; restBoards: number }

/**
 * How much harder days hit them, compared to every other day — the one
 * insight in this whole module that no player-side computation could produce
 * on its own, because it needs the corpus's per-day difficulty percentiles.
 *
 * A NULL FROM dayDifficulty MEANS "UNRATED", NOT "EASY", AND IS SKIPPED FROM
 * BOTH BANDS RATHER THAN DEFAULTED INTO ONE. This is the common case, not the
 * edge case: the corpus publishes only globally completed days, so today is
 * always unrated and so is every day since the artifact was last refreshed.
 * Defaulting an unrated day into "rest" would quietly load that band with days
 * that were never actually assessed as easy.
 *
 * THIN REPORTS COUNTS, NOT JUST A BOOLEAN, because the caller renders a
 * progress prompt ("6 more hard-day boards needed") that has to say how far
 * away the insight is, not just that it is not ready yet.
 */
export function difficultySplit(
  boards: PersonalBoard[],
  difficulty: DifficultyBenchmark,
): DifficultySplitResult {
  const hard: number[] = []
  const rest: number[] = []

  for (const board of boards) {
    const rated = dayDifficulty(difficulty, board.puzzleDay)
    if (rated === null) continue

    const attempts = attemptsFor(board.guesses, board.answer ?? '')
    if (rated.percentile >= HARD_DAY_PERCENTILE) {
      hard.push(attempts)
    } else {
      rest.push(attempts)
    }
  }

  if (hard.length < MIN_BOARDS_PER_BAND || rest.length < MIN_BOARDS_PER_BAND) {
    return { kind: 'thin', hardBoards: hard.length, restBoards: rest.length }
  }

  const mean = (values: number[]) => values.reduce((total, n) => total + n, 0) / values.length

  return {
    kind: 'ready',
    hard: round1(mean(hard)),
    rest: round1(mean(rest)),
    hardBoards: hard.length,
    restBoards: rest.length,
  }
}
