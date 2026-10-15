import { v } from 'convex/values'
import type { GenericDatabaseWriter } from 'convex/server'
import { mutation, query } from './_generated/server'
import type { DataModel, Id } from './_generated/dataModel'
import { accessError, requirePlayer, requireTeamOwnerFor } from './access'
import { clueLadderSwitchOn } from './lib/clueLadder/flag.ts'

/**
 * Which games a team plays (wordle-teams-9j7o.2.2). Wordle is every team's; the
 * clue ladder is a pilot the owner opts the team into (spec section 4).
 */

type WriterCtx = { db: GenericDatabaseWriter<DataModel> }

/**
 * The owner switches the team's clue ladder on or off.
 *
 * ON IS REFUSED WHILE THE DEPLOYMENT SWITCH IS OFF; OFF NEVER IS. An owner must
 * always be able to take a game off their team, whatever the deployment's
 * state, as ending a challenge always works (challenges.ts).
 */
export async function setTeamClueLadderFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  enabled: boolean,
): Promise<void> {
  if (enabled && !clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED)) throw accessError('CLUE_LADDER_DISABLED')
  await requireTeamOwnerFor(ctx, playerId, teamId)
  await ctx.db.patch(teamId, { clueLadderEnabled: enabled })
}

export const setTeamClueLadder = mutation({
  args: { teamId: v.id('teams'), enabled: v.boolean() },
  handler: async (ctx, { teamId, enabled }) => {
    const player = await requirePlayer(ctx)
    await setTeamClueLadderFor(ctx, player._id, teamId, enabled)
  },
})

/**
 * Whether the deployment offers the clue ladder at all. The owner's team
 * settings show the opt-in toggle only when it does (plan 2).
 */
export const clueLadderSwitch = query({
  args: {},
  handler: async () => ({ enabled: clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED) }),
})
