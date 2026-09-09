import { dayDifficulty, openerRank, type InsightsBenchmark } from './insights-benchmark.ts'
import type { PuzzleDay } from '../../convex/lib/puzzleDay.ts'

/**
 * What Layer 1 says about one board — the sentences, decided here rather than in
 * JSX.
 *
 * PURE, so every absent case is a unit test rather than a render. That matters
 * more here than usual: the whole risk in this panel is a missing benchmark
 * rendering as a confident zero — "ranks 0th", "harder than 0% of puzzles" — and
 * a component test would have to go looking for those, while a function returning
 * `null` cannot express them at all.
 */

export type BoardBenchmark = {
  puzzleDay: PuzzleDay
  /** The opener and its rank, or null when the corpus does not hold it. */
  opener: { word: string; rank: number; outOf: number } | null
  /** The day's solver pressure, or null when the corpus does not cover the day. */
  difficulty: { percentile: number; label: string } | null
}

export type BoardInput = { puzzleDay: PuzzleDay; guesses: string[] }

/**
 * NEITHER HALF DEPENDS ON THE OTHER, and that is the point of returning two
 * nullable fields rather than one nullable object. A board played today has no
 * difficulty row — the corpus publishes only globally completed days — but its
 * opener rank is perfectly good, and collapsing both into "no benchmark" would
 * throw away the half that works on the single most common board there is.
 */
export function benchmarkFor(
  benchmark: InsightsBenchmark,
  board: BoardInput,
): BoardBenchmark {
  const word = board.guesses[0]
  const rank = word === undefined ? null : openerRank(benchmark.openers, word)
  const difficulty = dayDifficulty(benchmark.difficulty, board.puzzleDay)

  return {
    puzzleDay: board.puzzleDay,
    opener:
      word === undefined || rank === null
        ? null
        : { word: word.toUpperCase(), rank, outOf: benchmark.openers.count },
    difficulty,
  }
}

/** '4,102nd of 14,855' — the sentence the spec quotes. */
export function openerRankSentence(opener: NonNullable<BoardBenchmark['opener']>): string {
  return `${ordinal(opener.rank)} of ${opener.outOf.toLocaleString('en-US')}`
}

/**
 * 1st, 2nd, 3rd, 4th — and 11th/12th/13th, which are the ones a naive rule gets
 * wrong. Duplicated from lib/format-day.ts deliberately: that module is about
 * dates and imports puzzleDay helpers, and this one must stay importable by the
 * insights bundle alone.
 */
function ordinal(n: number): string {
  const value = n.toLocaleString('en-US')
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${value}th`
  switch (n % 10) {
    case 1:
      return `${value}st`
    case 2:
      return `${value}nd`
    case 3:
      return `${value}rd`
    default:
      return `${value}th`
  }
}

/**
 * How a percentile reads to a player.
 *
 * PHRASED AS "HARDER THAN N% OF PUZZLES" rather than a bare percentile, because
 * "solver pressure: 87" means nothing to anyone. The corpus's own label carries
 * the judgement and this carries the scale.
 */
export function difficultySentence(difficulty: NonNullable<BoardBenchmark['difficulty']>): string {
  return `Harder than ${difficulty.percentile}% of past puzzles`
}

/**
 * Whether this player is seeing everything or a sample, and what to say about it.
 * Returns null when there is nothing to upsell — a pro player, or a player with
 * no boards at all, who needs an empty state rather than a pitch.
 */
export function upsellFor({
  layer1,
  boardCount,
}: {
  layer1: 'none' | 'free' | 'full'
  boardCount: number
}): string | null {
  if (layer1 === 'full') return null
  if (boardCount === 0) return null
  return 'Free shows your most recent board. Pro shows every board you have ever entered.'
}

/**
 * WHICH BOARDS LAYER 1 MAY SHOW, which is not the same as which boards the query
 * returned.
 *
 * THE QUERY RETURNS HISTORY WHENEVER LAYER 2 IS UNLOCKED, because Layer 2's
 * statistics need it — and the trial grants Layer 2 WITHOUT Layer 1. So a
 * trialist's payload holds every board while their Layer 1 access is still
 * 'free', and rendering the payload directly leaked the paid benchmark list into
 * the trial. Reported by the owner as "miles of daily insights" and found there;
 * `boards.length` is the wrong source for this and this function is the right one.
 */
export function boardsForLayer1<T>(boards: readonly T[], layer1: 'none' | 'free' | 'full'): T[] {
  if (layer1 === 'full') return [...boards]
  // Free sees the most recently ENTERED board, which the server has already put
  // first — see convex/insights.ts for why that is not the latest puzzle day.
  return boards.slice(0, 1)
}

export type BoardFilter = { month: string; opener: string }

/** The sentinel both selects use for "no filter". Not a real month or word. */
export const ALL = 'all'

/** Months the player has boards in, most recent first. */
export function monthOptionsFor(boards: readonly BoardInput[]): string[] {
  return [...new Set(boards.map((board) => board.puzzleDay.slice(0, 7)))].sort((a, b) =>
    b.localeCompare(a),
  )
}

/**
 * Openers the player has used, most used first.
 *
 * ORDERED BY THEIR OWN USE, not alphabetically, because the question this filter
 * answers comes straight off Layer 2's repertoire — "show me my CRANE days" — and
 * that list is ordered the same way. A select that reordered them would make the
 * two panels disagree about the same set of words.
 */
export function openerOptionsFor(boards: readonly BoardInput[]): string[] {
  const counts = new Map<string, number>()
  for (const board of boards) {
    const opener = board.guesses[0]
    if (opener === undefined || opener.length === 0) continue
    const word = opener.toUpperCase()
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word)
}

/**
 * The boards a filter selects.
 *
 * THE TWO FILTERS COMBINE rather than replacing each other, so "CRANE, in
 * September" is reachable. Either alone is the common case and `ALL` on both is
 * the default.
 */
export function filterBoards<T extends BoardInput>(
  boards: readonly T[],
  { month, opener }: BoardFilter,
): T[] {
  return boards.filter((board) => {
    if (month !== ALL && board.puzzleDay.slice(0, 7) !== month) return false
    if (opener !== ALL && (board.guesses[0] ?? '').toUpperCase() !== opener) return false
    return true
  })
}
