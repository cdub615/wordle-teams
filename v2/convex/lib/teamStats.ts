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

/**
 * THE FREE TIER'S SLICE — identities and (at most) one day, never the totals
 * (wordle-teams-iht.3.2).
 *
 * WHY IT IS A SEPARATE TYPE RATHER THAN A TeamMonthStats WITH THE NUMBERS SET
 * TO ZERO. A zero here would mean "withheld" while reading as "played nothing",
 * and the first surface to render it would say so out loud — a real score of 0
 * and a redacted one must not be the same value. So the fields are ABSENT and
 * the compiler is what stops anyone reading them.
 *
 * TeamMonthStats IS ASSIGNABLE TO THIS, which is the whole reason it is shaped
 * as a widening rather than as a sibling: MemberTotals already carries
 * `playerId`, so a function that only needs identities and a day — dailyTeamFact
 * is the only one — can take this type and accept BOTH payloads without a cast
 * and without a second code path. The narrowing is real (no totals reach the
 * wire) while the consumer stays single.
 *
 * `days` IS ZERO OR ONE ENTRY IN PRACTICE, not the whole month. The type cannot
 * say so and deliberately does not try: the paid payload satisfies it with
 * thirty-one, and a length the type cannot enforce is better asserted in the
 * test that watches the wire (convex/insights.test.ts) than implied here.
 */
export type TeamMonthTeaser<PlayerId extends string = string> = {
  members: { playerId: PlayerId }[]
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

/**
 * One member's mean attempts for the month, rounded the way it is DISPLAYED, or
 * null when they have not played.
 *
 * THE SINGLE DEFINITION OF "HOW WELL DID THEY DO" (wordle-teams-iht.3.3). It
 * lives here rather than in src/lib/insights-team.ts because BOTH sides need it
 * now: that module's `memberAverages` renders it in the paid panel, and
 * `teamRank` below sends the free tier a position derived from it. Two
 * implementations of the same average is how the teaser and the panel come to
 * disagree about who is ahead, in front of the person being asked to pay.
 *
 * ROUNDED BEFORE COMPARISON, WHICH IS THE PART THAT IS EASY TO GET WRONG. Rank
 * on the raw quotient and two members can sit one ten-thousandth apart, rank
 * differently, and DISPLAY the identical average — a panel saying two people
 * scored 3.4 while the teaser puts one of them ahead of the other. Ranking the
 * rounded value is what keeps the two surfaces telling the same story.
 */
export function meanAttemptsOf(member: { boards: number; attempts: number }): number | null {
  if (member.boards === 0) return null
  // `+ 0` normalises -0, which would otherwise print as "-0".
  return Math.round((member.attempts / member.boards) * 10) / 10 + 0
}

/**
 * Why the viewer has a standing, or why they do not.
 *
 * A TAG RATHER THAN A NULLABLE PAIR, because the free client cannot work the
 * reason out for itself any more (wordle-teams-iht.2). Since iht.3 it holds
 * identities and today's entry; "have I played this month" and "has anybody
 * else" are both facts about the per-member totals that the payload gate
 * deliberately withholds. The server knows, so the server says.
 *
 * IT LEAKS NOTHING NEW. Each tag is something the viewer can already establish:
 * they know whether they have played, the roster is on the dashboard, and
 * "nobody else has played" is visible in the scores table.
 *
 * `solo` IS NOT DECIDED HERE — see teamMonth. It is a fact about the ROSTER,
 * and this function only sees the aggregate, which can lag a roster change.
 */
export type TeamRankTeaser =
  | { kind: 'ranked'; rank: number; of: number }
  | { kind: 'not-played' }
  | { kind: 'nobody-else' }
  | { kind: 'solo' }

/**
 * Where the viewer stands among the teammates who have actually played.
 *
 * THE ONE REAL FIGURE THE FREE TIER GETS (wordle-teams-iht.3.3). It is the hook
 * the locked panel is built around — "You're 3rd of 5 this month" — and it is
 * safe to send precisely because it does not decompose: a rank does not yield
 * the averages it came from, so it points at the paid surface without being it.
 *
 * FEWER ATTEMPTS IS BETTER, the same direction headToHead uses.
 *
 * COMPETITION RANKING (1, 2, 2, 4), NOT DENSE (1, 2, 2, 3). "3rd of 5" has to
 * mean two people are ahead, because that is how a reader counts it. Under dense
 * ranking a reader can be "3rd" with three people ahead of them, which makes the
 * sentence quietly false.
 *
 * THE DENOMINATOR IS RANKED MEMBERS, NOT THE ROSTER. "5th of 5" on a team where
 * only two people have played is a lie about the reader, and the roster size is
 * the number a careless implementation reaches for first. Members with no boards
 * cannot be placed and are not counted.
 *
 * A TAG RATHER THAN A FLATTERING ANSWER, in the two cases where there is no
 * position to report:
 *   - THE VIEWER HAS NOT PLAYED. They cannot be ranked. Absent, never last —
 *     "last of 5" for someone who simply has not started is the opposite of a
 *     reason to come back.
 *   - NOBODY ELSE HAS. "1st of 1" is true and worthless, and dressing it up as
 *     an achievement is the kind of thing a reader notices and stops trusting.
 *     lib/insights-team.ts's header makes the point that a solo team is the most
 *     common shape in this product, so this is the ordinary case, not an edge.
 */
export function teamRank<PlayerId extends string>(
  members: MemberTotals<PlayerId>[],
  viewerId: PlayerId,
): TeamRankTeaser {
  const played = members
    .map((member) => ({ playerId: member.playerId, mean: meanAttemptsOf(member) }))
    .filter((member): member is { playerId: PlayerId; mean: number } => member.mean !== null)

  const mine = played.find((member) => member.playerId === viewerId)
  // THE ASK IS ON THEM. Also covers a viewer absent from the aggregate entirely,
  // which is the same thing from the reader's side: no boards this month.
  if (!mine) return { kind: 'not-played' }
  // THEY TURNED UP AND NOBODY ELSE DID. Not their fault, and the copy says so.
  if (played.length < 2) return { kind: 'nobody-else' }

  // Competition ranking: one plus however many are strictly better.
  const ahead = played.filter((member) => member.mean < mine.mean).length
  return { kind: 'ranked', rank: ahead + 1, of: played.length }
}
