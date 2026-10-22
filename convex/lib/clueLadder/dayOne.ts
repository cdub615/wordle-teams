import { utcDayOf, type PuzzleDay } from '../puzzleDay.ts'

/**
 * Clue ladder #1, the LAUNCH DAY (spec section 6). The share line counts days
 * from here, and a team that never touched its clue ladder setting counts its
 * scoreboard from here (wordle-teams-9j7o.2.11). One date for both, so share
 * #1 and the first scored day cannot disagree.
 *
 * Here rather than in src/lib/clue-ladder-share.ts so the server can read it;
 * that module re-exports it.
 *
 * A PLACEHOLDER UNTIL LAUNCH (owner decision, 2026-10-15). Launch day includes a
 * one-line commit that sets this to the production launch day, and that commit
 * lands BEFORE CLUE_LADDER_ENABLED goes on in production. After that, never
 * change it: it would renumber every line already shared, and move every
 * default team's first scored day.
 */
export const CLUE_LADDER_DAY_ONE: PuzzleDay = '2026-10-15'

/**
 * The first day a team's clue ladder scoreboard counts (wordle-teams-k1v5,
 * wordle-teams-9j7o.2.11). Days before it show blank, not X.
 *
 * - The day the owner last switched it on, when one is stored.
 * - Otherwise the team is on by default, and it counts from the day the clue
 *   ladder reached it: the launch day, or the day the team was created if that
 *   is later. That day is read in UTC, since the server has no creator's date
 *   for it, so it can be a day off from theirs. The error is a blank cell,
 *   never an X, and a result always counts whatever its date.
 *
 * createdAt is a migrated team's ORIGINAL creation time; _creationTime stands
 * in when it is missing.
 */
export function clueLadderCountsFrom(team: {
  clueLadderOnSince?: PuzzleDay
  createdAt?: number
  _creationTime: number
}): PuzzleDay {
  if (team.clueLadderOnSince !== undefined) return team.clueLadderOnSince
  const created = utcDayOf(team.createdAt ?? team._creationTime)
  return created > CLUE_LADDER_DAY_ONE ? created : CLUE_LADDER_DAY_ONE
}
