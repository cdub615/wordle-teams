import { hasCompleteProfile } from './lib/player.ts'
import { monthRange } from './lib/puzzleDay.ts'
import { monthTotal, winnerOf } from './lib/scoring.ts'
import { systemFor } from './lib/scoringSystem.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { PuzzleDay, PuzzleMonth } from './lib/puzzleDay.ts'
import type { GenericDatabaseWriter } from 'convex/server'

/**
 * Monthly-winner recomputation, extracted from scores.ts (wordle-teams-4gj).
 *
 * This is v1's update_monthly_winners trigger, relocated. Two differences from
 * the SQL, both deliberate and both unchanged by the extraction:
 *
 * 1. The SQL DELETEs the row and re-INSERTs it, which silently wipes
 *    hasSeenCelebration every time anyone enters a board dated in that month —
 *    re-firing the confetti at someone who already dismissed it. Here the array
 *    survives an unchanged winner and resets only when the winner really changes.
 * 2. v1 computed this on the CLIENT for every team it had loaded and passed the
 *    result to the RPC. Here it is derived server-side inside the caller's
 *    transaction, so it cannot be stale or forged.
 *
 * It lives in its own module because Phase 3 calls it from three mutations that
 * have nothing to do with board entry — removeMember, updateTeam when
 * playWeekends flips, and setScoringSystem. Before the extraction the only way
 * to reach it was to construct a valid board submission and pass it through the
 * whole upsert machinery, which is also why its five behaviours had no direct
 * tests.
 */

/**
 * Anything with a `db` writer — a mutation, or a convex-test `ctx.run` callback.
 * Mirrors scores.ts's WriterCtx for the same reason: nothing here touches
 * anything but `ctx.db`, so convex-test's callback ctx satisfies it with no cast.
 *
 * Exported, unlike scores.ts's private copy: Phase 3 tasks 6, 7 and 8 add
 * mutations to convex/teams.ts (removeMember, updateTeam, setScoringSystem)
 * that call into this module and need the type to declare their own ctx
 * parameters. The asymmetry with scores.ts is deliberate, not a drift risk —
 * scores.ts's WriterCtx has no cross-module caller and has no reason to be
 * exported.
 */
export type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

/**
 * The scoring system that governed one month for one team.
 *
 * Reads every version row for the team — a team accumulates one per month it
 * was edited in, which is a handful — and resolves with the pure systemFor. The
 * team doc's own eight fields are the fallback, which is what makes existing
 * teams need no backfill.
 */
export async function systemForTeamMonth(
  ctx: WriterCtx,
  team: Doc<'teams'>,
  month: PuzzleMonth,
) {
  const versions = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', team._id))
    .collect()
  return systemFor(team, versions, month)
}

/**
 * Recompute one team's winner for one month.
 *
 * `today` decides which missed days are already due and therefore score the
 * team's nA value; for a month in the past every day is due, which is correct.
 */
export async function recomputeTeamMonth(
  ctx: WriterCtx,
  team: Doc<'teams'>,
  month: PuzzleMonth,
  today: PuzzleDay,
): Promise<void> {
  const [year, monthNum] = month.split('-').map(Number)
  const { start, end } = monthRange(month)
  // Resolved INSIDE this function, so recomputeTeamMonths — which loops over
  // months — resolves each month against its own version rather than hoisting
  // one system out of the loop.
  const system = await systemForTeamMonth(ctx, team, month)

  const totals = []
  for (const memberId of team.playerIds) {
    const member = await ctx.db.get(memberId)
    // See lib/player.ts's hasCompleteProfile: a profile-incomplete invitee is
    // not shown on the table and must not be able to win the month either.
    if (!member || !hasCompleteProfile(member)) continue

    const scores = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', memberId).gte('puzzleDay', start).lte('puzzleDay', end),
      )
      .collect()

    totals.push({
      playerId: memberId,
      total: monthTotal({
        month,
        scores,
        // The version that governed THIS month, not the team's current values.
        // Without this a scoring edit would rewrite every past month's winner,
        // which is the bug wordle-teams-1j3 exists to prevent.
        system,
        playWeekends: team.playWeekends,
        today,
      }),
    })
  }

  const winnerId = winnerOf(totals) as Id<'players'> | null
  const existing = await ctx.db
    .query('monthlyWinners')
    .withIndex('by_team_year_month', (q) =>
      q.eq('teamId', team._id).eq('year', year).eq('month', monthNum),
    )
    .first()

  if (!winnerId) {
    // Matches the SQL, which deletes unconditionally and re-inserts only where
    // winner_id is not null.
    if (existing) await ctx.db.delete(existing._id)
    return
  }
  if (!existing) {
    await ctx.db.insert('monthlyWinners', {
      playerId: winnerId,
      teamId: team._id,
      year,
      month: monthNum,
      hasSeenCelebration: [],
    })
    return
  }
  // Unchanged winner: leave the row, and the seen-list, alone.
  if (existing.playerId === winnerId) return
  await ctx.db.patch(existing._id, { playerId: winnerId, hasSeenCelebration: [] })
}

/** Recompute several months for one team. */
export async function recomputeTeamMonths(
  ctx: WriterCtx,
  team: Doc<'teams'>,
  months: Array<PuzzleMonth>,
  today: PuzzleDay,
): Promise<void> {
  for (const month of months) {
    await recomputeTeamMonth(ctx, team, month, today)
  }
}

/**
 * Every month this team already has a winner row for, as 'YYYY-MM'.
 *
 * This is what bounds the blast radius of a membership or scoring change: a
 * team accumulates at most one row per month, so recomputing "every affected
 * month" is bounded at (months played) x (members) x (days in month) — roughly
 * thirty rows for the oldest team in production.
 */
export async function monthsWithWinners(
  ctx: WriterCtx,
  teamId: Id<'teams'>,
): Promise<Array<PuzzleMonth>> {
  const rows = await ctx.db
    .query('monthlyWinners')
    .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId))
    .collect()
  return rows.map((row) => `${row.year}-${String(row.month).padStart(2, '0')}`)
}

/**
 * Recompute the month for every team the player belongs to.
 *
 * What upsertBoard calls, and the behaviour that existed before the extraction.
 *
 * Same "Convex can't index array membership" constraint as teams.ts's
 * getMyTeams, but paid on the WRITE path instead of an amortised read: this
 * runs on every board submission, the single most frequent write in the app.
 * Cost is roughly O(all teams) — this collect — plus O(teams the player is on
 * x members x days in the month) for the loop inside recomputeTeamMonth. See
 * the write-path bandwidth guard in scores.test.ts for a measured figure on a
 * realistic fixture.
 *
 * Because the WHOLE teams table lands in this transaction's read set, a
 * concurrent write to ANY team forces Convex to retry the mutation via OCC even
 * though the retry's outcome never depended on that other team. Phase 3 raises
 * team-write frequency (settings edits, creation, deletion, scoring edits),
 * which is the condition teams.ts flagged as the trigger to revisit this.
 * Acceptable at 171 teams and ~40 DAU; revisit if either number moves.
 */
export async function recomputePlayerMonth(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  month: PuzzleMonth,
  today: PuzzleDay,
): Promise<void> {
  const allTeams = await ctx.db.query('teams').collect()
  for (const team of allTeams) {
    if (!team.playerIds.includes(playerId)) continue
    await recomputeTeamMonth(ctx, team, month, today)
  }
}
