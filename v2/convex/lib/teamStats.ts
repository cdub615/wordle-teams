import { attemptsFor } from './board.ts'
import type { PuzzleDay } from './puzzleDay.ts'

/**
 * The per-team-per-month aggregate, computed from rows.
 *
 * WHY AN AGGREGATE AT ALL: Layer 3 is the most read-heavy surface in the product
 * — six view types multiplied by teammates and months — and bandwidth is the
 * binding cost (wordle-teams-dcu). Every view reads ONE document instead of
 * scanning a month of boards for every member.
 *
 * PURE, so the rollup's correctness is a unit test over fixtures rather than
 * something only a live cron could demonstrate.
 *
 * IT STORES PER-DAY, PER-MEMBER ATTEMPTS, which looks like keeping the raw data
 * and is the point rather than an oversight. Every Layer 3 view needs a different
 * cut of the same month — head-to-head is a per-day comparison, best and worst
 * team days are per-day means, consistency is a spread over a member's days — so
 * pre-reducing to totals would answer one question and forbid the rest. What the
 * aggregate saves is not bytes but READS: one document instead of a scan per
 * member per view.
 *
 * SIZE IS BOUNDED AND SMALL. 31 days times the roster, a few dozen bytes each —
 * about 7 KB for a six-person team, against Convex's 1 MiB document limit. A
 * roster would have to pass roughly a thousand members to approach it.
 */

/**
 * GENERIC OVER THE PLAYER ID so this module can keep importing nothing from the
 * generated data model — Convex's branded `Id<'players'>` is a string with a
 * phantom tag, and taking it as a parameter lets the schema's exact type flow
 * through the aggregate without this file depending on the schema.
 */
export type MemberTotals<PlayerId extends string = string> = {
  playerId: PlayerId
  boards: number
  attempts: number
  solved: number
  failed: number
}

export type DayEntry<PlayerId extends string = string> = { playerId: PlayerId; attempts: number }

export type TeamMonthStats<PlayerId extends string = string> = {
  members: MemberTotals<PlayerId>[]
  days: { puzzleDay: PuzzleDay; entries: DayEntry<PlayerId>[] }[]
}

export type StatsInput<PlayerId extends string = string> = {
  playerId: PlayerId
  puzzleDay: PuzzleDay
  guesses: string[]
  answer?: string
}

/** 7 is the sentinel attemptsFor uses for a board that was never solved. */
const FAILED = 7

/**
 * Reduce one month of one team's boards.
 *
 * DETERMINISTIC IN EVERY ORDERING, which is what makes the rollup idempotent:
 * members follow the roster's order and days sort lexicographically, so the same
 * rows produce a byte-identical document however Convex hands them back. A cron
 * that rewrote the document with reshuffled arrays would be idempotent in meaning
 * and not in fact, and every retry would burn a write.
 *
 * A MEMBER WITH NO BOARDS IS STILL A MEMBER, with zeroes. Dropping them would
 * make "how many teammates did I beat today" silently exclude the people who did
 * not play, which is the opposite of what that sentence means.
 *
 * A BOARD FROM SOMEONE NO LONGER ON THE ROSTER IS DISCARDED. `memberIds` is the
 * roster now, and a departed member's boards must not go on appearing in the
 * team's numbers.
 */
export function aggregateTeamMonth<PlayerId extends string>({
  memberIds,
  scores,
}: {
  memberIds: readonly PlayerId[]
  scores: readonly StatsInput<PlayerId>[]
}): TeamMonthStats<PlayerId> {
  const roster = new Set(memberIds)

  const totals = new Map<PlayerId, MemberTotals<PlayerId>>(
    memberIds.map((playerId) => [
      playerId,
      { playerId, boards: 0, attempts: 0, solved: 0, failed: 0 },
    ]),
  )
  const byDay = new Map<PuzzleDay, DayEntry<PlayerId>[]>()

  for (const score of scores) {
    if (!roster.has(score.playerId)) continue
    // `answer ?? ''` matches convex/lib/scoring.ts, which does exactly this at
    // the other place attempts are computed. dailyScores.answer is optional.
    const attempts = attemptsFor(score.guesses, score.answer ?? '')

    const total = totals.get(score.playerId)!
    total.boards += 1
    total.attempts += attempts
    if (attempts === FAILED) total.failed += 1
    else total.solved += 1

    const entries = byDay.get(score.puzzleDay) ?? []
    entries.push({ playerId: score.playerId, attempts })
    byDay.set(score.puzzleDay, entries)
  }

  return {
    members: memberIds.map((playerId) => totals.get(playerId)!),
    days: [...byDay]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([puzzleDay, entries]) => ({
        puzzleDay,
        // Sorted by roster position, for the determinism reason above — Convex
        // returns rows in index order, which is not roster order.
        entries: entries.sort(
          (a, b) => memberIds.indexOf(a.playerId) - memberIds.indexOf(b.playerId),
        ),
      })),
  }
}

/**
 * Whether two aggregates are the same, so an unchanged month costs no write.
 *
 * THE ROLLUP RUNS HOURLY OVER EVERY TEAM'S CURRENT MONTH, and most hours nothing
 * has changed — a team that played yesterday and not yet today produces an
 * identical document 24 times a day. Writes are the expensive half of the budget
 * this aggregate exists to protect, so rewriting an identical document would
 * spend on the cron exactly what the aggregate saves on reads.
 *
 * COMPARED FIELD BY FIELD, NOT BY JSON.stringify, AND THAT IS NOT FASTIDIOUSNESS.
 * An earlier version did stringify both sides, and it returned false EVERY TIME:
 * Convex hands a stored document back with its object keys in the schema's order,
 * which is not the order the literals here are written in, so two identical
 * aggregates serialised differently. The comparison silently degraded into "always
 * rewrite" — no wrong answers anywhere, just the entire saving quietly cancelled,
 * on a path nothing else would have measured. Caught by the idempotency test
 * asserting `computedAt` was unchanged rather than merely that no second row
 * appeared, and only intermittently even then, since two writes inside one
 * millisecond agree by accident.
 */
export function sameStats(a: TeamMonthStats<string>, b: TeamMonthStats<string>): boolean {
  if (a.members.length !== b.members.length) return false
  for (let i = 0; i < a.members.length; i++) {
    const x = a.members[i]
    const y = b.members[i]
    if (
      x.playerId !== y.playerId ||
      x.boards !== y.boards ||
      x.attempts !== y.attempts ||
      x.solved !== y.solved ||
      x.failed !== y.failed
    ) {
      return false
    }
  }

  if (a.days.length !== b.days.length) return false
  for (let i = 0; i < a.days.length; i++) {
    const x = a.days[i]
    const y = b.days[i]
    if (x.puzzleDay !== y.puzzleDay || x.entries.length !== y.entries.length) return false
    for (let j = 0; j < x.entries.length; j++) {
      if (
        x.entries[j].playerId !== y.entries[j].playerId ||
        x.entries[j].attempts !== y.entries[j].attempts
      ) {
        return false
      }
    }
  }

  return true
}
