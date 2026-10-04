import { addDays, addMonths, monthOf } from './puzzleDay.ts'
import type { PuzzleDay, PuzzleMonth } from './puzzleDay.ts'

/**
 * THE RULES OF A TEAM-VS-TEAM CHALLENGE, in one dependency-light module.
 *
 * WHY EVERYTHING DECIDABLE IS IN HERE. Nothing in this repo can drive an authed
 * Convex wrapper (wordle-teams-obw), so a rule left inside a mutation is a rule
 * no test can execute. The mutations in ../challenges.ts supply inputs; this
 * file decides.
 *
 * WHAT MAY BE IMPORTED HERE. ./puzzleDay.ts and ./teamStats.ts only, both of
 * which the client already pulls in. NOT ../access.ts and NOT ../auth.ts: the
 * banner on globalThreshold.ts has the measurement — reaching the Better Auth
 * server surface from a module the browser imports used to kill the client
 * chunk and is now silent weight, which is harder to notice rather than less
 * wrong.
 */

/**
 * The per-team board floor for a challenge window. Below it that side has no
 * valid figure and the outcome is 'void'.
 *
 * THE ONLY PLACE THE SMALL-SAMPLE HAZARD LIVES. Under pooled averaging one
 * lucky board carries 1/N of the weight and self-damps, so there is deliberately
 * NO per-player minimum — adding one would silently exclude casual members,
 * which is a top-N rule by the back door and was rejected in the design.
 */
export const MIN_CHALLENGE_BOARDS = 10

/** Active challenges one team may hold, counting both directions. */
export const MAX_ACTIVE_CHALLENGES = 5

/** How long a pending proposal survives before it expires. */
export const PROPOSAL_TTL_DAYS = 7

/**
 * Fewer than this many days left in the month at acceptance and the window runs
 * to the end of the FOLLOWING month instead. It is the window's LENGTH, since the
 * window starts the day after acceptance.
 *
 * WITHOUT THIS RULE a late-month challenge is born guaranteed-'void', because it
 * cannot reach MIN_CHALLENGE_BOARDS, which is a bad first experience of the
 * feature. It is the only case in which a window crosses a month boundary, and
 * therefore the only case costing two teamMonthStats documents per team.
 */
export const SHORT_WINDOW_DAYS = 7

export type ChallengeWindow = { startDay: PuzzleDay; endDay: PuzzleDay }

/**
 * The REAL last day of a month. NOT monthRange(month).end: that is the
 * lexicographic bound '<month>-31' even in February, which is not a date, so it
 * would be a wrong endDay and would also skew the window-length count.
 *
 * ARITHMETIC, NOT daysOfMonth(month).at(-1): the array form needs an assertion
 * over a reachable undefined (a malformed month yields an empty array), which
 * is the shape monthWindow.ts rejected for the same reason.
 */
function lastDayOf(month: PuzzleMonth): PuzzleDay {
  return addDays(`${addMonths(month, 1)}-01`, -1)
}

/**
 * The window a challenge accepted on `acceptedOn` covers.
 *
 * THE START IS THE DAY AFTER, NOT THE DAY OF. Every board that counts must have
 * been played knowing the challenge was live; counting the acceptance day would
 * include boards already entered that morning. The whole-month-retroactive
 * alternative was considered and rejected in the design for the same reason.
 *
 * REMAINING DAYS ARE COUNTED BY DAY-OF-MONTH SUBTRACTION, not by date
 * arithmetic, because startDay and the month end are in the same month by
 * construction. That keeps this module's promise that day comparison, month
 * bounding and ranges are all plain string operations.
 */
export function windowFor(acceptedOn: PuzzleDay): ChallengeWindow {
  const startDay = addDays(acceptedOn, 1)
  const month = monthOf(startDay)
  const thisMonthEnd = lastDayOf(month)

  // Inclusive: a start day equal to the month end leaves one day, not zero.
  const windowDays = Number(thisMonthEnd.slice(-2)) - Number(startDay.slice(-2)) + 1
  if (windowDays < SHORT_WINDOW_DAYS) {
    return { startDay, endDay: lastDayOf(addMonths(month, 1)) }
  }
  return { startDay, endDay: thisMonthEnd }
}
