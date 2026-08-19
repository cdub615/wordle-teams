import { query } from './_generated/server'
import { currentPlayer, isProFor } from './access'
import { hasCompleteProfile } from './lib/player.ts'
import type { Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader } from 'convex/server'

/**
 * Team management. Phase 3 (wt-ksh.4).
 *
 * getMyTeams moved here from scores.ts and grew members, creator and settings,
 * so that ONE subscription drives the picker, the CurrentTeam card and the
 * MyTeams card.
 *
 * Splitting it into a thin picker query plus a scoped per-team detail query
 * would NOT have been cheaper: the read set is the entire teams table either
 * way, because Convex cannot index array membership (see the schema comment on
 * `teams`), so the split doubles subscriptions without shrinking what a write
 * invalidates. What is on the wire stays small — a player's own teams, one to
 * six of them.
 *
 * The cost that does exist: a write to ANY team invalidates this subscription
 * for EVERY connected client. Phase 3 raises team-write frequency, which is the
 * condition scores.ts flagged as the trigger to revisit. Acceptable at 171
 * teams and ~40 DAU; revisit if either number moves, not simply because the
 * table grows.
 */

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

export async function getMyTeamsFor(ctx: ReaderCtx, playerId: Id<'players'>) {
  const allTeams = await ctx.db.query('teams').collect()
  const mine = allTeams
    .filter((team) => team.playerIds.includes(playerId))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))

  // Convex functions run inside a single snapshot-isolated transaction, so
  // this is about round trips, not correctness — the outer Promise.all over
  // teams and the inner one over each team's members both resolve inside the
  // same transaction regardless of how they're awaited. At the realistic
  // ceiling (six teams, ~eight members each, per the two-team-cap-for-free /
  // pro-team-count context) that's under 60 reads total, all against a single
  // snapshot. Ordering is deterministic despite the concurrency: `mine` is
  // sorted by createdAt before the outer Promise.all runs, and Promise.all
  // preserves input order in its resolved array regardless of which promise
  // settles first, so both team order and, within a team, member order
  // (`team.playerIds` order) survive untouched.
  return await Promise.all(
    mine.map(async (team) => {
      const resolved = await Promise.all(
        team.playerIds.map(async (memberId) => {
          const member = await ctx.db.get(memberId)
          if (!member) return null
          // See lib/player.ts's hasCompleteProfile for why this exclusion
          // exists and why it must agree with getTeamMonthFor and
          // recomputeTeamMonth.
          if (!hasCompleteProfile(member)) return null
          return { id: member._id, firstName: member.firstName, lastName: member.lastName }
        }),
      )

      return {
        id: team._id,
        name: team.name,
        // Not `creator` itself: the caller only ever needs to know whether the
        // buttons are theirs, and a raw creator id is one more thing on the wire.
        isCreator: team.creator === playerId,
        playWeekends: team.playWeekends,
        showLetters: team.showLetters,
        // Fields are picked explicitly rather than spreading the doc, so the
        // wire payload cannot carry `invited`, which holds real email addresses.
        members: resolved.filter((member): member is NonNullable<typeof member> => member !== null),
      }
    }),
  )
}

export const getMyTeams = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return []
    return await getMyTeamsFor(ctx, player._id)
  },
})

/**
 * Whether the caller is on the pro plan, for the two UI gates v1 has: the
 * scoring editor, and "New Team" swapping to "Upgrade for more" past two teams.
 * Nothing is enforced server-side — see isProFor.
 */
export const amIPro = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return false
    return await isProFor(ctx, player._id)
  },
})
