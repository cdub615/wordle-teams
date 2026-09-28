import { dayDifficulty, openerRank, type InsightsBenchmark } from './insights-benchmark.ts'
import type { PuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { hasFullTeamMonth } from '../../convex/lib/insightsAccess.ts'

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
 * The shape the insights route's server query returns — the access tier for
 * each layer plus the boards themselves.
 *
 * EXPORTED FROM HERE, NOT DECLARED PER-CONSUMER, because src/routes/insights.tsx
 * and src/components/insights/daily-benchmark.tsx each held a byte-identical
 * copy with no shared source: renaming a field in one silently left the other
 * unchanged and the compiler said nothing. One declaration means one place to
 * change it.
 */
export type Boards = {
  access: {
    layer1: 'none' | 'free' | 'full'
    layer2: 'none' | 'free' | 'full'
    layer3: 'none' | 'free' | 'full'
  }
  boards: { puzzleDay: string; guesses: string[]; answer?: string }[]
}

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

/** `a, b, and c` — Oxford comma, because the last item is itself a phrase. */
function listed(items: string[]): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

/**
 * Is this player on a team? Three-valued, and the ONE spelling of it.
 *
 * `undefined` until the roster query resolves, and every caller has to treat
 * that as its own answer rather than as a `false` — `upsellFor` below withholds
 * the pitch on it, and TeamSection compares to `false` explicitly so the
 * no-team card cannot be shown to somebody who merely has not loaded yet.
 *
 * WHY IT IS A FUNCTION AND NOT A PROP (wordle-teams-kkhj). This expression used
 * to live inline in routes/insights.tsx, which computed it from `teams` and then
 * passed BOTH down the same call — two spellings of one fact, with nothing
 * enforcing that `onATeam === false` and `teams.length === 0` agreed. They were
 * independent in test, too: the route test's helper hardcoded `onATeam: true`
 * while varying `teams`. One function, called by the two components that need
 * the answer, is what collapses that.
 *
 * `teams.length > 0` RATHER THAN `teams?.length > 0`, and the optional chain is
 * the bug this shape exists to refuse: it evaluates to `false` for an unloaded
 * roster and puts the conflation straight back.
 */
export function onATeamFrom(teams: ReadonlyArray<unknown> | undefined): boolean | undefined {
  return teams === undefined ? undefined : teams.length > 0
}

/**
 * Whether this player is seeing everything or a sample, and what to say about it.
 *
 * COMPOSED FROM WHAT IS LOCKED, NOT BRANCHED ON A TIER, and that is the fix
 * rather than an elaboration of it. This used to take `layer1` alone and return
 * one fixed sentence about the board list, which made it STRUCTURALLY unable to
 * mention the two upper layers — the largest invisible Pro benefits on the page.
 * Layer 2 does not render at all for a free player (layer2 'none') and
 * TeamSection gives them one daily fact instead of the panel.
 *
 * AND THE SAME SIGNATURE GOT THE TRIAL WRONG IN THE OTHER DIRECTION. A trial
 * grants layer2 and layer3 while layer1 stays 'free' (convex/lib/
 * insightsAccess.ts), so the tier cannot be read off layer1: a trialist was
 * being pitched the history and team panels already on their screen. Naming
 * only the locked layers fixes both directions at once, and needs no `isTrial`
 * flag — the access object already says what is withheld.
 *
 * THE TEAM CLAUSE IS CONDITIONAL ON HAVING A TEAM, not just on layer3.
 * TeamSection renders NoTeamCard, not the panel, for a player on no team
 * (components/insights/team-section.tsx), which a v1 migrant can be, and promising team
 * analytics to them promises something they would not see after paying.
 *
 * Returns null when there is nothing to upsell — a pro player, a player with no
 * boards at all, who needs an empty state rather than a pitch, or a viewer
 * whose team membership has not resolved yet (see `onATeam`).
 */
export function upsellFor({
  layer1,
  layer2,
  layer3,
  boardCount,
  onATeam,
}: {
  layer1: 'none' | 'free' | 'full'
  layer2: 'none' | 'free' | 'full'
  layer3: 'none' | 'free' | 'full'
  boardCount: number
  /** `undefined` until getMyTeams resolves — withhold rather than guess. */
  onATeam: boolean | undefined
}): string | null {
  if (layer1 === 'full') return null
  if (boardCount === 0) return null
  if (onATeam === undefined) return null

  const historyLocked = layer2 !== 'full'
  // `hasFullTeamMonth` RATHER THAN A `layer3` COMPARISON, so this sentence and
  // the surface it describes cannot drift apart (wordle-teams-iht.3.1). This
  // copy names what the free tier gets — "one team fact a day" below — and
  // team-section.tsx is what actually renders it; two independent readings of
  // `layer3` is how the promise and the panel end up disagreeing.
  const teamLocked = !hasFullTeamMonth(layer3) && onATeam

  const opens = [
    ...(historyLocked ? ['your full playing history'] : []),
    ...(teamLocked ? ['your team’s analytics'] : []),
    'every board you have ever entered',
  ]

  // "one team fact a day" IS WHAT THE FREE TIER ACTUALLY GETS — DailyTeamFact,
  // not a cut-down panel — so it is only honest to name it where that is the
  // surface the reader is looking at. The free tier also gets a locked teaser
  // card beneath it (team-locked-card.tsx); that card's own copy is a separate,
  // deliberately out-of-scope decision (spec §7), so this promise names only
  // the one thing an upgrade actually unlocks.
  const free = teamLocked
    ? 'Free shows your most recent board and one team fact a day.'
    : 'Free shows your most recent board.'

  // "shows" where the boards are the only thing withheld, which is the
  // trialist's case and reads as a smaller claim than "opens".
  const verb = opens.length === 1 ? 'shows' : 'opens'

  return `${free} Pro ${verb} ${listed(opens)}.`
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
