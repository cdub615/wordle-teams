import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requirePlayer, requireTeamMemberFor } from './access'
import { monthRange } from './lib/puzzleDay.ts'
import { monthTotal, winnerOf } from './lib/scoring.ts'
import { systemFor } from './lib/scoringSystem.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { PuzzleDay, PuzzleMonth } from './lib/puzzleDay.ts'
import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server'

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
 * playWeekends flips (both teams.ts), and setScoringSystem (scoringSystems.ts,
 * split out of teams.ts in wt-ksh.4.32). Before the extraction the only way
 * to reach it was to construct a valid board submission and pass it through the
 * whole upsert machinery, which is also why its five behaviours had no direct
 * tests.
 */

/**
 * Anything with a `db` writer — a mutation, or a convex-test `ctx.run` callback.
 * Mirrors scores.ts's WriterCtx for the same reason: nothing here touches
 * anything but `ctx.db`, so convex-test's callback ctx satisfies it with no cast.
 *
 * Exported, unlike scores.ts's private copy: Phase 3 tasks 6, 7 and 8 added
 * mutations to convex/teams.ts (removeMember, updateTeam) and
 * convex/scoringSystems.ts (setScoringSystem, split out of teams.ts in
 * wt-ksh.4.32) that call into this module and need the type to declare their
 * own ctx parameters. The asymmetry with scores.ts is deliberate, not a drift
 * risk — scores.ts's WriterCtx has no cross-module caller and has no reason to
 * be exported.
 */
export type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

/**
 * Anything with a `db` reader. Mirrors access.ts's and scores.ts's own copies
 * for the identical reason: `lastMonthWinnerFor` below only touches `ctx.db`,
 * so convex-test's `t.run` callback ctx satisfies it with no cast.
 */
export type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

/**
 * 'YYYY-MM' split into the two NUMBERS the monthlyWinners row stores.
 *
 * The table keys on `year` and `month` as separate numeric columns — v1's
 * shape, kept — while every other month-shaped value in this codebase is the
 * 'YYYY-MM' string `PuzzleMonth` names. Every read and write of the
 * by_team_year_month index therefore has to cross that boundary, and it was
 * being crossed by an open-coded `split('-').map(Number)` in each place. Three
 * call sites is where two copies of the same conversion start to drift.
 *
 * DELIBERATELY NOT VALIDATING. A caller-supplied month that is not a month
 * yields NaN here, and a NaN index lookup simply matches nothing — the query
 * returns null and the mutation writes nothing, which is the same answer a
 * real month with no winner gets. scores.ts's getTeamMonth takes `v.string()`
 * on the same reasoning; adding a code for it would be inventing a failure the
 * UI has no way to reach.
 */
function yearAndMonth(month: PuzzleMonth): { year: number; monthNum: number } {
  const [year, monthNum] = month.split('-').map(Number)
  return { year, monthNum }
}

/** The team's winner row for one month, or null. */
async function winnerRow(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
  month: PuzzleMonth,
): Promise<Doc<'monthlyWinners'> | null> {
  const { year, monthNum } = yearAndMonth(month)
  return await ctx.db
    .query('monthlyWinners')
    .withIndex('by_team_year_month', (q) =>
      q.eq('teamId', teamId).eq('year', year).eq('month', monthNum),
    )
    .first()
}

/**
 * Load the scoring system that governed one month for one team.
 *
 * Reads every version row for the team — a team accumulates one per month it
 * was edited in, which is a handful — and resolves with the pure systemFor. The
 * team doc's own eight fields are the fallback, which is what makes existing
 * teams need no backfill.
 *
 * NAMED `load...`, NOT `systemForTeamMonth`. The `...For` suffix means one
 * specific thing everywhere else here — the plain helper behind an exported
 * Convex function, taking explicit ids (createTeamFor, getTeamMonthFor) — and
 * this is not that. Sitting next to the pure `systemFor` it also read as
 * differing by month-scope, when the real difference is that this one hits the
 * database.
 */
export async function loadTeamMonthSystem(
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
  const { year, monthNum } = yearAndMonth(month)
  const { start, end } = monthRange(month)
  // Resolved INSIDE this function, so recomputeTeamMonths — which loops over
  // months — resolves each month against its own version rather than hoisting
  // one system out of the loop.
  const system = await loadTeamMonthSystem(ctx, team, month)

  const totals = []
  for (const memberId of team.playerIds) {
    const member = await ctx.db.get(memberId)
    // A ROSTER ENTRY WITH NO PLAYER ROW MUST NOT BE A CANDIDATE. Convex ids are
    // not foreign keys and the schema enforces no referential integrity, so
    // nothing at the database level guarantees that every id in
    // `team.playerIds` still resolves. Unlike getTeamMonthFor and getMyTeamsFor,
    // nothing below actually dereferences `member` — the loop only ever uses
    // `memberId` — so dropping this guard would not throw. It would silently do
    // something worse: a ghost id owns no dailyScores, monthTotal therefore
    // scores it purely on the team's N/A value for elapsed days, and winnerOf
    // takes the first entry at the maximum with a strict `>`. A nonexistent
    // player would beat every real member who is behind on their boards, and
    // beat them from the front of `playerIds` on a tie.
    //
    // NOT THE SAME CHECK as the profile-completeness filter that used to sit
    // beside it. That one is gone, because players.firstName/lastName became
    // required in Phase 4, so a name can no longer be ABSENT. It can still be
    // EMPTY — v.string() accepts '' — so "unnamed" is kept out by the writers
    // (isCompleteName in lib/invite.ts, isNamed in scripts/lib/copy-filters.mjs),
    // not by the schema. A missing DOCUMENT is a third state again, and is still
    // representable via a scoped copy — do not read the deletion of the name
    // filter as evidence this null check is dead too.
    if (!member) continue

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
  const existing = await winnerRow(ctx, team._id, month)

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

/**
 * ------------------------------------------------------------------------
 * THE CELEBRATION DIALOG'S TWO PUBLIC FUNCTIONS (`wordle-teams-k7w`).
 *
 * Everything above this line is internal: helpers that take a `ctx` and are
 * called from mutations in scores.ts, teams.ts and scoringSystems.ts. Nothing
 * a browser could call read `monthlyWinners` at all, which is why divergence 3
 * in V2-ADDENDUM §7a — hasSeenCelebration surviving a winner rewrite — was a
 * careful rule about a field no code had ever read. These two are what read it.
 * ------------------------------------------------------------------------
 */

/**
 * One team's winner for one month, shaped for the celebration dialog.
 *
 * WHY THE MONTH IS AN ARGUMENT rather than derived from the server's clock:
 * "last month" is a question about the VIEWER's calendar, and Convex runs in
 * UTC. Resolving it here would fire the celebration on the wrong day for
 * everyone west of Greenwich for the first hours of the month, and stop firing
 * it a day early for everyone east — V2-ADDENDUM §7a rows 14-15's defect class,
 * which Task 10 spent a whole component avoiding. The client resolves the month
 * in its own zone and asks for it by name.
 *
 * IT RETURNS THE WINNER'S NAME, NOT JUST THE ID, and that is not convenience:
 * it is the fix for v1's misnamed-winner bug. See the component's doc comment
 * and §7a row 35. Nothing on the dashboard already holds other members' names
 * in a form this could look up — getTeamMonth's roster is a different query
 * with a different lifecycle — and resolving the name client-side is exactly
 * the join v1 got wrong.
 *
 * `hasSeen` IS A BOOLEAN, NOT THE ARRAY. The stored array is every teammate
 * who has dismissed the dialog; the caller only needs to know about itself, and
 * shipping the rest would put "who has read what" on the wire for no reason.
 *
 * Null in three cases, all of which the dialog treats the same — no row for
 * that month, and a row whose winner document no longer resolves (Convex ids
 * are not foreign keys; the same guard scores.ts's getTeamMonthFor and
 * recomputeTeamMonth above both carry). The third is the caller not being on
 * the team, which is a throw rather than a null — see requireTeamMemberFor.
 */
export async function lastMonthWinnerFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  month: PuzzleMonth,
) {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  const row = await winnerRow(ctx, teamId, month)
  if (!row) return null
  const winner = await ctx.db.get(row.playerId)
  if (!winner) return null

  return {
    teamName: team.name,
    winner: { id: winner._id, firstName: winner.firstName, lastName: winner.lastName },
    hasSeen: row.hasSeenCelebration.includes(playerId),
  }
}

export const getLastMonthWinner = query({
  args: { teamId: v.id('teams'), month: v.string() },
  handler: async (ctx, { teamId, month }) => {
    const player = await requirePlayer(ctx)
    return await lastMonthWinnerFor(ctx, player._id, teamId, month)
  },
})

/**
 * Record that this player has now seen the celebration for that month.
 *
 * THE APPEND HAPPENS HERE, INSIDE THE TRANSACTION. v1 does a read-modify-write
 * across the network — the browser SELECTs the array, pushes its own id onto
 * the copy it holds, and UPDATEs the whole column back — so two members
 * dismissing the dialog at the same time each write an array built from the
 * value they read before the other wrote, and the second write silently drops
 * the first. `wordle-teams-069` is the open issue for that exact pattern
 * elsewhere in this codebase. A Convex mutation is a serializable transaction,
 * so reading and appending in the same handler cannot interleave; the client
 * sends no array at all, which also means it cannot send one it made up.
 *
 * BOTH EARLY RETURNS ARE SILENT SUCCESSES, not swallowed errors:
 *
 * - NO ROW. A board entered for that month between the query resolving and
 *   this call can change the winner, which resets the row, or remove it. The
 *   dialog is already on screen and there is nothing to mark; refusing would
 *   turn a race into a toast.
 * - ALREADY PRESENT. The dialog can mount twice on a fast remount — a
 *   re-render that restarts the effect, a route transition back to /app — and
 *   an unconditional push would put the same id in twice. Nothing reads the
 *   array by length, so a duplicate would not misbehave; it would just grow
 *   without bound, one entry per remount, forever.
 */
export async function markCelebrationSeenFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  month: PuzzleMonth,
): Promise<void> {
  await requireTeamMemberFor(ctx, playerId, teamId)
  const row = await winnerRow(ctx, teamId, month)
  if (!row) return
  if (row.hasSeenCelebration.includes(playerId)) return
  await ctx.db.patch(row._id, { hasSeenCelebration: [...row.hasSeenCelebration, playerId] })
}

export const markCelebrationSeen = mutation({
  args: { teamId: v.id('teams'), month: v.string() },
  handler: async (ctx, { teamId, month }) => {
    const player = await requirePlayer(ctx)
    await markCelebrationSeenFor(ctx, player._id, teamId, month)
  },
})
