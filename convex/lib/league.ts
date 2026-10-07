// convex/lib/league.ts
import { addDays, addMonths, daysOfMonth, monthOf, monthRange } from './puzzleDay.ts'
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
/** 'YYYY-MM' as the two numbers the month tables store (1-12). */
export function yearMonthOf(month: PuzzleMonth): { year: number; month: number } {
  const [year, m] = month.split('-').map(Number)
  return { year, month: m }
}

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
 * CALLERS MUST PASS ONE LEAGUE'S INTERVALS: Interval carries no leagueId, so
 * intervals from two leagues would be mixed. The group pick relies on the
 * one-group-per-league-per-month invariant above; if it were broken this would
 * mis-attribute silently (to the first covered board's group) rather than fail.
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
 *
 * EXPECTS standingsOf's OUTPUT ORDER (best first); it does not sort.
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
 *
 * RETURNS LAST MONTH ON EVERY DAY FROM THE 2ND ONWARD, so the close MUST be
 * idempotent (it is: the caller skips a month that already has a snapshot).
 * A sweep outage longer than a month never closes the skipped month.
 */
export function monthToClose(today: PuzzleDay, leagueCreatedDay: PuzzleDay): PuzzleMonth | null {
  if (Number(today.slice(8, 10)) < 2) return null
  const month = addMonths(monthOf(today), -1)
  return month < monthOf(leagueCreatedDay) ? null : month
}

/**
 * ONE STEP OF A MEMBERSHIP CHANGE, against the player's intervals for ONE
 * league, by index into the array the planner was given. The handler maps
 * indexes to document ids and applies the ops in order. The handler must map
 * EVERY index to a document id BEFORE applying any op: no op references a row
 * an earlier op inserted, and no plan touches one index twice. The order of the
 * input intervals does not matter to the planners.
 *
 *   insert   — a new interval
 *   patch    — set an interval's toDay
 *   reopen   — clear an interval's toDay
 *   retarget — change a not-yet-started interval's group
 *   delete   — remove an interval
 */
export type IntervalOp<G extends string = string> =
  | { op: 'insert'; groupId: G; fromDay: PuzzleDay }
  | { op: 'patch'; index: number; toDay: PuzzleDay }
  | { op: 'reopen'; index: number }
  | { op: 'retarget'; index: number; groupId: G }
  | { op: 'delete'; index: number }

/**
 * `countFrom`/`countTo` move leagueGroups.memberCount. memberCount counts a
 * member under their LATEST live group, so a pending switcher counts for the
 * group they are switching to.
 */
export type MembershipPlan<G extends string = string> =
  | { ops: IntervalOp<G>[]; countFrom: G | null; countTo: G | null }
  | { refused: 'ALREADY_IN_LEAGUE' | 'NOT_IN_LEAGUE' }

/** A plan whose count move is net-zero (countFrom === countTo) moves nothing. */
function planOf<G extends string>(ops: IntervalOp<G>[], countFrom: G | null, countTo: G | null): MembershipPlan<G> {
  return countFrom === countTo ? { ops, countFrom: null, countTo: null } : { ops, countFrom, countTo }
}

type Live<G extends string> = { started: number | null; pending: number | null; groupOf: (i: number) => G }

/**
 * A pending interval is the genuine successor of a closed one only when it opens
 * the day after the close AND on the 1st of a month: that is a switch. (A leave
 * ON the last day of a month followed by a same-day rejoin is indistinguishable
 * from a switch; that is harmless, since every later op on it is valid.)
 */
function isSwitchSuccessor(closedOn: PuzzleDay, pendingFrom: PuzzleDay): boolean {
  return pendingFrom === addDays(closedOn, 1) && pendingFrom === monthRange(monthOf(pendingFrom)).start
}

/**
 * Index of the started and the pending interval, if any. An interval carrying a
 * toDay is live ONLY while its genuine switch successor is pending. Otherwise it
 * has been LEFT, whatever the date, so leaving ends membership the same day.
 */
function liveOf<G extends string>(intervals: readonly Interval<G>[], today: PuzzleDay): Live<G> {
  let started: number | null = null
  let pending: number | null = null
  for (const [i, interval] of intervals.entries()) {
    if (interval.fromDay > today) pending = i
  }
  for (const [i, interval] of intervals.entries()) {
    if (interval.fromDay > today) continue
    if (interval.toDay === undefined) {
      started = i
    } else if (pending !== null && isSwitchSuccessor(interval.toDay, intervals[pending].fromDay)) {
      // `toDay >= today` is implied (the successor opens after today); kept as a
      // deliberate guard, an equivalent mutant no test can kill.
      if (interval.toDay >= today) started = i
    }
  }
  return { started, pending, groupOf: (i) => intervals[i].groupId }
}

function firstOfNextMonth(today: PuzzleDay): PuzzleDay {
  return monthRange(addMonths(monthOf(today), 1)).start
}

/** Where a join into `groupId` opens: tomorrow, or the 1st if a DIFFERENT group already counted this month. */
function joinFromDayFor<G extends string>(intervals: readonly Interval<G>[], today: PuzzleDay, groupId: G): PuzzleDay {
  const monthStart = monthRange(monthOf(today)).start
  // The `toDay === undefined` branch is defensive: callers pass only non-live intervals.
  const otherGroupThisMonth = intervals.some(
    (i) => i.groupId !== groupId && (i.toDay === undefined || i.toDay >= monthStart),
  )
  return otherGroupThisMonth ? firstOfNextMonth(today) : addDays(today, 1)
}

/**
 * Join. From TOMORROW (spec §3: non-retroactive), unless the player already
 * counted for a DIFFERENT group earlier this month, in which case from the 1st —
 * one group per league per month (§4.1, §10).
 */
export function planJoin<G extends string>(
  intervals: readonly Interval<G>[],
  today: PuzzleDay,
  groupId: G,
): MembershipPlan<G> {
  const live = liveOf(intervals, today)
  if (live.started !== null || live.pending !== null) return { refused: 'ALREADY_IN_LEAGUE' }
  const fromDay = joinFromDayFor(intervals, today, groupId)
  return planOf([{ op: 'insert', groupId, fromDay }], null, groupId)
}

/** Switch. Takes effect on the 1st; see the state table in the plan's Task 2. */
export function planSwitch<G extends string>(
  intervals: readonly Interval<G>[],
  today: PuzzleDay,
  groupId: G,
): MembershipPlan<G> {
  const { started, pending, groupOf } = liveOf(intervals, today)
  if (started === null && pending === null) return { refused: 'NOT_IN_LEAGUE' }

  if (pending !== null) {
    const pendingGroup = groupOf(pending)
    if (started !== null && groupOf(started) === groupId) {
      return planOf([{ op: 'delete', index: pending }, { op: 'reopen', index: started }], pendingGroup, groupId)
    }
    if (pendingGroup === groupId) return { ops: [], countFrom: null, countTo: null }
    if (started === null) {
      // Pending only: it must open where a fresh join into the new group would.
      const fromDay = joinFromDayFor(
        intervals.filter((_, i) => i !== pending),
        today,
        groupId,
      )
      if (fromDay !== intervals[pending].fromDay) {
        return planOf([{ op: 'delete', index: pending }, { op: 'insert', groupId, fromDay }], pendingGroup, groupId)
      }
    }
    return planOf([{ op: 'retarget', index: pending, groupId }], pendingGroup, groupId)
  }

  const current = groupOf(started!)
  if (current === groupId) return { ops: [], countFrom: null, countTo: null }
  return planOf(
    [
      { op: 'patch', index: started!, toDay: lastDayOfMonth(today) },
      { op: 'insert', groupId, fromDay: firstOfNextMonth(today) },
    ],
    current,
    groupId,
  )
}

/** Leave. Effective today; boards already counted stay counted (§3). */
export function planLeave<G extends string>(intervals: readonly Interval<G>[], today: PuzzleDay): MembershipPlan<G> {
  const { started, pending, groupOf } = liveOf(intervals, today)
  if (started === null && pending === null) return { refused: 'NOT_IN_LEAGUE' }
  const ops: IntervalOp<G>[] = []
  if (started !== null) ops.push({ op: 'patch', index: started, toDay: today })
  if (pending !== null) ops.push({ op: 'delete', index: pending })
  return planOf(ops, groupOf(pending ?? started!), null)
}

/** What a player's membership looks like today, for myLeagues. Null if not a member. */
export function membershipOf<G extends string>(
  intervals: readonly Interval<G>[],
  today: PuzzleDay,
): { groupId: G; since: PuzzleDay; pendingGroupId: G | null; pendingFrom: PuzzleDay | null } | null {
  const { started, pending } = liveOf(intervals, today)
  if (started === null && pending === null) return null
  if (started === null) {
    const p = intervals[pending!]
    return { groupId: p.groupId, since: p.fromDay, pendingGroupId: null, pendingFrom: null }
  }
  const s = intervals[started]
  // A "pending" interval in the SAME group (a last-day leave then rejoin) is not a switch to report.
  const p = pending === null || intervals[pending].groupId === s.groupId ? null : intervals[pending]
  return { groupId: s.groupId, since: s.fromDay, pendingGroupId: p?.groupId ?? null, pendingFrom: p?.fromDay ?? null }
}
