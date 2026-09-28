import type { PuzzleDay } from '../../convex/lib/puzzleDay.ts'

/**
 * Layer 1's two public-benchmark lookups, over the artifacts
 * scripts/build-insights-corpus.mjs emits into public/insights/.
 *
 * PURE FUNCTIONS OVER A LOADED ARTIFACT, with the fetch kept separate at the
 * bottom. convex/lib/e2e.ts states the reason this repo works that way: logic
 * behind an authed wrapper is untestable here (wordle-teams-obw), so the
 * decisions live in functions a test can call directly and the wrapper only acts
 * on the answer. The same applies to a fetch — every rule below is tested without
 * one.
 *
 * NOT IN CONVEX (wordle-teams-dcu): the artifact is identical for every user and
 * never changes per player, so putting it in the database would spend the
 * scarcest resource on a constant. It is a static file the CDN serves.
 *
 * ABSENCE IS AN ORDINARY OUTCOME, NEVER A ZERO. Every lookup returns null when it
 * has no answer, and callers must render "no benchmark" rather than a rank of 0 or
 * a percentile of 0 — both of which read as a real and extreme result. This is not
 * hypothetical: wordle-teams-0cmj found 26 boards whose opener the corpus does not
 * hold, and TODAY never has a difficulty row, because the source publishes only
 * globally completed days.
 */

/** Ranked openers. `words` is every word concatenated, in rank order. */
export type OpenerBenchmark = {
  release: string
  attribution: string
  licence: string
  licenceUrl: string
  citation: string
  count: number
  words: string
}

/** Per-day solver pressure. `percentiles[i]` is the day `i` days after `firstDay`. */
export type DifficultyBenchmark = {
  release: string
  snapshotId: string
  attribution: string
  licence: string
  licenceUrl: string
  citation: string
  firstDay: PuzzleDay
  count: number
  percentiles: number[]
}

export type InsightsBenchmark = {
  openers: OpenerBenchmark
  difficulty: DifficultyBenchmark
}

const WORD_LENGTH = 5

/**
 * Where a word ranks among the scored openers, or null if the corpus has no such
 * word. 1-based, so it reads as "4,102nd of 14,855" without adjustment.
 *
 * THE MULTIPLE-OF-FIVE CHECK IS LOAD-BEARING, not defensive. `words` is one
 * concatenated string, so a naive indexOf happily matches ACROSS a word boundary:
 * with 'crane' followed by 'sloth', indexOf('anesl') succeeds at offset 2 and
 * would report a rank that is not merely wrong but fabricated — a word that is not
 * in the corpus getting a plausible-looking rank. Only an offset divisible by five
 * is a real word start.
 *
 * Case is normalised here because our guesses are uppercase (v1 stored them that
 * way and the copy carried it) while the corpus is lowercase throughout. Doing it
 * at the edge keeps the artifact untouched.
 */
export function openerRank(benchmark: OpenerBenchmark, word: string): number | null {
  const needle = word.toLowerCase()
  if (needle.length !== WORD_LENGTH) return null

  let from = 0
  for (;;) {
    const at = benchmark.words.indexOf(needle, from)
    if (at < 0) return null
    if (at % WORD_LENGTH === 0) return at / WORD_LENGTH + 1
    // A straddling match. Resume one character on, never at `at + WORD_LENGTH`,
    // which could step over a genuine aligned occurrence.
    from = at + 1
  }
}

/** The four bands the source labels puzzles with. Boundaries are inclusive. */
export type DifficultyLabel =
  | 'Easier for the solver'
  | 'Middle of the pack'
  | 'Tricky'
  | 'Hard for the solver'

/**
 * The label for a percentile.
 *
 * Derived rather than stored, because it is a pure function of the percentile with
 * non-overlapping bands — verified across all 1,900 dated rows in the corpus, and
 * the build script would have to change for it to stop holding.
 */
export function difficultyLabel(percentile: number): DifficultyLabel {
  if (percentile <= 34) return 'Easier for the solver'
  if (percentile <= 64) return 'Middle of the pack'
  if (percentile <= 89) return 'Tricky'
  return 'Hard for the solver'
}

const MS_PER_DAY = 86_400_000

/** Whole days from `from` to `to`. UTC so a DST boundary cannot shift the count. */
function daysBetween(from: PuzzleDay, to: PuzzleDay): number {
  const utc = (day: PuzzleDay) => {
    const [year, month, date] = day.split('-').map(Number)
    return Date.UTC(year, month - 1, date)
  }
  return (utc(to) - utc(from)) / MS_PER_DAY
}

/**
 * How hard a given day's puzzle was, or null if the artifact does not cover it.
 *
 * INDEXED BY DATE OFFSET, which is only legal because the dated rows are a
 * contiguous run with no gaps. The build script asserts that on every refresh, for
 * the reason wordle-teams-0cmj called the silent risk: one missing day would shift
 * every later day by one and mis-attribute every subsequent percentile, and
 * nothing downstream could notice.
 *
 * A day AFTER the artifact's range is the common miss rather than an edge case —
 * today is always outside it, and so is every day since the corpus was last
 * refreshed.
 */
export function dayDifficulty(
  benchmark: DifficultyBenchmark,
  day: PuzzleDay,
): { percentile: number; label: DifficultyLabel } | null {
  const index = daysBetween(benchmark.firstDay, day)
  if (!Number.isInteger(index) || index < 0 || index >= benchmark.percentiles.length) return null
  const percentile = benchmark.percentiles[index]
  if (percentile === undefined) return null
  return { percentile, label: difficultyLabel(percentile) }
}

/**
 * CC BY 4.0 obliges us to credit the source where the data is shown, so this
 * reads the attribution OUT OF THE ARTIFACT rather than repeating it in a
 * component. A credit hardcoded next to the data it credits is a credit that can
 * drift from it — and the difficulty artifact carries a snapshot id precisely
 * because its numbers are revised between refreshes.
 */
export function benchmarkCredit(benchmark: InsightsBenchmark): {
  attribution: string
  licence: string
  licenceUrl: string
  citation: string
  release: string
  snapshotId: string
} {
  return {
    attribution: benchmark.openers.attribution,
    licence: benchmark.openers.licence,
    licenceUrl: benchmark.openers.licenceUrl,
    citation: benchmark.openers.citation,
    release: benchmark.openers.release,
    snapshotId: benchmark.difficulty.snapshotId,
  }
}

/**
 * Fetches both artifacts once and remembers them.
 *
 * LAZY IS WHAT MAKES THE ARTIFACT AFFORDABLE. It is ~79 KB and a player who never
 * opens insights must never pay for it, so this is called from the insights
 * route's component — which the router code-splits — and never at module scope
 * anywhere that the app shell imports.
 *
 * The promise is cached rather than the value, so two components mounting in the
 * same tick share one request instead of racing two. A failed load clears the
 * cache so a retry is possible; a rejected promise left in place would make the
 * first network blip permanent for the life of the tab.
 */
let pending: Promise<InsightsBenchmark> | null = null

export function loadInsightsBenchmark(): Promise<InsightsBenchmark> {
  pending ??= Promise.all([
    fetch('/insights/benchmark-openers.json').then((r) => {
      if (!r.ok) throw new Error(`benchmark-openers.json: HTTP ${r.status}`)
      return r.json() as Promise<OpenerBenchmark>
    }),
    fetch('/insights/benchmark-difficulty.json').then((r) => {
      if (!r.ok) throw new Error(`benchmark-difficulty.json: HTTP ${r.status}`)
      return r.json() as Promise<DifficultyBenchmark>
    }),
  ])
    .then(([openers, difficulty]) => ({ openers, difficulty }))
    .catch((error: unknown) => {
      pending = null
      throw error
    })
  return pending
}

/** Test seam — forgets a cached load. */
export function resetInsightsBenchmark(): void {
  pending = null
}
