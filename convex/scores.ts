import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import {
  accessError,
  currentPlayer,
  isProFor,
  requirePlausiblePuzzleDay,
  requirePlausibleToday,
  requirePlayer,
  requireTeamMemberFor,
} from './access'
import { boardIsValid, normalizeGuesses } from './lib/board.ts'
import { LAUNCH_AT, shouldStartTrial, trialEndsAtFor } from './lib/insightsAccess.ts'
import { isMonth, serverFloorFor } from './lib/monthWindow.ts'
import { monthOf, monthRange, toPuzzleDay, type PuzzleMonth } from './lib/puzzleDay.ts'
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

  // THE MONTH GATE (wordle-teams-kusd). Membership was the ONLY check here
  // before, which made the three-month dropdown an affordance rather than a
  // paywall — v1's own position, and one Layer 3 stopped taking in
  // wordle-teams-iht.3.
  //
  // IT SITS HERE, BEFORE THE PER-MEMBER READS, AND MUST STAY HERE. A reviewer
  // will eventually notice that the pro branch below resolves `team.playerIds` a
  // second time, and propose folding the gate into the `Promise.all` further down
  // so the roster is walked once. Do not. That reorders an ACCESS DECISION behind
  // the work it authorises: an unauthorised request would pay for every member's
  // player document and every member's month of scores before being refused, so
  // the cheapest way to make the server do the most work would be to ask for a
  // month you are not allowed to see. The duplicate walk is the price of refusing
  // first, it is paid only on the rare below-floor path, and the common path —
  // every request for one of the last three months — costs nothing at all.
  //
  // THE SHAPE CHECK IS FIRST, AND IT IS NOT DEFENSIVE PROGRAMMING. This function
  // takes `month: v.string()`, and getMyMonth's header in this file has long
  // recorded what that allows: a bare '2026' bounds '2026-01'..'2026-31', which
  // lexically brackets every day of the year. It sorts ABOVE a pro floor, so
  // without this a pro member could pull twelve months of every teammate's boards
  // in one payload — past the floor below, and past this file's own "SCOPED TO
  // ONE TEAM AND ONE MONTH" bandwidth argument. routes/app.tsx's `validateSearch` applies the
  // same rule to `?month=` before it ever reaches a query, so this is the check
  // for everything that is not the browser.
  //
  // `isMonth` RATHER THAN AN INLINE REGEX, so the shape rule sits in the same
  // module as the window rule it guards: the argument for refusing a malformed
  // month is that it sorts above a floor monthWindow.ts computes, and a private
  // copy of the pattern here would let one side be relaxed without the other.
  if (!isMonth(month)) throw accessError('MONTH_OUT_OF_WINDOW')

  // THE FREE FLOOR IS CHECKED FIRST, AND USUALLY IT IS THE WHOLE CHECK. Almost
  // every call asks for one of the last three months, and for those this costs
  // one string comparison and no database reads. Only a request OLDER than the
  // free floor pays for isProFor, and only one that passes THAT pays for the
  // per-member index walk — the free branch of the rule ignores earliestMonth
  // entirely, so fetching it before knowing the caller is pro would be work that
  // provably cannot change the answer.
  //
  // `serverFloorFor` CARRIES A MONTH OF SLACK and the reason is in its own
  // comment: this runtime is UTC and the viewer is not, so an exact window would
  // refuse a month the dropdown had just offered, at every month boundary.
  //
  // THE CLOCK READ IS A DEVIATION FROM THIS DIRECTORY'S CONVENTION and is worth
  // naming. Every other "what day is it" question on the server takes `today`
  // from the client and bounds it. Through access.ts's requirePlausibleToday,
  // which THROWS: upsertBoardFor below, teams.ts, scoringSystems.ts, and
  // inviteLinks.ts's consumeLink. Through isPlausibleToday directly, which
  // FALLS BACK to the server's day rather than throwing: insights.ts's teamMonth
  // and players.ts's completeProfileFor — the latter is the
  // documented exception requirePlausibleToday's own doc already carries, because throwing there
  // would refuse the player row and lock the account out. This reads `new Date()`
  // directly and bounds nothing, because it takes no client value to bound.
  //
  // Taking an argument instead would mean changing
  // getTeamMonth's signature at all six of its useSuspenseQuery call sites
  // (scores-table, scoring-legend, scoring-system-card, today-panel,
  // teams/team-boards, board-entry/form) for a bound whose only failure direction
  // is MORE permissive — Convex caches on read-set invalidation rather than
  // wall-clock, so a long-lived subscriber's floor simply stays older than it
  // should, never newer. Accepted deliberately; revisit if this function ever
  // needs the DAY rather than the month, where a stale value would actually be
  // visible.
  const serverMonth = monthOf(toPuzzleDay(new Date()))
  const freeFloor = serverFloorFor({ currentMonth: serverMonth, earliestMonth: null, pro: false })
  if (month < freeFloor) {
    // DOES THE REFUSAL RE-FIRE WHEN THE PLAYER UPGRADES? UNVERIFIED — recorded
    // as unverified deliberately rather than assumed either way. This throw
    // happens AFTER isProFor has read `playerMembership by_player`, so if Convex
    // records the read set of a throwing execution the subscription invalidates
    // when the Polar webhook patches that row, and the scoreboard appears without
    // a reload. That is the behaviour to expect and it is what the ordering here
    // gives the best chance of, but convex-test models no subscriptions at all,
    // so nothing in this repo can prove it and the answer lives in the backend.
    //
    // THE CONSEQUENCE IF IT DOES NOT is bounded, which is why this is a note and
    // not a blocker. The checkout return is a full document navigation to
    // /app?checkout=success (convex/polar.ts's successUrl), so the paid-and-
    // redirected path re-runs every query from scratch — and checkoutReturnUrl
    // preserves `?month=` on purpose, so the player lands back on the month they
    // were refused, now allowed. Only the in-page case is exposed: the webhook
    // landing while the tab sits open, where `api.teams.amIPro` updates live and
    // this query might not. Worth measuring against a real deployment before the
    // dropdown starts offering out-of-window months in task 5: wordle-teams-q0x0.
    if (!(await isProFor(ctx, playerId))) throw accessError('MONTH_OUT_OF_WINDOW')

    // THE SAME `serverFloorFor`, NOT A BARE `month < earliestMonth`. The pro
    // floor has to carry the same month of slack the free one does, for the same
    // UTC-versus-viewer reason, and it has to respect the MAX_MONTHS cap that
    // bounds an unvalidated `puzzleDay`. Routing both tiers through one function
    // is what stops the two floors drifting apart.
    const earliestMonth = await earliestMonthFor(ctx, team.playerIds)
    if (month < serverFloorFor({ currentMonth: serverMonth, earliestMonth, pro: true })) {
      throw accessError('MONTH_OUT_OF_WINDOW')
    }
  }

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
 * (Convex index queries default to ascending; insights.ts's myBenchmarkBoards writes
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
 * (its own `if (!member) return null`) and getMyTeamsFor (teams.ts) share — Convex ids are not
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
 * OLD MONTH, AND getTeamMonthFor REFUSES A MONTH BELOW THE FLOOR THIS VALUE
 * FEEDS. So the moment the roster narrows, a Pro viewer parked on a `?month=`
 * outside the new window would stop getting a scoreboard and start getting
 * "That month is part of Pro." — on a page they did nothing to.
 *
 * `correctedMonth` in src/lib/dashboard-months.ts is what stops that, and
 * routes/app.tsx navigates on it from an effect: any `?month=` outside the
 * selected team's window is moved back to the window's newest month. A roster
 * change gets the same correction a team switch does, for the same reason —
 * the viewer did nothing wrong.
 *
 * IT IS A CORRECTION AFTER COMMIT, NOT BEFORE THE READ. The six
 * useSuspenseQuery(getTeamMonth) callers fire during render, so a narrowed
 * window can still surface the refusal for the render before the correction
 * lands. wordle-teams-alr7 tracks that race.
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
      // than after — the same guard getTeamMonthFor (above) and teams.ts's getMyTeamsFor
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
    // PuzzleDay is 'YYYY-MM-DD' BY CONVENTION ON THE ROWS THAT ALREADY EXIST, so
    // lexical comparison is chronological for every well-formed row, but a single
    // malformed one (say, an empty string) sorts below every real day and would
    // silently become the minimum, dropping a paying member into the free window.
    // Nothing here crashes on that: lib/monthWindow.ts's `isMonth` catches a
    // malformed `earliestMonth` downstream and treats it as if the team had none.
    //
    // upsertBoardFor NOW REFUSES SUCH A DAY ON THE WAY IN (wordle-teams-qvqi), so
    // no NEW row can be one — but this read is over the whole table's history, and
    // migrate.ts and e2eSeed.ts both insert without passing through that check. A
    // guard here is still guarding something.
    if (row !== null && (earliest === null || row.puzzleDay < earliest)) earliest = row.puzzleDay
  }
  return earliest === null ? null : monthOf(earliest)
}

/**
 * How far back this team goes — the one input the month dropdown cannot compute
 * for itself.
 *
 * IT DOES NOT RETURN `pro`, AND THAT IS DELIBERATE. routes/app.tsx already holds
 * the viewer's membership from `api.teams.amIPro`, in the `isPro` its `Dashboard`
 * binds beside the other suspense queries at the top. Returning it here
 * too would give the client two independently-updating subscriptions to one fact —
 * structurally the aggregate-versus-live split-brain wordle-teams-iht.4 is about.
 * The SERVER still needs it, and reads it straight from isProFor at the one place
 * that enforces — getTeamMonthFor's month gate above (wordle-teams-kusd's task
 * 3). That gate also re-derives `earliestMonth` for itself rather than trusting
 * anything this query returned, which is the point of the split: this is the
 * DROPDOWN's input, and a client that lies about it can only mislead its own UI.
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
 * played — `pickDefaultDay`'s `playedDays`, built from `myScores` in
 * board-entry/form.tsx — so a single-day read cannot feed it.
 *
 * THE SAME SCORE SHAPE getTeamMonthFor emits (its `scores.map` over the in-range
 * rows, four fields, no `playerId`), deliberately,
 * so the form derives from one shape whichever query fed it. It reads the same
 * index through the same monthRange bounds for the same reason: given a
 * WELL-FORMED 'YYYY-MM', `end` is '<month>-31' as a LEXICAL bound on
 * 'YYYY-MM-DD', so it includes a 30-day month's last day and cannot reach into
 * the next month.
 *
 * THAT GUARANTEE IS CONDITIONAL ON THE ARGUMENT'S SHAPE, and `v.string()` does
 * not enforce it: `{ month: '2026' }` bounds '2026-01'..'2026-31', which
 * lexically brackets every day of the year. routes/app.tsx's `validateSearch`
 * requires /^\d{4}-\d{2}$/ of `?month=` before a month can reach here from a
 * browser, and the `isMonth` check in the handler below is the rule for
 * everything that is not one — the same division getTeamMonthFor's gate states.
 *
 * WHY THE PRODUCT RULE IS NOT "YOUR OWN DATA IS FREE" (wordle-teams-byft,
 * resolved). It would be the obvious reading of this query and it is the wrong
 * one, because insights.ts's `myBenchmarkBoards` returns the caller's OWN boards
 * too and hands a free player exactly one of them — "HISTORY IS WHAT LAYER 2 IS",
 * in that query's own words. Two queries over the same rows cannot both be
 * explained by who owns the rows. THE RULE THAT ACTUALLY FITS BOTH IS:
 *
 *     EDITING YOUR OWN ENTRY IS FREE.
 *     BROWSING YOUR OWN HISTORY AS ANALYSIS IS LAYER 2.
 *
 * THIS QUERY IS THE EDITING AFFORDANCE, and the code says so rather than the
 * comment merely claiming it: its only production caller is `SoloBoardEntryForm`
 * in board-entry/form.tsx, where `useSuspenseQuery(getMyMonth)` becomes
 * `myScores` — which feeds `pickDefaultDay`'s `playedDays` and the `existing`
 * lookup that prefills the board being edited. Nothing renders it as a history.
 * A month floor here would be the first time this product refused someone the
 * form for an entry they own, and it would refuse it silently: the form would
 * open empty over a board that exists and a re-submit would overwrite it.
 *
 * myBenchmarkBoards IS THE ANALYSIS AFFORDANCE, and it is the Insights product
 * — a benchmark panel on /insights, not a way back into anything. Its layer
 * check is the paywall working, not an inconsistency with this file.
 *
 * SO THE TWO ARE ALLOWED TO DISAGREE ABOUT MONTHS, AND EACH NOW SAYS WHY IN ITS
 * OWN FILE so neither reads as an oversight. What would break the rule is this
 * query becoming a way to READ history rather than to edit an entry. If it ever
 * grows a `limit`, serves a range of months, feeds a panel, or starts returning
 * anything a teammate entered, it has crossed over and the layer check comes
 * with it.
 *
 * THE SHAPE CHECK IS NEW AND THE FLOOR IS STILL DELIBERATELY ABSENT — the task 4
 * audit recorded exactly that asymmetry against this function, and only half of
 * it was a real gap. A bare '2026' is not a month, so treating it as one is a
 * bug whatever the tiering says; how far back a month may reach is the product
 * question the rule above answers, and the answer for an editing affordance is
 * "as far back as they have boards".
 *
 * IT RETURNS [] RATHER THAN THROWING, WHICH DIVERGES FROM BOTH SIBLINGS, and the
 * divergence is the rule above applied rather than an inconsistency. getTeamMonthFor
 * and winners.ts's lastMonthWinnerFor both throw MONTH_OUT_OF_WINDOW on a
 * malformed month because for them the shape check IS the leak gate — a bare year
 * sorts above a Pro floor and pulls a year of every teammate's boards. Here there
 * is no window to be out of, the caller is reading their own rows, and the copy
 * ("That month is part of Pro.") would be a lie. '2026' is not a month, so it
 * contains no boards: [] is the honest answer AND the safe one, and it keeps
 * "editing your own entry is never refused" literally true one paragraph below
 * where it is written. It also matters that this is a `useSuspenseQuery` — a
 * throw here reaches the error boundary and takes the form away, which is the
 * outcome the rule exists to prevent.
 *
 * NULL-SAFE FOR A MISSING PLAYER, like onboarding.getStatus: this renders on
 * /app, which is reachable in the window before a player row exists.
 */
export const getMyMonth = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const player = await currentPlayer(ctx)
    if (!player) return []
    // See the header: `monthRange`'s "cannot reach into the next month" guarantee
    // holds only for a well-formed 'YYYY-MM'. `isMonth` from lib/monthWindow.ts
    // rather than a private regex, for the reason that function's own comment
    // gives — a second copy of the pattern is how the server's shape rule comes to
    // mean two different things in two files.
    if (!isMonth(month)) return []
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

  // THE DAY THIS BOARD IS FOR, CHECKED BEFORE ANYTHING IS READ OR WRITTEN
  // (wordle-teams-qvqi). `puzzleDay` arrives as a bare `v.string()`, and until
  // this line nothing on the server looked at its shape at all: '', '1', 'x' and
  // '1000-01-01' were every one of them storable, forever, as half of this
  // table's `by_player_and_puzzleDay` key.
  //
  // IT IS THE ROOT CAUSE THE MONTH WINDOW HAD TO DEFEND AGAINST DOWNSTREAM. A
  // stored '' sorts below every real day, so `earliestMonthFor` above takes it as
  // the team's minimum, `monthOf('')` is '', `monthIndex('')` is NaN, and the
  // window is empty — which breaks the "currentMonth is always element 0"
  // invariant src/lib/dashboard-months.ts's corrective navigation terminates on.
  // lib/monthWindow.ts's `isMonth` guard and its MAX_MONTHS cap both exist for
  // rows like that. THEY STAY, and this does not make them redundant: they defend
  // rows that already exist and rows migrate.ts and e2eSeed.ts write directly,
  // neither of which comes through here. What this closes is the path a client
  // can reach.
  //
  // FIRST, BEFORE `existing` IS EVEN LOOKED UP, for getTeamMonthFor's reason: a
  // refusal should not pay for the work it is refusing. An unusable day costs one
  // string comparison and no database access at all.
  //
  // THE RANGE IS DELIBERATELY NOT "TODAY". Backfill is a supported feature — the
  // form's date picker opens on any past day of the selected month — so the bound
  // runs from Wordle's own first puzzle to one day past the server's today. Both
  // ends are argued in lib/puzzleDay.ts's `isPlausiblePuzzleDay`; access.ts's
  // `requirePlausiblePuzzleDay` reads the clock and throws.
  requirePlausiblePuzzleDay(puzzleDay)

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
    // STILL `v.string()`, AND THE CHECK IS IN upsertBoardFor RATHER THAN HERE.
    // Convex validators are shape-only over primitives — there is no `v.string()`
    // with a pattern — so the rule would have to be code either way, and putting
    // it in the `...For` helper is what makes it reachable by convex-test, which
    // cannot drive an authed mutation wrapper (wordle-teams-obw). Every other
    // rule in this file is placed the same way for the same reason.
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
