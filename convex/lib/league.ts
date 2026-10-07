// convex/lib/league.ts
import { addMonths, daysOfMonth, monthOf } from './puzzleDay.ts'
import type { PuzzleDay, PuzzleMonth } from './puzzleDay.ts'
import { meanAttemptsOf } from './teamStats.ts'

/**
 * THE RULES OF A PUBLIC LEAGUE (wordle-teams-zic8.3), in one dependency-light
 * module. Spec: docs/superpowers/specs/2026-10-07-public-leagues-design.md.
 *
 * WHY EVERYTHING DECIDABLE IS IN HERE. Nothing in this repo can drive an authed
 * Convex wrapper (wordle-teams-obw), so a rule left inside a mutation is a rule
 * no test can execute. ../leagues.ts supplies inputs; this file decides.
 *
 * WHAT MAY BE IMPORTED HERE. ./puzzleDay.ts and ./teamStats.ts only, both of
 * which the client already pulls in. NOT ../access.ts and NOT ../auth.ts — see
 * the banner on lib/challenge.ts for the measurement.
 *
 * GENERIC OVER THE ID TYPES (`G extends string`) so Id<'leagueGroups'> flows
 * through without this module importing the generated data model — the idiom
 * lib/teamStats.ts uses for the same reason.
 */

/** Boards a group needs in a month before it has an average or a rank. */
export const MIN_LEAGUE_BOARDS = 10

/** At or below this many groups the picker is inline buttons; above, a sheet. */
export const PICKER_INLINE_MAX = 6

/** Joined leagues the home card lists before "See all". */
export const HOME_CARD_MAX_LEAGUES = 3

/**
 * WHETHER LEAGUES ARE ON FOR THIS DEPLOYMENT. Read from LEAGUES_ENABLED.
 * AN ALLOW-LIST, for lib/challenge.ts's reason: only the exact string 'true'
 * turns the feature on, so a typo keeps it dark rather than publishing it.
 * The daily close is NOT gated on this — switching the feature off must not
 * leave a played month unclosed.
 */
export const LEAGUES_ON = 'true'

export function leaguesEnabled(value: string | undefined): boolean {
  return value === LEAGUES_ON
}

/**
 * The real last calendar day of `day`'s month. NOT monthRange(month).end, which
 * is always '-31' because it is an index bound, not a date.
 */
export function lastDayOfMonth(day: PuzzleDay): PuzzleDay {
  return daysOfMonth(monthOf(day)).at(-1)!
}

/** A membership interval. `toDay` absent means open. Both bounds inclusive. */
export type Interval<G extends string = string> = {
  groupId: G
  fromDay: PuzzleDay
  toDay?: PuzzleDay
}

export function intervalCovers(interval: Interval, day: PuzzleDay): boolean {
  return day >= interval.fromDay && (interval.toDay === undefined || day <= interval.toDay)
}

export type ScoredBoard = { puzzleDay: PuzzleDay; attempts: number }
export type Totals = { boards: number; attempts: number }

/**
 * One member's contribution to their group for `month`.
 *
 * A board counts iff its day is in `month` AND inside one of the intervals. The
 * spec's one-group-per-month invariant (§4.1) means every covering interval
 * names the same group; the first covering interval's group is taken.
 *
 * NULL WHEN NOTHING COUNTS, which the caller turns into "no member row" — a
 * member with no boards is not a contributor.
 */
export function memberTotalsFor<G extends string>(
  boards: readonly ScoredBoard[],
  intervals: readonly Interval<G>[],
  month: PuzzleMonth,
): (Totals & { groupId: G }) | null {
  let groupId: G | null = null
  let count = 0
  let attempts = 0
  for (const board of boards) {
    if (monthOf(board.puzzleDay) !== month) continue
    const interval = intervals.find((i) => intervalCovers(i, board.puzzleDay))
    if (!interval) continue
    groupId ??= interval.groupId
    count += 1
    attempts += board.attempts
  }
  return groupId === null ? null : { groupId, boards: count, attempts }
}

/**
 * What to add to the group-month row when one member's row goes from `before`
 * to `after`. EXACT BECAUSE `after` IS A FULL RECOMPUTE of that member, not a
 * running counter — a delta of two recomputes cannot drift.
 */
export function groupDelta(before: Totals | null, after: Totals | null): Totals & { contributors: number } {
  return {
    boards: (after?.boards ?? 0) - (before?.boards ?? 0),
    attempts: (after?.attempts ?? 0) - (before?.attempts ?? 0),
    contributors: (after ? 1 : 0) - (before ? 1 : 0),
  }
}

/**
 * A group's month average, or null below MIN_LEAGUE_BOARDS. Rounded to 1dp by
 * meanAttemptsOf BEFORE anything compares it (wordle-teams-iht.3.3).
 */
export function groupAverageOf(totals: Totals): number | null {
  if (totals.boards < MIN_LEAGUE_BOARDS) return null
  return meanAttemptsOf(totals)
}

export type GroupMonthRow<G extends string = string> = Totals & {
  groupId: G
  order: number
  contributors: number
}

export type Standing<G extends string = string> = GroupMonthRow<G> & {
  average: number | null
  rank: number | null
}

/**
 * Ranked groups first — LOWER AVERAGE FIRST, ties on the 1dp average broken by
 * MORE boards — then unranked groups by boards (their progress) and display
 * order. Ranks are 1..n over ranked groups only.
 */
export function standingsOf<G extends string>(rows: readonly GroupMonthRow<G>[]): Standing<G>[] {
  const withAvg = rows.map((row) => ({ ...row, average: groupAverageOf(row) }))
  const ranked = withAvg
    .filter((row) => row.average !== null)
    .sort((a, b) => a.average! - b.average! || b.boards - a.boards || a.order - b.order)
  const unranked = withAvg
    .filter((row) => row.average === null)
    .sort((a, b) => b.boards - a.boards || a.order - b.order)
  return [
    ...ranked.map((row, i) => ({ ...row, rank: i + 1 })),
    ...unranked.map((row) => ({ ...row, rank: null })),
  ]
}

/**
 * The month's winner: the top ranked group, or null when none qualified OR the
 * top two are tied on BOTH the 1dp average and boards — an exact tie names no
 * single winner.
 */
export function winnerOf<G extends string>(standings: readonly Standing<G>[]): G | null {
  const [first, second] = standings
  if (!first || first.rank === null) return null
  if (second && second.rank !== null && second.average === first.average && second.boards === first.boards) {
    return null
  }
  return first.groupId
}

/**
 * The Pro contribution view. `shift` is the group's average WITH the member
 * minus WITHOUT them: negative means the member pulls the group's average down,
 * which is good. Null when either side is below the floor.
 */
export function contributionOf(
  member: Totals,
  group: Totals,
): { mine: number | null; group: number | null; shift: number | null } {
  const withMember = groupAverageOf(group)
  const without = groupAverageOf({
    boards: group.boards - member.boards,
    attempts: group.attempts - member.attempts,
  })
  const shift =
    withMember === null || without === null ? null : Math.round((withMember - without) * 10) / 10 + 0
  return { mine: meanAttemptsOf(member), group: withMember, shift }
}

/**
 * The month the daily sweep should close today, if any.
 *
 * FROM DAY 2, NOT DAY 1 (spec §9): at 00:45 UTC on the 1st a player at UTC-12
 * still has hours to play the last day, and a close then freezes the result
 * without their boards forever.
 *
 * NEVER A MONTH BEFORE THE LEAGUE EXISTED — otherwise launch day snapshots an
 * empty "no winner" month nobody could have played.
 */
export function monthToClose(today: PuzzleDay, leagueCreatedDay: PuzzleDay): PuzzleMonth | null {
  if (Number(today.slice(8, 10)) < 2) return null
  const month = addMonths(monthOf(today), -1)
  return month < monthOf(leagueCreatedDay) ? null : month
}
