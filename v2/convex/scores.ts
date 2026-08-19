import { v } from 'convex/values'
import { query } from './_generated/server'
import { currentPlayer, requirePlayer, requireTeamMemberFor } from './access'
import { monthRange } from './lib/puzzleDay.ts'
import type { Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader } from 'convex/server'

/**
 * Anything with a `db` reader — a query, mutation, or a convex-test `ctx.run`.
 *
 * Mirrors access.ts's ReaderCtx exactly, for the same reason: getTeamMonthFor
 * only ever touches `ctx.db`, and keeping the parameter type to just that lets
 * convex-test's `t.run` callback ctx satisfy it with no cast.
 */
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

/**
 * The core loop's reads.
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
 * Just enough to drive the team selector. Real team management is Phase 3.
 *
 * Collect-and-filter is the sanctioned approach for "teams containing player X":
 * Convex cannot index array membership. See the schema comment on `teams`.
 *
 * The cost this incurs is NOT about team count — it's about Convex's reactive
 * re-push. This query's read-set is the ENTIRE teams table, so a write to ANY
 * team invalidates the subscription for EVERY client currently subscribed to
 * getMyTeams, and each of them re-reads all rows on the next push. Bandwidth
 * cost scales with (writes to the teams table) x (concurrent subscribers), not
 * with how many teams exist or how many a given player is on — so "171 teams
 * today" says nothing about when this stops being fine. Revisit if that
 * product grows large: e.g. team-settings edits or the Phase 4 invite flow
 * becoming frequent while many clients have this query open, not simply
 * because the table grows past today's row count.
 */
export const getMyTeams = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return []
    const teams = await ctx.db.query('teams').collect()
    return teams
      .filter((team) => team.playerIds.includes(player._id))
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .map((team) => ({ id: team._id, name: team.name }))
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
