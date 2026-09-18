import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, isProFor, requirePlayer, requireTeamMemberFor } from './access'
import { rollupTeamMonth, storeTeamMonthStats, type MonthScore } from './teamStats.ts'
import { isMonth, serverFloorFor } from './lib/monthWindow.ts'
import { monthOf, monthRange, toPuzzleDay } from './lib/puzzleDay.ts'
import { monthTotal, winnerOf } from './lib/scoring.ts'
import { systemFor } from './lib/scoringSystem.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { PuzzleDay, PuzzleMonth } from './lib/puzzleDay.ts'
import type { GenericDatabaseReader, GenericDatabaseWriter, Scheduler } from 'convex/server'

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
 * A writer that can also SCHEDULE — the ctx a function needs when its work does
 * not fit in one transaction and must continue in another.
 *
 * ADDED FOR THE TEAM-DELETION CASCADE (wordle-teams-qix.10), which pages a
 * team's chat history across scheduled calls rather than collecting all of it
 * at once. It is a strict widening of WriterCtx and satisfied with no cast by
 * every real mutation ctx AND by convex-test's `t.run` callback, which builds a
 * full mutation ctx — the same property WriterCtx's own comment relies on.
 *
 * NARROWER THAN MutationCtx ON PURPOSE, for the reason WriterCtx and ReaderCtx
 * exist at all: a signature that asked for the whole ctx would be claiming
 * access to storage, auth and `runQuery` that these functions do not use, and
 * would stop convex-test's callback from satisfying it structurally.
 */
export type SchedulingCtx = WriterCtx & { scheduler: Scheduler }

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
 * DELIBERATELY NOT VALIDATING, WHICH PERMITS TWO THINGS AND NOT ONE.
 *
 * - NOT A MONTH AT ALL yields NaN here, and a NaN index lookup simply matches
 *   nothing — the query returns null and the mutation writes nothing, which is
 *   the same answer a real month with no winner gets.
 * - A LONGER DATE STRING ALIASES TO ITS MONTH. `split('-')` is destructured at
 *   two elements, so '2026-08-15' is read as 2026-08 and answers for the whole
 *   month rather than being rejected. Harmless here: the only thing reachable
 *   through it is a month of the caller's OWN team — `requireTeamMemberFor`
 *   has already run at every call site — so the widest thing a malformed
 *   argument can buy is an answer the caller could have asked for correctly.
 *
 * NEITHER CASE IS STILL REACHABLE THROUGH `lastMonthWinnerFor`, whose month gate
 * rejects anything that is not 'YYYY-MM' before this function sees it. This
 * paragraph now describes `markCelebrationSeen` — deliberately ungated, see its
 * own comment — and the internal recompute callers, which are handed months this
 * module derived itself. It is kept rather than narrowed because the tolerance is
 * a property of THIS function and the next caller inherits it.
 *
 * AN EARLIER VERSION OF THIS COMMENT ENDED "scores.ts's getTeamMonth takes
 * `v.string()` on the same reasoning", AND THAT HAS BEEN FALSE SINCE
 * wordle-teams-kusd's task 3: getTeamMonthFor rejects a non-'YYYY-MM' month
 * outright, because a bare year sorts above a Pro caller's floor and would return
 * a year of every teammate's boards. Do not read tolerance here as a statement
 * about any gated caller.
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
  // Accumulated for Layer 3's aggregate, which is stored from THESE rows rather
  // than reading them again — see storeTeamMonthStats below the loop.
  const monthScores: MonthScore[] = []
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

    for (const score of scores) monthScores.push(score)

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

  /*
    LAYER 3'S AGGREGATE RIDES THIS PATH RATHER THAN GETTING ITS OWN TRIGGER, and
    that is the decision wordle-teams-s7q2 asked to be stated. This function
    already runs on exactly the event the aggregate cares about — a board changed
    in this (team, month) — and it already runs for a BACKFILLED month rather than
    only the current one. Backfill is a free feature, so a rollup that only ever
    touched the current month would leave an edited past month's analytics
    permanently and silently wrong. Inventing a second notion of "a board changed"
    would be a second thing to keep in step with this one.

    FROM THE ROWS ALREADY READ ABOVE, never re-read. scores.test.ts's write-path
    bandwidth guard is what enforces that, and it failed the moment an earlier
    version called the reading variant here.

    BEFORE THE EARLY RETURN BELOW: a month with no winner is still a month with
    statistics, and returning first would leave it permanently stale.
  */
  await storeTeamMonthStats(ctx, team, month, monthScores)

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
 * Every month this player has a board in, as 'YYYY-MM', without duplicates.
 *
 * THE COMPANION BOUND TO monthsWithWinners ABOVE, AND DELIBERATELY A DIFFERENT
 * QUESTION. That one asks what the TEAM has already computed; this asks what the
 * PLAYER brings with them. A joiner's history is precisely the set of months a
 * team's stored aggregates can be wrong about the moment they arrive, because
 * `dailyScores` carries no teamId — a board belongs to the player globally, and
 * aggregateTeamMonth builds a team's days from the boards of everyone currently
 * in `team.playerIds`. So the new member's existing boards ARE part of the
 * correct answer for that team from the instant the roster patch lands; only the
 * stored document lags.
 *
 * ONE INDEXED SCAN OF ONE PLAYER'S BOARDS, unbounded in time on purpose — an
 * arriving v1 player carries their whole history and any month of it can be the
 * stale one. Bounded by that player's own play, not by the table: roughly 700
 * rows for the most prolific account in production. Read ONCE by the caller and
 * passed to recomputeForJoiner, rather than re-read per team, because a signup
 * can claim several invites at once (players.ts's completeProfileFor).
 */
export async function monthsWithBoards(
  ctx: WriterCtx,
  playerId: Id<'players'>,
): Promise<Array<PuzzleMonth>> {
  const rows = await ctx.db
    .query('dailyScores')
    .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', playerId))
    .collect()
  return [...new Set(rows.map((row) => monthOf(row.puzzleDay)))]
}

/**
 * Bring one team's stored months back in step after somebody JOINED it.
 *
 * Every add path owes this, and until wordle-teams-c5ry the link path paid
 * nothing at all: `consumeLinkFor` ended at the roster patch and recomputed
 * nothing, so a player who had already entered today's board and then joined by
 * link was missing from that team's `teamMonthStats` until the next board write
 * by ANY member, or the 00:45 UTC teamStats.sweep. /insights resolved to the new
 * team, `dailyTeamFact` answered 'no-board', and the card — and therefore the
 * team picker living in its header — did not render at all. A window rather than
 * a permanent state, but one that can last most of a day and that lands on a
 * brand-new member's FIRST visit.
 *
 * TWO BOUNDS, NOT ONE, AND THE ASYMMETRY IS THE WHOLE DESIGN:
 *
 *   WINNERS are recomputed only for months the team ALREADY has a row for
 *   (`monthsWithWinners`). That is the bound the email path has always carried
 *   and it is a PRODUCT decision, not a cost one — see completeProfileFor's
 *   note: a joiner who played a month on some other team does not retroactively
 *   win it on this one. Widening it would hand a brand-new member last
 *   September's trophy. Phase 3's removeMember and setScoringSystem draw the
 *   same line.
 *
 *   STATISTICS are recomputed for every month the joiner has boards in, because
 *   there the stored document is simply WRONG — not a title that was never
 *   contested, but a total that no longer matches what aggregateTeamMonth would
 *   answer for the current roster. insights.ts's teamMonth reads that document
 *   and nothing else, and treats a missing row as an empty month, so a month the
 *   team never had a winner row for reads as "nobody played" to the joiner who
 *   in fact played all of it.
 *
 * recomputeTeamMonth does BOTH halves, so the months in the winner set are
 * already finished and are skipped by the second loop rather than rolled up
 * twice. rollupTeamMonth is the reading variant — the caller has no scores in
 * hand here, unlike the board-write path.
 *
 * `team` MUST BE THE POST-PATCH DOCUMENT. Both loops read `team.playerIds` off
 * the doc they are handed, and the pre-patch snapshot does not contain the
 * joiner — which would recompute every month to exactly the value it already
 * had. players.ts re-reads for this reason and says so.
 */
export async function recomputeForJoiner(
  ctx: WriterCtx,
  team: Doc<'teams'>,
  joinerMonths: ReadonlyArray<PuzzleMonth>,
  today: PuzzleDay,
): Promise<void> {
  const winnerMonths = await monthsWithWinners(ctx, team._id)
  await recomputeTeamMonths(ctx, team, winnerMonths, today)

  for (const month of joinerMonths) {
    if (winnerMonths.includes(month)) continue
    await rollupTeamMonth(ctx, team, month)
  }
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
 *
 * MONTH-GATED SINCE wordle-teams-kusd's task 4, and the gate is the block below
 * rather than anything in this paragraph — read it there. What belongs here is
 * that this function used to check membership and NOTHING else, which made it
 * the one remaining public, team-scoped, caller-supplied-month read with no
 * month rule of any kind while its two siblings both had one (getTeamMonthFor's
 * window gate, insights.ts's teamMonth's layer gate). wordle-teams-7uv8 is the
 * issue that named it.
 */
export async function lastMonthWinnerFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  month: PuzzleMonth,
) {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)

  // THE MONTH GATE, AND IT IS DELIBERATELY NOT A COPY OF getTeamMonthFor'S.
  //
  // WHAT IT WITHHOLDS, STATED PLAINLY, BECAUSE "a name is not a scoreboard" IS
  // THE ARGUMENT FOR LEAVING IT OPEN AND IT IS NOT GOOD ENOUGH. A caller is
  // already a member, so the winner's NAME is one they can read off the roster;
  // what this returns that they cannot otherwise get is the MAPPING from a month
  // to that name. Walk the months and you have the team's whole hall of fame —
  // every month it has ever played, one cheap call each. "Reaching back through
  // your team's history" is precisely what Pro sells (see monthWindow.ts's
  // header on parity with v1), so that mapping is the product, not a detail of
  // it.
  //
  // GATING COSTS NO UI ANYTHING, WHICH IS WHY THE DECISION WAS EASY HERE AND IS
  // NOT THE SAME DECISION insights.ts REACHES. The only caller is
  // monthly-winner-celebration.tsx, which asks for the VIEWER'S OWN LOCAL
  // PREVIOUS MONTH and nothing else. The free floor sits three months below the
  // server's month: FREE_MONTHS of 3 makes the oldest OFFERED month S-2, and
  // SERVER_SLACK_MONTHS puts the floor one below that at S-3. Offsets span
  // UTC−12..UTC+14, so a viewer's local month differs from the server's by at
  // most one; a viewer a month BEHIND asks for S-2, which is the worst case and
  // still a full month above the floor. No browser can trip this. Contrast
  // insights.ts's teamMonth, whose free surface really is offered
  // for twelve months by teamMonthOptions and therefore cannot be narrowed
  // without taking something away.
  //
  // THE SHAPE CHECK IS FIRST, for getTeamMonthFor's reason and for one of this
  // file's own. There, a malformed month sorts above a Pro floor and pulls a year
  // of boards. Here it is milder but real: `yearAndMonth` above is
  // `split('-').map(Number)`, so a bare '2026' yields monthNum NaN and the index
  // lookup simply misses. Harmless today — and exactly the kind of harmless that
  // stops being harmless when someone later makes this branch on the month. The
  // check is `isMonth` from lib/monthWindow.ts, not a private regex, for the
  // reason that function's own comment gives: the shape rule and the window rule
  // it guards must not be able to drift apart.
  //
  // NO PRO FLOOR, AND THAT ASYMMETRY WITH getTeamMonthFor IS THE ONE DELIBERATE
  // DIFFERENCE. There, a Pro caller below `earliestMonthFor`'s floor is refused,
  // because serving them means walking the roster and materialising every
  // member's month — MAX_MONTHS exists in monthWindow.ts precisely to bound that
  // work against an unvalidated `puzzleDay`. Here, serving an ancient month is
  // ONE point lookup on `by_team_year_month` that misses and returns null, while
  // REFUSING it would first have to walk the roster to find the earliest board —
  // strictly more work, to withhold a row that does not exist. A Pro caller is
  // entitled to every month their team has actually played, and a month it has
  // not played has no winner row to leak. So the pro branch here is `isProFor`
  // and nothing more.
  //
  // THE SERVER CLOCK IS READ HERE, AND THAT DOES NOT CONTRADICT "WHY THE MONTH
  // IS AN ARGUMENT" ABOVE. That paragraph is about which month the celebration
  // is ABOUT — a question about the viewer's calendar, which is why the client
  // names it. This reads the server's month only to decide how far back anyone
  // may reach, which is a question about the SUBSCRIPTION and has no viewer in
  // it. The one place the two meet is the month of slack `serverFloorFor`
  // carries, which exists for exactly the UTC-versus-viewer disagreement that
  // paragraph describes. Taking `today` as an argument instead would mean
  // bounding it — and a bound whose only failure direction is more permissive is
  // not worth a signature change on a query the dashboard mounts on every load.
  // getTeamMonthFor's own gate makes the same call and says so at greater length.
  //
  // MEMBERSHIP STILL RUNS FIRST. requireTeamMemberFor throws NOT_A_MEMBER for a
  // team that does not exist as well as for one that is not yours (the property
  // insights.ts's teamMonth also depends on), so a probe cannot use the error
  // code to learn which team ids are real. Putting the month check ahead of it
  // would hand an outsider MONTH_OUT_OF_WINDOW — which only a member can
  // meaningfully receive — and turn the code into an oracle.
  if (!isMonth(month)) throw accessError('MONTH_OUT_OF_WINDOW')
  const serverMonth = monthOf(toPuzzleDay(new Date()))
  if (month < serverFloorFor({ currentMonth: serverMonth, earliestMonth: null, pro: false })) {
    if (!(await isProFor(ctx, playerId))) throw accessError('MONTH_OUT_OF_WINDOW')
  }

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
 *
 * DELIBERATELY NOT MONTH-GATED, THOUGH IT TAKES THE SAME `month: v.string()`
 * ITS READING SIBLING DOES. wordle-teams-kusd's task 4 audited every such path
 * and this is the one that ends with a reason rather than a gate, so the reason
 * is written out rather than left to be re-derived:
 *
 * - IT DISCLOSES NOTHING, not even by the shape of its answer. It returns void,
 *   and BOTH early returns above are silent successes — so a caller cannot learn
 *   from it whether a winner row for that month exists, which is the one bit
 *   `lastMonthWinnerFor`'s gate is there to withhold. A gate here would protect
 *   a secret that is not in the response.
 * - IT WRITES ONLY THE CALLER'S OWN ID, into a field nothing reads except that
 *   same caller's dialog, and the write is idempotent. The worst an arbitrary
 *   month buys is suppressing a celebration for yourself.
 * - THE ACCESS CHECK THAT MATTERS IS ALREADY HERE. requireTeamMemberFor runs
 *   before the patch — pinned by "refuses a caller who is not on the team, and
 *   writes nothing" in winners.test.ts — so an outsider's id can never reach
 *   another team's row, which is the real risk on a write.
 * - A MALFORMED MONTH IS INERT for the same reason it is inert in
 *   `lastMonthWinnerFor` before that function's shape check: `yearAndMonth` maps
 *   a bare '2026' to a NaN monthNum, the index lookup misses, and this returns
 *   through the no-row branch. No shape check is added for it here, because
 *   adding one would imply this function branches on the month when it does not.
 *
 * IF ANY OF THOSE FOUR STOP HOLDING — if this ever returns a value, writes
 * anything but the caller's own id, or grows a second caller — the gate in
 * `lastMonthWinnerFor` comes with it.
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
