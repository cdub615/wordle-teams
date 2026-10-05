import { addDays, addMonths, monthOf } from './puzzleDay.ts'
import type { PuzzleDay, PuzzleMonth } from './puzzleDay.ts'
import { meanAttemptsOf } from './teamStats.ts'
import type { DayEntry } from './teamStats.ts'

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
 * WHETHER CHALLENGES ARE ON FOR THIS DEPLOYMENT (owner decision D2,
 * wordle-teams-zic8.2.18).
 *
 * Read from the CHALLENGES_ENABLED Convex deployment variable, so it flips in
 * the dashboard with no deploy. While off, `challengesForTeam` reports
 * `{ enabled: false }` and nothing else, and the four mutations that START or
 * ACTIVATE a challenge — proposeToTeam, proposeByLink, acceptChallenge,
 * claimChallengeLink — refuse with CHALLENGES_DISABLED.
 *
 * THE POLARITY IS THE OPPOSITE OF lib/sweeps.ts, DELIBERATELY. DO NOT "FIX" THE
 * INCONSISTENCY. sweeps.ts fails towards ON — only the exact string 'false'
 * stops the sweeps — because there the silent failure is a brake left on. Here
 * the costly mistake points the other way: a scoreboard published before
 * wordle-teams-rac is repaired is a finished result that later has to be
 * restated, in front of both teams. So this is an ALLOW-list: ONLY the exact
 * string 'true' turns challenges on. Unset, empty, 'TRUE', ' true', '1' and
 * 'yes' all keep the feature dark. A typo costs a feature that stays off a
 * little longer, which is visible and recoverable; it never publishes one.
 *
 * THE rac SHIP GATE ATTACHES HERE: this variable is not set in production until
 * wordle-teams-rac is closed.
 *
 * WHAT STAYS WORKING WHILE OFF: decline, withdraw, cancel, setAcceptsChallenges
 * and the daily close. Each only ends or refuses something, and turning the
 * feature off must not strand a challenge that is already running. The source
 * test in ../challenges.test.ts pins both lists.
 *
 * TAKES THE VALUE AS A PARAMETER rather than reading process.env itself, for the
 * reason sweeps.ts gives: it keeps the host's shell out of the assertions, and
 * makes every call site name the variable it consults.
 */

/** The one value that turns challenges ON. Exported so no caller spells it. */
export const CHALLENGES_ON = 'true'

export function challengesEnabled(value: string | undefined): boolean {
  return value === CHALLENGES_ON
}

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

export type ChallengeMemberTotal<PlayerId extends string = string> = {
  readonly playerId: PlayerId
  readonly boards: number
  readonly attempts: number
}
export type ChallengeTotals<PlayerId extends string = string> = {
  readonly boards: number
  readonly attempts: number
  readonly members: ReadonlyArray<ChallengeMemberTotal<PlayerId>>
}

/** The shape of teamMonthStats.days[], narrowed to what a projection needs. */
export type StatsDay<PlayerId extends string = string> = {
  readonly puzzleDay: PuzzleDay
  readonly entries: ReadonlyArray<DayEntry<PlayerId>>
}

/**
 * One team's totals over a challenge window.
 *
 * READS days[], NEVER members[], AND THAT IS THE WHOLE POINT. members[] holds
 * WHOLE-MONTH totals, and a challenge window is almost never a whole month, so
 * using it would silently count boards played before acceptance — exactly the
 * retroactivity windowFor exists to prevent. days[] is complete for the month,
 * so summing the entries inside the window is both correct and the only correct
 * source.
 *
 * ONLY boards AND attempts ARE DERIVABLE THIS WAY — not solved/failed, which
 * exist only on members[]. That is sufficient and not a gap: a failed board is
 * already folded into attempts as 7 by attemptsFor, so nothing in the metric,
 * the outcome or the snapshot needs a separate failure count. Do not reach for
 * members[] to recover one.
 *
 * TAKES days RATHER THAN A STATS DOCUMENT so the caller can concatenate two
 * months for the SHORT_WINDOW_DAYS case without this function knowing about
 * documents at all.
 *
 * STRING COMPARISON ON 'YYYY-MM-DD' IS THE DATE COMPARISON. See lib/puzzleDay.ts
 * on why the format exists.
 *
 * GENERIC OVER THE PLAYER ID, the idiom teamStats.ts documents: a branded
 * Id<'players'> flows through to the result with no cast, so an Id for the wrong
 * table cannot slip in later. startDay/endDay are PuzzleDay so windowFor's output
 * flows in, and a '2026-10' month is rejected rather than silently compared.
 * The default parameter keeps plain-string callers compiling.
 */
export function teamTotalsOver<PlayerId extends string = string>(
  days: ReadonlyArray<StatsDay<PlayerId>>,
  startDay: PuzzleDay,
  endDay: PuzzleDay,
): ChallengeTotals<PlayerId> {
  // The accumulator is mutable and private; the result is a readonly snapshot.
  const byPlayer = new Map<PlayerId, { playerId: PlayerId; boards: number; attempts: number }>()
  let boards = 0
  let attempts = 0

  for (const day of days) {
    if (day.puzzleDay < startDay || day.puzzleDay > endDay) continue
    for (const entry of day.entries) {
      boards += 1
      attempts += entry.attempts
      const total = byPlayer.get(entry.playerId) ?? {
        playerId: entry.playerId,
        boards: 0,
        attempts: 0,
      }
      total.boards += 1
      total.attempts += entry.attempts
      byPlayer.set(entry.playerId, total)
    }
  }

  return { boards, attempts, members: [...byPlayer.values()] }
}

export type ChallengeOutcome = 'challenger' | 'opponent' | 'tie' | 'void'

/**
 * Who won, on pooled average guesses.
 *
 * LOWER IS BETTER. Guess count is the metric, so the smaller average wins. This
 * is the single easiest thing in the feature to implement backwards, which is
 * why both directions are tested rather than one.
 *
 * ROUNDED BEFORE COMPARISON, via meanAttemptsOf rather than a second rounding of
 * our own. That function's banner (wordle-teams-iht.3.3) has the reason: compare
 * raw quotients and two sides can sit one ten-thousandth apart, rank
 * differently, and DISPLAY the identical average — a scoreboard reading 4.0 to
 * 4.0 with a winner named. Here that case must fall through to the board
 * tiebreak.
 *
 * THE BOARD FLOOR IS CHECKED FIRST, so a side that played almost nothing cannot
 * win on a tiny sample. It is the only small-sample guard; see
 * MIN_CHALLENGE_BOARDS.
 *
 * BOARDS BREAK A TIE, which makes participation the decider without making
 * volume the metric — the right incentive for a feature whose point is
 * engagement.
 */
export function outcomeOf(
  challenger: { readonly boards: number; readonly attempts: number },
  opponent: { readonly boards: number; readonly attempts: number },
): ChallengeOutcome {
  if (challenger.boards < MIN_CHALLENGE_BOARDS) return 'void'
  if (opponent.boards < MIN_CHALLENGE_BOARDS) return 'void'

  // NAMED, NOT `a`/`b`. This doc block says direction is the easiest thing here
  // to implement backwards, and the comparisons below are three lines away — so
  // they should read as the rule without the reader holding a mapping in their
  // head. The repo's `a`/`b` precedent (teamStats.ts's statsEqual) is a
  // SYMMETRIC equality, where transposing is harmless; here it inverts the answer.
  const challengerMean = meanAttemptsOf(challenger)
  const opponentMean = meanAttemptsOf(opponent)
  // UNREACHABLE GIVEN THE FLOOR ABOVE — MIN_CHALLENGE_BOARDS > 0, so neither
  // side can have zero boards here. Kept for totality rather than as a guard, and
  // a mutant deleting it SURVIVES the suite. That is expected, not a hole: the
  // alternative is a non-null assertion that would start lying if the floor ever
  // became 0.
  if (challengerMean === null || opponentMean === null) return 'void'

  if (challengerMean < opponentMean) return 'challenger'
  if (opponentMean < challengerMean) return 'opponent'
  if (challenger.boards > opponent.boards) return 'challenger'
  if (opponent.boards > challenger.boards) return 'opponent'
  return 'tie'
}
