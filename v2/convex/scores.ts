import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, currentPlayer, requirePlausibleToday, requirePlayer, requireTeamMemberFor } from './access'
import { boardIsValid, normalizeGuesses } from './lib/board.ts'
import { LAUNCH_AT, shouldStartTrial, trialEndsAtFor } from './lib/insightsAccess.ts'
import { monthOf, monthRange, type PuzzleMonth } from './lib/puzzleDay.ts'
import { effectiveFromOf, systemFor } from './lib/scoringSystem.ts'
import { recomputePlayerMonth } from './winners.ts'
import type { Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server'

/**
 * Anything with a `db` reader — a query, mutation, or a convex-test `ctx.run`.
 *
 * Mirrors access.ts's ReaderCtx exactly, for the same reason: getTeamMonthFor
 * only ever touches `ctx.db`, and keeping the parameter type to just that lets
 * convex-test's `t.run` callback ctx satisfy it with no cast.
 */
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

/**
 * The core loop: reading a team's month, and writing a board plus the winner
 * recomputation it triggers.
 *
 * SCOPED TO ONE TEAM AND ONE MONTH, deliberately. v1 loaded every team, every
 * player and every score ever into a client context and computed from there.
 * Convex re-pushes a query's whole result to every subscriber on every write,
 * and wordle-teams-dcu flags database BANDWIDTH — not function calls — as the
 * binding free-tier limit, so porting that shape would have made a board entry
 * re-broadcast all of history.
 *
 * Each exported Convex function delegates to a plain `...For` helper that takes
 * an explicit playerId. That is what convex-test exercises, so the access
 * behaviour can be proven without a Better Auth session in the harness.
 */

export async function getTeamMonthFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  month: string,
) {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  const { start, end } = monthRange(month)

  // The system that governed the month being VIEWED. The team doc's own eight
  // fields are the original, used until the first edit; every edit since writes
  // a scoringSystems row. Reading the team's live values here would compute a
  // past month's totals under today's rules — wordle-teams-1j3.
  //
  // Queried here rather than through winners.ts's loadTeamMonthSystem, which
  // does the same read: this needs the raw `versions` array a second time, for
  // effectiveFromOf below. The duplication is deliberate, not an oversight.
  const versions = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', teamId))
    .collect()
  const system = systemFor(team, versions, month)

  // Convex functions run inside a single snapshot-isolated transaction, so
  // concurrent reads across members don't compete or change correctness —
  // each `await` below in a sequential loop would just be a serialized round
  // trip for no isolation benefit. Promise.all preserves the input order of
  // team.playerIds in the resolved array regardless of which read finishes
  // first, so member ordering is unaffected.
  const resolved = await Promise.all(
    team.playerIds.map(async (memberId) => {
      const member = await ctx.db.get(memberId)
      // A ROSTER ENTRY WITH NO PLAYER ROW. Convex ids are not foreign keys and
      // the schema enforces no referential integrity, so nothing at the database
      // level guarantees that every id in `team.playerIds` still resolves.
      // Without this the read would throw on `member.firstName` and take the
      // whole scoreboard down for everyone else on the team; omitting the one
      // unresolvable row is the degradation worth having.
      //
      // NOT THE SAME CHECK as the profile-completeness filter that used to sit
      // beside it. That one is gone, because players.firstName/lastName became
      // required in Phase 4, so a name can no longer be ABSENT. It can still be
      // EMPTY — v.string() accepts '' — so "unnamed" is kept out by the writers
      // (isCompleteName in lib/invite.ts, isNamed in scripts/lib/copy-filters.mjs),
      // not by the schema. A missing DOCUMENT is a third state again, and is still
      // representable via a scoped copy — do not read the deletion of the name
      // filter as evidence this null check is dead too.
      if (!member) return null

      const scores = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) =>
          q.eq('playerId', memberId).gte('puzzleDay', start).lte('puzzleDay', end),
        )
        .collect()

      return {
        id: member._id,
        firstName: member.firstName,
        lastName: member.lastName,
        scores: scores.map((score) => ({
          id: score._id,
          puzzleDay: score.puzzleDay,
          answer: score.answer ?? '',
          guesses: score.guesses,
        })),
      }
    }),
  )
  const players = resolved.filter((member): member is NonNullable<typeof member> => member !== null)

  return {
    team: {
      id: team._id,
      name: team.name,
      playWeekends: team.playWeekends,
      showLetters: team.showLetters,
      // Resolved above, not read off the team doc. `systemFor` returns either a
      // stored version row or the team doc itself as the fallback, so pick the
      // eight fields explicitly — that is what keeps the invite list (and a
      // version row's _id) off the wire.
      system: {
        oneGuess: system.oneGuess,
        twoGuesses: system.twoGuesses,
        threeGuesses: system.threeGuesses,
        fourGuesses: system.fourGuesses,
        fiveGuesses: system.fiveGuesses,
        sixGuesses: system.sixGuesses,
        failed: system.failed,
        nA: system.nA,
      },
      // null when the month resolved to the team's original values — that is
      // what tells the Scoring System card there is no "historical" badge.
      systemEffectiveFrom: effectiveFromOf(versions, month),
    },
    players,
  }
}

export const getTeamMonth = query({
  args: { teamId: v.id('teams'), month: v.string() },
  handler: async (ctx, { teamId, month }) => {
    const player = await requirePlayer(ctx)
    return await getTeamMonthFor(ctx, player._id, teamId, month)
  },
})

/**
 * The earliest month anyone on this roster has a board in, or null for none.
 *
 * ONE `ctx.db.get` PLUS, FOR A MEMBER WHO STILL EXISTS, ONE INDEXED `.first()`,
 * ascending — `by_player_and_puzzleDay` is already the index getTeamMonthFor
 * walks for the month's scores, and an index range's first row IS its smallest
 * (Convex index queries default to ascending; insights.ts:91 writes
 * `.order('desc')` explicitly when it wants the other end). No scan, no sort, no
 * collect — a `.collect().then((rows) => rows[0] ?? null)` would read every board
 * that member has ever entered and still return the same first row, which is
 * exactly the regression the documentsRead guard on this function's test exists
 * to catch (scores.test.ts).
 *
 * ACROSS THE CURRENT ROSTER, WHICH IS THE ONLY MEANING AVAILABLE: dailyScores has
 * no teamId (see schema.ts), so a board belongs to a player rather than to a
 * team. That is not a workaround — it is exactly how getTeamMonthFor resolves the
 * scoreboard above, so the window and the data it gates can never disagree. A
 * member joining brings their earlier boards and widens the window; a member
 * leaving takes theirs and narrows it. Both are correct, and both are already
 * visible on the scoreboard the same way.
 *
 * A DANGLING ROSTER ID IS SKIPPED, on the same premise getTeamMonthFor
 * (scores.ts:84) and getMyTeamsFor (teams.ts:105) share — Convex ids are not
 * foreign keys, so `teams.playerIds` can outlive the `players` row it names —
 * but for a DIFFERENT REASON. Those two guard against throwing on
 * `member.firstName`; nothing here would throw on a ghost, which is exactly why
 * the pre-fix version of this function had no guard at all. This guard exists so
 * a ghost's boards cannot widen the window past what getTeamMonthFor can ever
 * render for this team — it drops the same id before reading a single score for
 * it, so counting the ghost's boards here would offer a paying member a month
 * the scoreboard renders as empty.
 *
 * A LEAVING MEMBER CAN THEREFORE SHRINK THE WINDOW UNDER A VIEWER SITTING ON AN
 * OLD MONTH. NOTHING CORRECTS FOR THAT YET: routes/app.tsx will move `?month=`
 * back into the window whenever it falls outside, but that is wordle-teams-kusd's
 * task 6 and it has not landed. Until it does, a viewer whose window shrinks under
 * them keeps a `?month=` the window no longer contains — harmless while task 3's
 * server gate is also unbuilt, and the reason task 6 must not be skipped. It is
 * the same correction a team change will get, for the same reason: the viewer did
 * nothing wrong.
 *
 * DO NOT "OPTIMISE" THIS ONTO teamMonthStats. That table is computed, its coverage
 * of old months is not guaranteed, and reading it here would recreate exactly the
 * aggregate-versus-roster disagreement wordle-teams-iht.4 exists to close.
 */
async function earliestMonthFor(
  ctx: ReaderCtx,
  playerIds: readonly Id<'players'>[],
): Promise<PuzzleMonth | null> {
  // Promise.all rather than a sequential loop for the reason getTeamMonthFor
  // gives above: one snapshot-isolated transaction, so this is round trips rather
  // than correctness. Order does not matter here — the result is a minimum.
  const firsts = await Promise.all(
    playerIds.map(async (memberId) => {
      // A ROSTER ENTRY WITH NO PLAYER ROW, skipped BEFORE the index read rather
      // than after — the same guard scores.ts:84 (getTeamMonthFor) and teams.ts:105
      // (getMyTeamsFor) apply, for a related but distinct reason: those two guard
      // against throwing on `member.firstName`, while this one exists so a ghost's
      // boards cannot widen the window past what getTeamMonthFor can ever render
      // for this team — it drops the same id before reading a single score for it.
      // Checking first also makes a ghost CHEAPER than a real member: one
      // `ctx.db.get` instead of one `ctx.db.get` plus an index read.
      const member = await ctx.db.get(memberId)
      if (!member) return null
      return ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', memberId))
        .first()
    }),
  )

  let earliest: string | null = null
  for (const row of firsts) {
    // PuzzleDay is 'YYYY-MM-DD' BY CONVENTION ONLY — upsertBoard accepts it as an
    // unvalidated `v.string()` (wordle-teams-qvqi) — so lexical comparison is
    // chronological for every well-formed row, but a single malformed one (say,
    // an empty string) sorts below every real day and would silently become the
    // minimum, dropping a paying member into the free window. Nothing here
    // crashes on that: lib/monthWindow.ts's `isMonth` catches a malformed
    // `earliestMonth` downstream and treats it as if the team had none.
    if (row !== null && (earliest === null || row.puzzleDay < earliest)) earliest = row.puzzleDay
  }
  return earliest === null ? null : monthOf(earliest)
}

/**
 * How far back this team goes — the one input the month dropdown cannot compute
 * for itself.
 *
 * IT DOES NOT RETURN `pro`, AND THAT IS DELIBERATE. routes/app.tsx already holds
 * the viewer's membership from `api.teams.amIPro` (app.tsx:203). Returning it here
 * too would give the client two independently-updating subscriptions to one fact —
 * structurally the aggregate-versus-live split-brain wordle-teams-iht.4 is about.
 * The SERVER still needs it, and WILL read it straight from isProFor at the one
 * place that enforces — wordle-teams-kusd's task 3, still open as of this
 * comment. Nothing enforces the window yet.
 *
 * A SEPARATE QUERY RATHER THAN A FIELD ON getTeamMonth'S PAYLOAD. MonthPicker
 * renders in the controls row of routes/app.tsx, OUTSIDE the <Suspense> boundary
 * getTeamMonth sits behind; hanging the dropdown's contents on that payload would
 * make it wait for a month of scores to load before it could say which months
 * exist.
 *
 * IT RETURNS THE RULE'S INPUT, NOT THE RULE'S ANSWER, because the answer needs the
 * VIEWER'S current month and the server does not have it — Convex runs UTC.
 * lib/monthWindow.ts turns this into a window on whichever side is asking. Sending
 * a server-computed list instead would be wrong for a few hours at every month
 * boundary, in whichever direction the viewer's zone leans.
 */
export async function monthWindowInputsFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<{ earliestMonth: PuzzleMonth | null }> {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  return { earliestMonth: await earliestMonthFor(ctx, team.playerIds) }
}

export const monthWindow = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await monthWindowInputsFor(ctx, player._id, teamId)
  },
})

/**
 * The caller's own player id.
 *
 * Board entry needs to know which row of getTeamMonth is "you" so it can load
 * the day you already submitted. Matching on name would be the obvious shortcut
 * and is wrong — two players on a team can share a name, and v1's own table code
 * has a whole disambiguation branch proving it happens.
 */
export const getMyPlayerId = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    return player?._id ?? null
  },
})

/**
 * The caller's own scores for one month, with no team in the question.
 *
 * WHY THIS EXISTS. Boards are PLAYER-owned: upsertBoard takes no teamId and
 * dailyScores has no team column, so a player with no team can already WRITE
 * one. Only the read was blocked — the entry form prefilled from getTeamMonth,
 * which needs a team a brand-new signup does not have. wordle-teams-456 traced
 * a signup whose whole life was 39 seconds on a team-less screen with nothing
 * to do; this is what gives them something to do.
 *
 * A MONTH, NOT A DAY. The form picks a default day from the set of days already
 * played (form.tsx:64), so a single-day read cannot feed it.
 *
 * THE SAME SCORE SHAPE getTeamMonthFor emits (scores.ts:96-101), deliberately,
 * so the form derives from one shape whichever query fed it. It reads the same
 * index through the same monthRange bounds for the same reason: given a
 * WELL-FORMED 'YYYY-MM', `end` is '<month>-31' as a LEXICAL bound on
 * 'YYYY-MM-DD', so it includes a 30-day month's last day and cannot reach into
 * the next month.
 *
 * THAT GUARANTEE IS CONDITIONAL ON THE ARGUMENT'S SHAPE, and `v.string()` does
 * not enforce it: `{ month: '2026' }` bounds '2026-01'..'2026-31', which
 * lexically brackets every day of the year. The route is what enforces the
 * shape — app.tsx's validateSearch requires /^\d{4}-\d{2}$/ before a month can
 * reach here — and getTeamMonthFor has exactly the same property, so this is a
 * shared pre-existing contract rather than something to patch in one caller.
 *
 * NULL-SAFE FOR A MISSING PLAYER, like onboarding.getStatus: this renders on
 * /app, which is reachable in the window before a player row exists.
 */
export const getMyMonth = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const player = await currentPlayer(ctx)
    if (!player) return []
    const { start, end } = monthRange(month)
    const scores = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', player._id).gte('puzzleDay', start).lte('puzzleDay', end),
      )
      .collect()
    return scores.map((score) => ({
      id: score._id,
      puzzleDay: score.puzzleDay,
      answer: score.answer ?? '',
      guesses: score.guesses,
    }))
  },
})

/**
 * Anything with a `db` writer — a mutation, or a convex-test `ctx.run` callback
 * passed to a write. Mirrors ReaderCtx above for the same reason: upsertBoardFor
 * only ever touches `ctx.db`, and keeping the parameter type to just that lets
 * convex-test's `t.run` callback ctx (a real GenericMutationCtx, which
 * structurally has a `db: GenericDatabaseWriter`) satisfy it with no cast.
 */
type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

export type BoardInput = {
  puzzleDay: string
  answer: string
  guesses: Array<string>
  today: string
}

/**
 * Create, update or delete one board, then recompute the standings it affects.
 *
 * KEYED ON (playerId, puzzleDay), which is what makes a duplicate row
 * impossible. v1 keyed on a client-held score id and inserted whenever the
 * client did not have one, so a double submit created a second row for the same
 * day — it has already done so 5 times in production (wordle-teams-rac). The 5
 * copied pairs are left exactly as they are; readers take the first, as v1 does.
 *
 * The winner recomputation runs in this same transaction, which is the whole
 * point: v1 saved the board and then made a separate RPC that could fail, so the
 * board landed while the standings went stale and the user was told "success".
 * Here both land or neither does.
 *
 * Duplicate prevention also holds under concurrency — two simultaneous calls
 * for the same (player, day) land in the same index range, so OCC invalidates
 * the loser's read set and Convex retries it, at which point it finds the row
 * and updates. THE TESTS DO NOT PROVE THIS; they exercise the sequential path
 * only, inside a single transaction. convex-test does not simulate OCC retries.
 */
/**
 * Starts this player's insights trial if this board is the one that should.
 *
 * SEPARATE AND EXPORTED SO BOTH DIRECTIONS ARE TESTABLE AGAINST REAL DOCUMENTS.
 * `launchAt` defaults to the real constant, and upsertBoardFor always takes the
 * default — but that default is currently a 2099 placeholder, so inline code
 * could only ever be tested in its negative direction. A test passing an explicit
 * launchAt exercises the actual db read and patch in both, which is what
 * wordle-teams-vhwh asks for and what a pure-function test alone cannot give:
 * that the field is really written, once, to the right value.
 *
 * shouldStartTrial owns the write-once and after-launch rules; the ONE rule that
 * lives here is that a DELETE is not an entry. It is here rather than at the call
 * site so that it is inside the seam a test can reach — outside it, the only
 * thing that could exercise it is a real launch date.
 */
export async function stampTrialIfDue(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  // ONE `enteredAt` for both the test and the stamp. Two Date.now() calls can
  // straddle a millisecond, which would end the trial a tick early — harmless,
  // and still drift with no reason to exist.
  enteredAt: number,
  action: 'create' | 'update' | 'delete',
  launchAt: number = LAUNCH_AT,
): Promise<void> {
  // Clearing a board is not entering one. Stamping here would start a month-long
  // trial for someone who just deleted their score.
  if (action === 'delete') return
  const player = await ctx.db.get(playerId)
  if (!shouldStartTrial({ trialEndsAt: player?.insightsTrialEndsAt, enteredAt, launchAt })) return
  await ctx.db.patch(playerId, { insightsTrialEndsAt: trialEndsAtFor(enteredAt) })
}

export async function upsertBoardFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  input: BoardInput,
): Promise<{ action: 'create' | 'update' | 'delete' }> {
  const { puzzleDay, answer, guesses, today } = input

  const existing = await ctx.db
    .query('dailyScores')
    .withIndex('by_player_and_puzzleDay', (q) =>
      q.eq('playerId', playerId).eq('puzzleDay', puzzleDay),
    )
    .first()

  // The server does not trust the client. Unreachable through the UI, which
  // disables submit on this same predicate — v1 had no server-side check at all.
  if (!boardIsValid(answer, guesses, existing !== null)) throw accessError('INVALID_BOARD')

  // The bound itself — requirePlausibleToday — is shared with updateTeamFor,
  // removeMemberFor, leaveTeamFor and invitePlayerFor in teams.ts and
  // setScoringSystemFor in scoringSystems.ts, which need it for the identical
  // reason: see the doc comment on isPlausibleToday in lib/puzzleDay.ts. Six
  // call sites including this one. completeProfileFor (players.ts) is clock-
  // bounded too but deliberately NOT one of them — it applies isPlausibleToday
  // itself and falls back to the server's date rather than throwing, because
  // refusing there would refuse the player row and lock the account out of the
  // product. access.ts's requirePlausibleToday carries the same list and the
  // same exception; keep the two in step.
  //
  // INVALID_DATE, NOT INVALID_BOARD: a clock this far off is not a board-shape
  // problem, and boardErrorMessage's "That board is not complete. Check the
  // answer and your guesses." would be actively wrong here — the board can be
  // perfectly valid and the device's clock is what's off.
  requirePlausibleToday(today)

  const played = normalizeGuesses(guesses)
  let action: 'create' | 'update' | 'delete'

  if (played.length === 0 && answer.length === 0) {
    // boardIsValid already guaranteed `existing` here.
    await ctx.db.delete(existing!._id)
    action = 'delete'
  } else if (existing) {
    await ctx.db.patch(existing._id, { answer, guesses: played })
    action = 'update'
  } else {
    await ctx.db.insert('dailyScores', {
      playerId,
      puzzleDay,
      // The audit instant. NOT for grouping — that is what puzzleDay is for.
      date: Date.now(),
      answer,
      guesses: played,
    })
    action = 'create'
  }

  // THE INSIGHTS TRIAL CLOCK, started by the first board entered after launch.
  //
  // HERE RATHER THAN AT SIGNUP, because the population that matters most already
  // signed up: a window anchored to launch expires while a dormant player is
  // still dormant, and dormant returners are who the launch email is for. One
  // comparison covers them and every future signup.
  //
  // NOT ON A DELETE. `action` can be 'delete', and stamping there would start a
  // month-long trial for someone who just cleared a board — the opposite of an
  // entry. Only a create or an update is a board being entered.
  //
  // shouldStartTrial owns both conditions, including the write-once rule; this
  // call site deliberately holds no part of the decision. While LAUNCH_AT is its
  // 2099 placeholder this never fires, which is the intended inert state.
  await stampTrialIfDue(ctx, playerId, Date.now(), action)

  await recomputePlayerMonth(ctx, playerId, monthOf(puzzleDay), today)
  return { action }
}

export const upsertBoard = mutation({
  args: {
    puzzleDay: v.string(),
    answer: v.string(),
    guesses: v.array(v.string()),
    // The submitter's own local today. The server has no viewer and no correct
    // timezone to guess; see the design's "today" decision.
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    return await upsertBoardFor(ctx, player._id, args)
  },
})
