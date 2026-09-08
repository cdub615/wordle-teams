import type { TeamMonthStats } from '../../convex/lib/teamStats.ts'
import type { PuzzleDay, PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * Layer 3 — team analytics, computed entirely from B1's aggregate.
 *
 * EVERY VIEW READS THE AGGREGATE, NOTHING SCANS BOARDS. That is the whole cost
 * model (wordle-teams-dcu): six view types multiplied by teammates and months is
 * the most read-heavy surface in the product, and one precomputed document per
 * team per month is what makes it affordable.
 *
 * PRIVACY IS SETTLED AND IS NOT RE-ARGUED HERE. The spec establishes by
 * measurement that getTeamMonth already returns every teammate's guesses and
 * answer to every member, and team-boards.tsx renders them — so these summaries
 * expose nothing a member cannot already read board by board. That is exactly why
 * the >=30 threshold belongs to Layer 4 and NOT to this module: applying it here
 * would suppress a five-person team's own numbers from itself, which is the
 * opposite of the feature.
 *
 * EVERY FUNCTION HAS A DEFINED ANSWER FOR AN EMPTY MONTH AND A ONE-MEMBER TEAM.
 * Both are ordinary rather than exceptional — a solo team is the most common shape
 * in this product, and a month nobody has played yet exists on the first of every
 * month. Nothing divides without checking, and each returns a shape the UI can
 * render as a stated empty state rather than NaN.
 */

/** A player id, kept as a plain string so this module needs no generated types. */
type PlayerId = string

export type TeamMonth = TeamMonthStats<PlayerId>

/** Mean, or null when there is nothing to take a mean of. */
function meanOf(values: number[]): number | null {
  if (values.length === 0) return null
  return round1(values.reduce((total, n) => total + n, 0) / values.length)
}

/** One decimal, never `-0`. */
function round1(value: number): number {
  return Math.round(value * 10) / 10 + 0
}

export type HeadToHead = {
  opponentId: PlayerId
  /** Days both players entered a board. Only these can be compared. */
  shared: number
  wins: number
  losses: number
  ties: number
}

/**
 * How the viewer fares against each teammate, day by day.
 *
 * ONLY DAYS BOTH PLAYED COUNT. A day the opponent skipped is not a win — it is an
 * absence, and scoring it as a win would make the most flattering record belong to
 * whoever has the least active teammates. `shared` is reported so the UI can say
 * "3-1 over 4 shared days" rather than implying a whole month.
 *
 * FEWER ATTEMPTS WINS, since attempts are guesses and 7 is a failure.
 */
export function headToHead(stats: TeamMonth, viewerId: PlayerId): HeadToHead[] {
  const records = new Map<PlayerId, HeadToHead>(
    stats.members
      .filter((member) => member.playerId !== viewerId)
      .map((member) => [
        member.playerId,
        { opponentId: member.playerId, shared: 0, wins: 0, losses: 0, ties: 0 },
      ]),
  )

  for (const day of stats.days) {
    const mine = day.entries.find((entry) => entry.playerId === viewerId)
    if (mine === undefined) continue
    for (const entry of day.entries) {
      const record = records.get(entry.playerId)
      if (record === undefined) continue
      record.shared += 1
      if (mine.attempts < entry.attempts) record.wins += 1
      else if (mine.attempts > entry.attempts) record.losses += 1
      else record.ties += 1
    }
  }

  return [...records.values()]
}

export type MemberAverage = {
  playerId: PlayerId
  boards: number
  /** Null when they entered no boards this month. */
  meanAttempts: number | null
}

/** Each member's month, and the team's own mean for comparison. */
export function memberAverages(stats: TeamMonth): {
  members: MemberAverage[]
  teamMean: number | null
} {
  const members = stats.members.map((member) => ({
    playerId: member.playerId,
    boards: member.boards,
    meanAttempts: member.boards === 0 ? null : round1(member.attempts / member.boards),
  }))

  const played = stats.members.filter((member) => member.boards > 0)
  const teamMean =
    played.length === 0
      ? null
      : round1(
          played.reduce((total, m) => total + m.attempts, 0) /
            played.reduce((total, m) => total + m.boards, 0),
        )

  return { members, teamMean }
}

export type TeamDay = { puzzleDay: PuzzleDay; entries: number; meanAttempts: number }

/**
 * The team's best and worst days of the month.
 *
 * A DAY NEEDS AT LEAST ONE ENTRY, which the aggregate guarantees — it only records
 * days somebody played. Ties break on the earlier day, so the answer is stable
 * rather than dependent on iteration order.
 */
export function bestAndWorstDays(stats: TeamMonth): { best: TeamDay | null; worst: TeamDay | null } {
  const days: TeamDay[] = stats.days.map((day) => ({
    puzzleDay: day.puzzleDay,
    entries: day.entries.length,
    meanAttempts: round1(
      day.entries.reduce((total, entry) => total + entry.attempts, 0) / day.entries.length,
    ),
  }))
  if (days.length === 0) return { best: null, worst: null }

  let best = days[0]
  let worst = days[0]
  for (const day of days.slice(1)) {
    if (day.meanAttempts < best.meanAttempts) best = day
    if (day.meanAttempts > worst.meanAttempts) worst = day
  }
  return { best, worst }
}

export type MemberConsistency = {
  playerId: PlayerId
  boards: number
  meanAttempts: number | null
  /** Population spread, or null with no boards. */
  spread: number | null
}

/**
 * How steady each member is, from their own days.
 *
 * POPULATION SPREAD, matching lib/insights-personal.ts: these are all the boards
 * the member played that month rather than a sample of them, and it also makes a
 * single board report 0 instead of dividing by zero.
 */
export function memberConsistency(stats: TeamMonth): MemberConsistency[] {
  const attemptsBy = new Map<PlayerId, number[]>(
    stats.members.map((member) => [member.playerId, []]),
  )
  for (const day of stats.days) {
    for (const entry of day.entries) attemptsBy.get(entry.playerId)?.push(entry.attempts)
  }

  return stats.members.map((member) => {
    const attempts = attemptsBy.get(member.playerId) ?? []
    const mean = meanOf(attempts)
    if (mean === null) {
      return { playerId: member.playerId, boards: 0, meanAttempts: null, spread: null }
    }
    const variance =
      attempts.reduce((total, n) => total + (n - mean) ** 2, 0) / attempts.length
    return {
      playerId: member.playerId,
      boards: attempts.length,
      meanAttempts: mean,
      spread: round1(Math.sqrt(variance)),
    }
  })
}

export type MonthPoint = { month: PuzzleMonth; boards: number; meanAttempts: number | null }

/** The team's mean per month, oldest first, for the trend line. */
export function teamTrend(months: { month: PuzzleMonth; stats: TeamMonth }[]): MonthPoint[] {
  return months
    .map(({ month, stats }) => {
      const boards = stats.members.reduce((total, m) => total + m.boards, 0)
      const attempts = stats.members.reduce((total, m) => total + m.attempts, 0)
      return { month, boards, meanAttempts: boards === 0 ? null : round1(attempts / boards) }
    })
    .sort((a, b) => a.month.localeCompare(b.month))
}

export type Improvement = { playerId: PlayerId; from: number; to: number; delta: number }

/**
 * Who improved most between two months.
 *
 * IMPROVEMENT IS A FALL IN ATTEMPTS, so `delta` is `from - to` and a positive
 * number is better. Naming it plainly here is worth more than a comment at every
 * call site.
 *
 * ONLY MEMBERS WITH BOARDS IN BOTH MONTHS ARE RANKED. Someone who did not play in
 * one of them has no change to measure, and treating an absence as a score is how
 * a "most improved" list ends up led by whoever took a month off.
 */
export function mostImproved(previous: TeamMonth, current: TeamMonth): Improvement[] {
  const before = new Map(previous.members.map((m) => [m.playerId, m]))

  return current.members
    .flatMap((member) => {
      const was = before.get(member.playerId)
      if (was === undefined || was.boards === 0 || member.boards === 0) return []
      const from = round1(was.attempts / was.boards)
      const to = round1(member.attempts / member.boards)
      return [{ playerId: member.playerId, from, to, delta: round1(from - to) }]
    })
    .sort((a, b) => b.delta - a.delta || a.playerId.localeCompare(b.playerId))
}
