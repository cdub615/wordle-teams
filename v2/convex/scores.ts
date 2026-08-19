import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, currentPlayer, requirePlayer, requireTeamMemberFor } from './access'
import { boardIsValid, normalizeGuesses } from './lib/board.ts'
import { addDays, monthOf, monthRange, toPuzzleDay } from './lib/puzzleDay.ts'
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

  // Convex functions run inside a single snapshot-isolated transaction, so
  // concurrent reads across members don't compete or change correctness —
  // each `await` below in a sequential loop would just be a serialized round
  // trip for no isolation benefit. Promise.all preserves the input order of
  // team.playerIds in the resolved array regardless of which read finishes
  // first, so member ordering is unaffected.
  const resolved = await Promise.all(
    team.playerIds.map(async (memberId) => {
      const member = await ctx.db.get(memberId)
      if (!member) return null
      // v1's getTeams excludes players without a completed profile: a
      // just-accepted invitee sits in player_ids with no name, and v1's
      // fromDbPlayer throws on one, crashing the client render.
      if (!member.firstName || !member.lastName) return null

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
      // A `teams` doc structurally satisfies ScoringSystem, but pick the fields
      // explicitly so the wire payload does not carry the invite list.
      system: {
        oneGuess: team.oneGuess,
        twoGuesses: team.twoGuesses,
        threeGuesses: team.threeGuesses,
        fourGuesses: team.fourGuesses,
        fiveGuesses: team.fiveGuesses,
        sixGuesses: team.sixGuesses,
        failed: team.failed,
        nA: team.nA,
      },
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

  // `today` is client-supplied, and the server has no viewer whose midnight it
  // could ask for instead. But it is NOT confined to the caller: recomputePlayerMonth
  // applies it to every member of every team they are on, and writes the result
  // to monthlyWinners, which the whole team reads. An unbounded value is
  // therefore shared-state corruption, not a personal view quirk.
  //
  // ±1 day of the server's date. Convex runs UTC, and UTC-12..UTC+14 spans 26
  // hours, so a legitimate client anywhere on earth is always within one
  // calendar day of it. Anything further is broken or hostile.
  const serverToday = toPuzzleDay(new Date())
  if (today < addDays(serverToday, -1) || today > addDays(serverToday, 1)) {
    throw accessError('INVALID_BOARD')
  }

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
