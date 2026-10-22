import type { PuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { CLUE_LADDER_DAY_ONE } from '../../convex/lib/clueLadder/dayOne.ts'

// Clue ladder #1, the launch day. It lives with the server, which also counts
// default teams' scoreboards from it; see its comment there.
export { CLUE_LADDER_DAY_ONE }

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
