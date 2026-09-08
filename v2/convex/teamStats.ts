import { internalMutation } from './_generated/server'
import { aggregateTeamMonth, sameStats } from './lib/teamStats.ts'
import { monthOf, monthRange, toPuzzleDay } from './lib/puzzleDay.ts'
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
 *   2. HOURLY, for the CURRENT month only. This is a safety net rather than the
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
 * WRITES ONLY WHEN THE NUMBERS MOVED. The hourly sweep recomputes every team's
 * current month, and on most hours nothing has changed — a team that has not
 * played since yesterday would otherwise be rewritten 24 times a day. Writes are
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
 * Every team's CURRENT month, hourly.
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
    const month = monthOf(toPuzzleDay(new Date()))
    const teams = await ctx.db.query('teams').collect()
    for (const team of teams) await rollupTeamMonth(ctx, team, month)
    return { teams: teams.length, month }
  },
})
