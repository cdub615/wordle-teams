import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import { aggregateTeamMonth, sameStats } from './lib/teamStats.ts'
import { monthOf, monthRange, toPuzzleDay } from './lib/puzzleDay.ts'
import { sweepsEnabled } from './lib/sweeps.ts'
import { scheduleLeagueClosesFor } from './leagues.ts'
import { closeDueChallengeFor, closeDueChallengesFor } from './challenges.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseWriter } from 'convex/server'
import type { PuzzleMonth } from './lib/puzzleDay.ts'
import type { TeamMonthStats } from './lib/teamStats.ts'

/**
 * The per-team-per-month aggregate's rollup.
 *
 * TWO TRIGGERS, AND THE SPLIT IS THE DECISION Task B1 ASKED TO BE STATED:
 *
 *   1. ON EVERY BOARD WRITE, for the exact month of the board written. This is
 *      the one that matters, because BACKFILL IS A FREE FEATURE: a player can
 *      edit a month from last year, and a rollup that only ever touched the
 *      current month would leave that month's analytics permanently and silently
 *      wrong. winners.ts's recomputeTeamMonth already runs on exactly this
 *      trigger for exactly this (team, month) pair, so the aggregate rides the
 *      path that already exists rather than inventing a second notion of "a
 *      board changed".
 *   2. DAILY, for the CURRENT month only. This is a safety net rather than the
 *      mechanism: it catches a month whose boundary has just passed, and any
 *      write path that ever forgets trigger 1. It does not walk history, because
 *      history cannot change without a board write, which is trigger 1.
 *
 * SO PAST MONTHS ARE NEVER REWRITTEN UNLESS A BOARD IN THEM CHANGED, which is
 * what B1 asked for, and the cron cost stays proportional to the number of teams
 * rather than to the age of the product.
 */

type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

/** 1-12, matching monthlyWinners rather than JavaScript's 0-11. */
function yearAndMonth(month: PuzzleMonth): { year: number; monthNum: number } {
  const [year, monthNum] = month.split('-').map(Number)
  return { year, monthNum }
}

/**
 * Recompute and store one team's month. Idempotent by construction.
 *
 * WRITES ONLY WHEN THE NUMBERS MOVED. The daily sweep recomputes every team's
 * current month, and on most days nothing has changed — a team that has not
 * played since the last run would otherwise be rewritten for nothing. Writes are
 * the expensive half of the budget this table exists to protect, so spending them
 * to store an identical document would undo the saving on the read side. The
 * equality is safe because aggregateTeamMonth is deterministic in every ordering;
 * lib/teamStats.test.ts is what keeps that true.
 */
export async function rollupTeamMonth(
  ctx: WriterCtx,
  team: Doc<'teams'>,
  month: PuzzleMonth,
): Promise<void> {
  const { start, end } = monthRange(month)

  const scores: MonthScore[] = []
  for (const playerId of team.playerIds) {
    // by_player_and_puzzleDay, bounded to the month. Never a table scan — the
    // whole point of this table is that nothing scans.
    const rows = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', playerId).gte('puzzleDay', start).lte('puzzleDay', end),
      )
      .collect()
    for (const row of rows) scores.push(row)
  }

  await storeTeamMonthStats(ctx, team, month, scores)
}

export type MonthScore = {
  playerId: Id<'players'>
  puzzleDay: string
  guesses: string[]
  answer?: string
}

/**
 * Store the aggregate from rows the CALLER has already read.
 *
 * THIS SPLIT IS A BANDWIDTH DECISION AND A TEST CAUGHT ITS ABSENCE.
 * winners.ts's recomputeTeamMonth runs on every board submission — the most
 * frequent write in the app — and it ALREADY reads exactly these rows to find
 * the month's winner. An earlier version had it call rollupTeamMonth, which read
 * them a second time, and scores.test.ts's write-path bandwidth guard failed
 * immediately: the fixture went from 35 documents to well past its 45 ceiling.
 * Raising that ceiling would have been the wrong fix twice over — it exists to
 * catch precisely this, and doubling the cost of the commonest write to populate
 * a table whose whole purpose is saving bandwidth is self-defeating.
 *
 * So the cron reads (rollupTeamMonth above) and the write path hands over what it
 * already has. The only cost on the write path is one indexed lookup of the
 * existing aggregate, and a write only when the numbers moved.
 */
export async function storeTeamMonthStats(
  ctx: WriterCtx,
  team: Doc<'teams'>,
  month: PuzzleMonth,
  scores: readonly MonthScore[],
): Promise<void> {
  const { year, monthNum } = yearAndMonth(month)
  const stats = aggregateTeamMonth({ memberIds: team.playerIds, scores })

  const existing = await ctx.db
    .query('teamMonthStats')
    .withIndex('by_team_year_month', (q) =>
      q.eq('teamId', team._id).eq('year', year).eq('month', monthNum),
    )
    .unique()

  if (existing) {
    if (sameStats(toStats(existing), stats)) return
    await ctx.db.patch(existing._id, { ...stats, computedAt: Date.now() })
    return
  }

  await ctx.db.insert('teamMonthStats', {
    teamId: team._id,
    year,
    month: monthNum,
    ...stats,
    computedAt: Date.now(),
  })
}

/** The stored document, narrowed to the comparable shape. */
function toStats(row: Doc<'teamMonthStats'>): TeamMonthStats<Id<'players'>> {
  return { members: row.members, days: row.days }
}

/**
 * Every team's CURRENT month, daily, one scheduled execution per team.
 *
 * THE CURRENT MONTH IS RESOLVED IN UTC, and that is acceptable here where it
 * would not be elsewhere. Convex runs in UTC and this sweep only decides WHICH
 * month to refresh — for at most a few hours around a month boundary it refreshes
 * the month a player west of Greenwich has just left instead of the one they have
 * just entered. Both are correct documents; the other one is refreshed on the
 * next board write (trigger 1) or the next hour. Nothing here derives a player's
 * puzzle day from an instant, which is the mistake puzzleDay exists to prevent.
 *
 * COLLECTS `teams`, which is bounded by the number of teams rather than by
 * history — production holds a few hundred. If that ever stops being true this is
 * the function to paginate, and countTable in migrate.ts is the shape to copy.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    // THE SWITCH, BEFORE THE SCAN (wordle-teams-qjh3.1). See convex/lib/sweeps.ts
    // for the polarity and for why the cron entry stays rather than being
    // removed. The `teams` collect on the next line is the whole cost this
    // exists to remove — wordle-teams-yhii identified this sweep as the heaviest
    // of the three crons and the dominant consumer of the free-tier
    // database-I/O allowance — so anything that reads the database must come
    // after it.
    //
    // THAT ORDERING IS ENFORCED IN SOURCE, by the first-statement assertion in
    // convex/lib/sweeps.test.ts, and it needs to be: a mutant that moved this
    // line to just after the collect below SURVIVED every behavioural test in
    // the suite. A sweep that scans and then returns writes exactly as little as
    // one that returns first, so nothing observable could tell them apart —
    // while the switch had quietly stopped saving anything.
    if (!sweepsEnabled(process.env.SWEEPS_ENABLED)) return { teams: 0, skipped: true as const }

    const month = monthOf(toPuzzleDay(new Date()))
    const teams = await ctx.db.query('teams').collect()
    /*
      ONE SCHEDULED MUTATION PER TEAM, NOT ONE MUTATION FOR ALL OF THEM, and the
      limit this respects is not the one wordle-teams-yhii fixed.

      yhii cut this cron from hourly to daily, which divided the MONTHLY
      database-I/O total by 24. That is a budget measured in bytes per month.
      Convex also enforces a hard cap of 4,096 document reads inside a SINGLE
      function execution, and frequency cannot touch that one: the old shape read
      every team plus every member's dailyScores for the month in one mutation,
      so its per-call cost was O(teams x members x boards) with no ceiling. yhii's
      own arithmetic put that at roughly 2,300 documents — about 56% of the cap,
      with the launch email aimed at reactivating 322 dormant accounts.

      Scheduling bounds each execution to ONE team. What remains in this mutation
      is the `teams` scan itself, so the ceiling moves from
      teams x members x boards to teams alone — from a few hundred to a few
      thousand, and it degrades by growing rather than by failing.

      THE SCAN IS STILL THE NEXT THING TO PAGINATE if teams ever approach the
      cap; countTable in migrate.ts is the shape to copy. Measured on the local
      e2e backend, which nothing prunes: 5,203 team rows, 5,007 of them
      fixtures — enough to blow the cap on the scan alone, which is how
      wordle-teams-ndgx was found.
    */
    for (const team of teams) {
      await ctx.scheduler.runAfter(0, internal.teamStats.rollupOne, {
        teamId: team._id,
        month,
      })
    }

    // CHALLENGES CLOSE ON THIS SWEEP, NOT A CRON OF THEIR OWN (wordle-teams-zic8.2):
    // a daily pass at 00:45 UTC is already the right cadence, and crons.ts keeps
    // lanes apart deliberately. NOT ORDERED AFTER THE ROLLUPS ABOVE IN ANY USEFUL
    // SENSE: those are scheduled, run later, and cover only the current month. A
    // closed window's month is kept current by the incremental write path.
    //
    // SCHEDULED, NOT CLOSED HERE (Task 10b, owner decision D5): this expires
    // stale proposals and queues one closeChallenge job per due challenge, as
    // the loop above queues one rollupOne per team. A close that throws fails
    // its own job; it cannot roll this sweep back. THIS EXECUTION STILL QUEUES
    // teams + due challenges jobs, and every challenge comes due on the same
    // day, so the per-execution scheduling cap is shared with the rollups —
    // far from it at this scale, but not immune to it.
    //
    // GATED ON SWEEPS_ENABLED ONLY (the switch above), NEVER ON CHALLENGES_ENABLED:
    // turning the feature off must not strand a challenge that is already running.
    const challenges = await closeDueChallengesFor(ctx, toPuzzleDay(new Date()))
    //
    // LEAGUE MONTHS CLOSE ON THIS SWEEP TOO (zic8.3, spec §9), from day 2, one
    // scheduled job per league. Gated on SWEEPS_ENABLED (above) only.
    const leagueCloses = await scheduleLeagueClosesFor(ctx, toPuzzleDay(new Date()))
    return { teams: teams.length, month, challenges, leagueCloses }
  },
})

/**
 * One team's current month, as its own execution. Scheduled by `sweep`.
 *
 * RE-READS THE TEAM RATHER THAN TAKING IT AS AN ARGUMENT, because a scheduled
 * mutation runs after the one that scheduled it and the row can change or
 * disappear in between — cascadeDeleteTeam is a real path. Passing the document
 * would hand this a snapshot that was already stale on arrival.
 *
 * A MISSING TEAM IS AN ORDINARY OUTCOME, NOT AN ERROR. It means the team was
 * deleted between the sweep and this run, in which case cascadeDeleteTeam has
 * already removed its aggregates and there is nothing here to do. Throwing would
 * turn a normal race into a failed function and a log entry nobody can action.
 */
export const rollupOne = internalMutation({
  args: { teamId: v.id('teams'), month: v.string() },
  handler: async (ctx, { teamId, month }) => {
    const team = await ctx.db.get(teamId)
    if (!team) return { rolled: false as const }
    await rollupTeamMonth(ctx, team, month)
    return { rolled: true as const }
  },
})

/**
 * One due challenge's close, as its own execution. Scheduled by `sweep`, through
 * closeDueChallengesFor; the logic is closeDueChallengeFor in challenges.ts.
 *
 * WHY IT LIVES HERE AND NOT IN challenges.ts: an internal mutation there would be
 * `internal.challenges.*`, and convex/_generated/api.d.ts does not list that
 * module until it is regenerated (wordle-teams-zic8.2.15), so typecheck would
 * fail. This module is already listed, already imports from challenges.ts, and
 * already holds rollupOne, the job this copies.
 *
 * TAKES THE ID, NOT THE DOCUMENT, for rollupOne's reason: the row can change
 * between the sweep and this run — an owner can cancel it, or a team be
 * deleted — and closeDueChallengeFor re-reads it and does nothing unless it is
 * still 'active'.
 *
 * NOT GATED on SWEEPS_ENABLED or CHALLENGES_ENABLED. The sweep that schedules it
 * is already gated, and a job already scheduled must finish: switching the
 * feature off must not strand a challenge that is already running.
 */
export const closeChallenge = internalMutation({
  args: { challengeId: v.id('teamChallenges') },
  handler: async (ctx, { challengeId }) => {
    // A FAILED CLOSE IS RETRIED BY TOMORROW'S SWEEP, and nothing else counts it.
    // Log the id so a row that fails every day can be found from the logs.
    try {
      await closeDueChallengeFor(ctx, challengeId)
    } catch (error) {
      console.error(`teamStats.closeChallenge: ${challengeId} did not close`)
      throw error
    }
  },
})

/**
 * REBUILD ONE MONTH FOR A NAMED SET OF TEAMS. A repair tool, not a schedule.
 *
 * WHY IT EXISTS (wordle-teams-px45). teamMonthStats is a derived cache keyed by
 * team DOCUMENT ID, and the cutover's purge does not clear it while the copy
 * re-inserts every team under a NEW id — so after a purge+copy every row is
 * orphaned and `insights.ts`, which does one `.unique()` lookup with no fallback,
 * renders "Nobody on this team has entered a board this month yet" for teams that
 * plainly did.
 *
 * `sweep` ABOVE CANNOT REPAIR IT, and the reason is a date rather than a design
 * flaw: it computes `monthOf(toPuzzleDay(new Date()))`, so it only ever rebuilds
 * the CURRENT month. The 2026-09-30 cutover landed in the last hours of September
 * UTC; the next sweep fired at 00:45 UTC on October 1 and rebuilt OCTOBER.
 * September was skipped and would never have been revisited.
 *
 * TAKES LEGACY IDS (numeric, as `teams.legacyId` is — players' are UUIDs),
 * NOT DOCUMENT IDS, for two reasons. The caller is a migration
 * script holding Supabase rows, and nothing in this deployment exposes team
 * `_id`s to it — `parityProbe` deliberately returns `legacyId` only, because this
 * repository is public. Resolving the mapping here keeps it that way.
 *
 * AND IT TAKES A LIST RATHER THAN REBUILDING EVERY TEAM, which is the whole
 * reason this is not just `sweep` with a month argument. A team with no boards in
 * the month still produces an aggregate, and `storeTeamMonthStats` would INSERT
 * it — so a blanket rebuild across every team and every month manufactures
 * thousands of zero rows. A zero row is worse than no row: the panel would render
 * an empty scoreboard where the absent-row path renders an honest empty state.
 * The caller passes only the teams that actually have boards that month.
 *
 * SCHEDULES ONE MUTATION PER TEAM, exactly as `sweep` does, for exactly the
 * reason stated there: Convex caps a single execution at 4,096 document reads,
 * and reading every team's members' boards inline is O(teams x members x boards)
 * with no ceiling. What stays here is the `teams` scan.
 *
 * NOT GATED ON SWEEPS_ENABLED, unlike `sweep`. That switch is a production brake
 * on RECURRING background cost (wordle-teams-qjh3.1); this runs once, by hand,
 * with the migration key, to repair data that is currently wrong. A brake that
 * blocked the repair would be the switch working against its own purpose.
 */
export const backfillMonth = internalMutation({
  args: { month: v.string(), teamLegacyIds: v.array(v.number()) },
  handler: async (ctx, { month, teamLegacyIds }) => {
    const wanted = new Set(teamLegacyIds)
    const teams = await ctx.db.query('teams').collect()

    let scheduled = 0
    const matched: number[] = []
    for (const team of teams) {
      const legacyId = team.legacyId
      if (legacyId === undefined || !wanted.has(legacyId)) continue
      await ctx.scheduler.runAfter(0, internal.teamStats.rollupOne, {
        teamId: team._id,
        month: month as PuzzleMonth,
      })
      scheduled += 1
      matched.push(legacyId)
    }

    // THE CALLER NEEDS TO KNOW WHAT IT ASKED FOR AND DID NOT GET. A legacy id with
    // no team in this deployment is silent otherwise, and that is precisely the
    // shape of the bug this function repairs — a reference to a team that no
    // longer exists under that identity.
    const missing = teamLegacyIds.filter((id) => !matched.includes(id))
    return { month, scheduled, teamsScanned: teams.length, missing }
  },
})
