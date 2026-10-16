import { v } from 'convex/values'
import type { GenericDatabaseWriter } from 'convex/server'
import { mutation, query } from './_generated/server'
import type { DataModel, Id } from './_generated/dataModel'
import { accessError, requirePlausibleToday, requirePlayer, requireTeamOwnerFor } from './access'
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
 * state, as ending a challenge always works (challenges.ts). So `today` is
 * checked only when switching on.
 *
 * SWITCHING ON RECORDS THE OWNER'S TODAY as clueLadderOnSince
 * (wordle-teams-k1v5): the team's clue ladder scoreboard counts from that day.
 * Switching on what is already on keeps the day it has, so a second tab cannot
 * wipe out days the team has played. Switching off leaves it, and the next
 * switch-on moves it.
 */
export async function setTeamClueLadderFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  enabled: boolean,
  today: string,
): Promise<void> {
  if (enabled && !clueLadderSwitchOn(process.env.CLUE_LADDER_ENABLED)) throw accessError('CLUE_LADDER_DISABLED')
  const team = await requireTeamOwnerFor(ctx, playerId, teamId)
  if (!enabled) {
    await ctx.db.patch(teamId, { clueLadderEnabled: false })
    return
  }
  if (team.clueLadderEnabled === true) return
  await ctx.db.patch(teamId, { clueLadderEnabled: true, clueLadderOnSince: requirePlausibleToday(today) })
}

export const setTeamClueLadder = mutation({
  args: { teamId: v.id('teams'), enabled: v.boolean(), today: v.string() },
  handler: async (ctx, { teamId, enabled, today }) => {
    const player = await requirePlayer(ctx)
    await setTeamClueLadderFor(ctx, player._id, teamId, enabled, today)
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
