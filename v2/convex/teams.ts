import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, currentPlayer, isProFor, requirePlayer, requireTeamCreatorFor } from './access'
import { hasCompleteProfile } from './lib/player.ts'
import { DEFAULT_SYSTEM } from './lib/scoringSystem.ts'
import { addDays, toPuzzleDay } from './lib/puzzleDay.ts'
import { monthsWithWinners, recomputeTeamMonths } from './winners.ts'
import type { Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader } from 'convex/server'
import type { WriterCtx } from './winners.ts'
import type { PuzzleDay } from './lib/puzzleDay.ts'

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

/**
 * The submitter's own local today, bounded server-side.
 *
 * Lifted from upsertBoardFor's guard and shared, because it is needed for the
 * same reason: `today` is client-supplied, the server has no viewer whose
 * midnight it could ask for, and the value is NOT confined to the caller — it
 * decides which missed days are due for every member of the team, and the
 * result is written to monthlyWinners, which the whole team reads. An unbounded
 * value is shared-state corruption, not a personal view quirk.
 *
 * ±1 day of the server's date. Convex runs UTC, and UTC-12..UTC+14 spans 26
 * hours, so a legitimate client anywhere on earth is always within one calendar
 * day of it. See wordle-teams-04r: that Convex's clock is UTC is currently an
 * inference, and confirming it is a pre-cutover task.
 */
function requirePlausibleToday(today: PuzzleDay): PuzzleDay {
  const serverToday = toPuzzleDay(new Date())
  if (today < addDays(serverToday, -1) || today > addDays(serverToday, 1)) {
    // NOT INVALID_TEAM. A clock this far off is not a naming problem, and
    // telling the user "a team needs a name" would be actively wrong. See the
    // code split in Task 4.
    throw accessError('INVALID_DATE')
  }
  return today
}

function requireName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw accessError('INVALID_TEAM')
  return trimmed
}

export type TeamSettings = { name: string; playWeekends: boolean; showLetters: boolean }

/**
 * Create a team, with the caller as its only member and its creator.
 *
 * NO SERVER-SIDE TEAM CAP. v1 shows "Upgrade for more" once a free account has
 * two teams, but that is UI only — nothing stops a free account creating five
 * through the API. Phase 3 reproduces the gate where v1 has it. Phase 5 owns
 * whether it becomes real.
 */
export async function createTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  settings: TeamSettings,
): Promise<Id<'teams'>> {
  return await ctx.db.insert('teams', {
    name: requireName(settings.name),
    creator: playerId,
    playerIds: [playerId],
    invited: [],
    playWeekends: settings.playWeekends,
    showLetters: settings.showLetters,
    createdAt: Date.now(),
    // The ORIGINAL system. The editor writes scoringSystems rows from here on
    // and never touches these eight fields again — see lib/scoringSystem.ts.
    ...DEFAULT_SYSTEM,
  })
}

export const createTeam = mutation({
  args: { name: v.string(), playWeekends: v.boolean(), showLetters: v.boolean() },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    return await createTeamFor(ctx, player._id, args)
  },
})

/**
 * Rename a team and set its two flags.
 *
 * RECOMPUTES EVERY MONTH WITH A WINNER ROW WHEN playWeekends FLIPS, and nothing
 * otherwise. playWeekends is an input to monthTotal — turning it off removes
 * every Saturday and Sunday from every month's total — so leaving the stored
 * winners alone would leave the card and the scoreboard disagreeing on the same
 * screen. A rename changes no total and triggers no recompute.
 */
export async function updateTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  args: TeamSettings & { teamId: Id<'teams'>; today: PuzzleDay },
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, args.teamId)
  const today = requirePlausibleToday(args.today)
  const name = requireName(args.name)
  const weekendsChanged = team.playWeekends !== args.playWeekends

  await ctx.db.patch(team._id, {
    name,
    playWeekends: args.playWeekends,
    showLetters: args.showLetters,
  })

  if (!weekendsChanged) return
  const updated = (await ctx.db.get(team._id))!
  await recomputeTeamMonths(ctx, updated, await monthsWithWinners(ctx, team._id), today)
}

export const updateTeam = mutation({
  args: {
    teamId: v.id('teams'),
    name: v.string(),
    playWeekends: v.boolean(),
    showLetters: v.boolean(),
    today: v.string(),
  },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await updateTeamFor(ctx, player._id, args)
  },
})

/**
 * Delete a team, CASCADING BY HAND.
 *
 * Postgres has ON DELETE CASCADE on monthly_winners.team_id; Convex has no such
 * thing, so the rows have to go explicitly or they become unreachable orphans
 * that still count against the free tier and still turn up in a parity
 * reconciliation.
 *
 * dailyScores are NOT deleted. A board belongs to a player and is shared across
 * every team they are on — daily_scores has no team foreign key in Postgres
 * either — so deleting a team must never destroy anybody's history.
 */
export async function deleteTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<void> {
  const team = await requireTeamCreatorFor(ctx, playerId, teamId)

  const winners = await ctx.db
    .query('monthlyWinners')
    .withIndex('by_team_year_month', (q) => q.eq('teamId', team._id))
    .collect()
  for (const row of winners) await ctx.db.delete(row._id)

  const systems = await ctx.db
    .query('scoringSystems')
    .withIndex('by_team_and_effectiveFrom', (q) => q.eq('teamId', team._id))
    .collect()
  for (const row of systems) await ctx.db.delete(row._id)

  await ctx.db.delete(team._id)
}

export const deleteTeam = mutation({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    await deleteTeamFor(ctx, player._id, teamId)
  },
})
