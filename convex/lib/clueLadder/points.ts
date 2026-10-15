import type { ScoringSystem } from '../scoring.ts'

/**
 * The clue ladder scores 1–6 and missed days with the team's own points, but X
 * is fixed at -1 (owner decision 2026-10-14). With a team's default X of -3,
 * locking in one clue early is a losing bet, and the simulation dry run showed
 * careful players winning about 90% of months. Plan 1 reuses this for the
 * team scoreboard.
 */
export const CLUE_LADDER_FAILED_POINTS = -1

export function clueLadderSystem(team: ScoringSystem): ScoringSystem {
  return { ...team, failed: CLUE_LADDER_FAILED_POINTS }
}
