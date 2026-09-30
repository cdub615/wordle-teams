import { attemptsFor } from './board.ts'
import { daysOfMonth, isWeekendDay, type PuzzleDay, type PuzzleMonth } from './puzzleDay.ts'

/**
 * Month aggregation and winner selection, ported from v1's
 * Player.aggregateScoreByMonth and Team.thisMonthsCurrentWinner.
 *
 * Shared by the scores table and by the winner recomputation inside
 * upsertBoard, which is the only thing keeping the standings the user reads and
 * the standings we store from drifting apart.
 */

/** The team's per-outcome point values. Structurally satisfied by a `teams` doc. */
export type ScoringSystem = {
  oneGuess: number
  twoGuesses: number
  threeGuesses: number
  fourGuesses: number
  fiveGuesses: number
  sixGuesses: number
  failed: number
  nA: number
}

export type ScoredDay = {
  puzzleDay: PuzzleDay
  guesses: Array<string>
  answer?: string
}

/**
 * Points for an attempt count.
 *
 * TOTAL BY CONSTRUCTION — every branch returns. v1's getScore looked the count
 * up in an array and threw on a miss; v2's system is eight named schema fields,
 * so there is nothing to miss. This runs inside the board-entry transaction,
 * where a throw would roll back the user's board.
 */
export function pointsFor(attempts: number, system: ScoringSystem): number {
  switch (attempts) {
    case 1:
      return system.oneGuess
    case 2:
      return system.twoGuesses
    case 3:
      return system.threeGuesses
    case 4:
      return system.fourGuesses
    case 5:
      return system.fiveGuesses
    case 6:
      return system.sixGuesses
    case 7:
      return system.failed
    default:
      return system.nA
  }
}

/**
 * One player's total for one month.
 *
 * `today` is supplied by the caller rather than read from a clock: the client
 * sends its own local today, and the pure function stays deterministic and
 * testable. Days from `today` onward are not yet due and score nothing; earlier
 * days with no board score the team's N/A value, which is how v1 penalises a
 * miss.
 */
export function monthTotal(opts: {
  month: PuzzleMonth
  scores: Array<ScoredDay>
  system: ScoringSystem
  playWeekends: boolean
  today: PuzzleDay
}): number {
  const { month, scores, system, playWeekends, today } = opts

  // First row wins for a day. Production holds 5 duplicate (player, day) pairs
  // that the copy deliberately preserved, and v1's find() takes the first too.
  const byDay = new Map<PuzzleDay, ScoredDay>()
  for (const score of scores) {
    if (!byDay.has(score.puzzleDay)) byDay.set(score.puzzleDay, score)
  }

  return daysOfMonth(month).reduce((total, day) => {
    if (!playWeekends && isWeekendDay(day)) return total
    const score = byDay.get(day)
    if (score) return total + pointsFor(attemptsFor(score.guesses, score.answer ?? ''), system)
    // Lexicographic compare — 'YYYY-MM-DD' sorts chronologically.
    if (day < today) return total + system.nA
    return total
  }, 0)
}

export type PlayerTotal = { playerId: string; total: number }

/**
 * The month's winner, or null when there is nobody to win.
 *
 * "Nobody to win" means an EMPTY CANDIDATE LIST, and only that. A non-empty
 * list where every total is 0 — or negative — still produces a winner: the
 * first player at the maximum, whatever that maximum is. This is not an
 * incidental quirk of the loop below; it matches v1's
 * `thisMonthsCurrentWinner` (src/lib/types.ts), which seeds its running max at
 * `-Infinity` and its running winner at `''` before walking the same map, so
 * any real score — including 0 — beats the seed and claims the win. Callers
 * that need "did anyone actually play" have to check that separately; this
 * function does not encode it.
 *
 * Strict `>` while walking the list in order, so THE FIRST PLAYER AT THE MAXIMUM
 * WINS A TIE. That is v1's behaviour and callers rely on it being stable.
 *
 * Returns a plain string, not an Id<'players'>: importing the branded type
 * would couple this module to the generated Convex data model and cost it the
 * dependency-free property that lets the browser import it. Callers writing the
 * result back to the database cast it, and that cast is deliberate rather than
 * an oversight.
 */
export function winnerOf(players: Array<PlayerTotal>): string | null {
  let best: PlayerTotal | null = null
  for (const player of players) {
    if (best === null || player.total > best.total) best = player
  }
  return best?.playerId ?? null
}
