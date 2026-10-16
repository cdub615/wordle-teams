import type { PuzzleDay } from '../../convex/lib/puzzleDay.ts'

/**
 * Clue ladder #1 (spec section 6). The share line counts days from here.
 *
 * A PLACEHOLDER UNTIL LAUNCH (owner decision, 2026-10-15). Launch day includes a
 * one-line commit that sets this to the production launch day, and that commit
 * lands BEFORE CLUE_LADDER_ENABLED goes on in production. After that, never
 * change it: it would renumber every line already shared.
 */
export const CLUE_LADDER_DAY_ONE: PuzzleDay = '2026-10-15'

const DAY_MS = 86_400_000

function utcOf(day: PuzzleDay): number {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date)
}

/**
 * 1 on CLUE_LADDER_DAY_ONE. Counted in UTC days, so a clock change never makes it fractional.
 * Never below 1: the server accepts the player's day +-1 of its own, so a player whose
 * day is behind can play DAY_ONE-1 on launch day, and that day shares as #1 rather than #0.
 */
export function clueLadderNumber(day: PuzzleDay): number {
  return Math.max(1, Math.round((utcOf(day) - utcOf(CLUE_LADDER_DAY_ONE)) / DAY_MS) + 1)
}

export function clueLadderShareText(result: {
  date: PuzzleDay
  status: 'solved' | 'failed'
  lockedAtClue: number
}): string {
  const n = clueLadderNumber(result.date)
  return result.status === 'solved' ? `Clue ladder #${n}: solved on clue ${result.lockedAtClue}` : `Clue ladder #${n}: X`
}
