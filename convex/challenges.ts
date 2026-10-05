import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { accessError, isProFor, requirePlayer, requireTeamMemberFor } from './access.ts'
import { MAX_ACTIVE_CHALLENGES, PROPOSAL_TTL_DAYS } from './lib/challenge.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseWriter, GenericDatabaseReader } from 'convex/server'

/**
 * TEAM-VERSUS-TEAM CHALLENGES (wordle-teams-zic8.2).
 *
 * THE LOGIC LIVES IN THE `*For` HELPERS, NOT IN THE WRAPPERS, for the reason
 * lib/insightsAccess.ts gives: nothing in this repo can drive an authed Convex
 * wrapper (wordle-teams-obw), so a rule inside a `mutation({...})` is a rule no
 * test can execute. Every wrapper below is two lines — resolve the player, call
 * the helper.
 *
 * REFUSALS GO THROUGH accessError, never a bare `throw new Error`. A plain Error
 * message is REDACTED in production while convex-test never redacts, so a plain
 * throw is a message no test can see go missing.
 */

type WriterCtx = { db: GenericDatabaseWriter<DataModel> }
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

const TTL_MS = PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000

/** Statuses that occupy a slot against MAX_ACTIVE_CHALLENGES. */
const LIVE_STATUSES = ['pending', 'active'] as const

/**
 * Every live challenge this team is part of, on EITHER side.
 *
 * TWO QUERIES BECAUSE THERE ARE TWO INDEXES, and that is the schema's decision
 * rather than this function's: Convex cannot OR across indexes, and an array of
 * both ids would be unindexable. Four point lookups beats any scan.
 *
 * INVARIANT: no row ever has challengerTeamId === opponentTeamId. Such a row would
 * be returned TWICE, once per index, inflating that team's count. Unreachable today
 * because the self-challenge check refuses it, but this is where it is written down.
 */
export async function liveChallengesFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
): Promise<Array<Doc<'teamChallenges'>>> {
  const found: Array<Doc<'teamChallenges'>> = []
  for (const status of LIVE_STATUSES) {
    found.push(
      ...(await ctx.db
        .query('teamChallenges')
        .withIndex('by_challenger_and_status', (q) =>
          q.eq('challengerTeamId', teamId).eq('status', status),
        )
        .collect()),
      ...(await ctx.db
        .query('teamChallenges')
        .withIndex('by_opponent_and_status', (q) =>
          q.eq('opponentTeamId', teamId).eq('status', status),
        )
        .collect()),
    )
  }
  return found
}

/**
 * How many slots this team currently occupies against MAX_ACTIVE_CHALLENGES.
 *
 * COUNTS 'pending' AND 'active', which is why it is named "live" rather than
 * "active". A pending proposal must occupy a slot: otherwise a team could hold
 * five running challenges and an unbounded pile of outstanding proposals, and
 * the cap would bound nothing that matters. The constant keeps its name because
 * it is the user-facing idea; this function is honest about the set it counts.
 */
export async function liveChallengeCountFor(
  ctx: ReaderCtx,
  teamId: Id<'teams'>,
): Promise<number> {
  return (await liveChallengesFor(ctx, teamId)).length
}

/**
 * The four checks a challenge between a KNOWN pair must pass.
 *
 * SHARED BY PROPOSE AND BY ACCEPT, AND THAT SHARING IS THE POINT (design §8.1).
 * A link proposal has no opponent at creation, so these cannot all run at
 * propose time; running them only there would make a link a bypass for every
 * limit an owner set. One function, called from both places, is what keeps the
 * two paths from drifting.
 */
export async function requireChallengeablePair(
  ctx: ReaderCtx,
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
): Promise<void> {
  if (challengerTeamId === opponentTeamId) throw accessError('INVALID_TEAM')

  const opponent = await ctx.db.get(opponentTeamId)
  if (opponent === null) throw accessError('INVALID_TEAM')
  // ABSENT MEANS YES. Only an explicit false refuses.
  if (opponent.acceptsChallenges === false) throw accessError('CHALLENGES_REFUSED')

  if ((await liveChallengeCountFor(ctx, challengerTeamId)) >= MAX_ACTIVE_CHALLENGES) {
    throw accessError('CHALLENGE_LIMIT_REACHED')
  }
  if ((await liveChallengeCountFor(ctx, opponentTeamId)) >= MAX_ACTIVE_CHALLENGES) {
    throw accessError('CHALLENGE_LIMIT_REACHED')
  }

  // ONE LIVE CHALLENGE PER UNORDERED PAIR. Either team may have been the proposer.
  // The second clause of the predicate is redundant TODAY: the rows come from
  // liveChallengesFor(challengerTeamId), so a row whose challenger is the opponent
  // is in that list only because its opponent is the challenger. The guarantee is
  // where the array comes from. The clause is kept so the predicate stays correct
  // if anyone ever passes it a differently-sourced array.
  const existing = (await liveChallengesFor(ctx, challengerTeamId)).find(
    (c) =>
      c.opponentTeamId === opponentTeamId ||
      (c.challengerTeamId === opponentTeamId && c.opponentTeamId === challengerTeamId),
  )
  if (existing !== undefined) throw accessError('CHALLENGE_EXISTS')
}

/**
 * Propose a challenge to a team the caller is also a member of.
 *
 * PRO IS REQUIRED TO INITIATE and deliberately NOT to accept. Gating acceptance
 * would make reach the square of Pro penetration and hide the feature from every
 * free team — and a challenged free team is this feature's best conversion
 * moment, since wordle-teams-0hx established that this product's
 * differentiators are discovered after arrival rather than searched for.
 */
export async function proposeToTeamFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
): Promise<Id<'teamChallenges'>> {
  await requireTeamMemberFor(ctx, playerId, challengerTeamId)
  if (!(await isProFor(ctx, playerId))) throw accessError('PRO_REQUIRED')

  // THE DUAL-MEMBERSHIP ENTRY POINT: you may name a team you are on. Naming a
  // team you are NOT on is the searchable-directory feature, which is out of
  // scope — the link path is how you reach a team you do not belong to.
  await requireTeamMemberFor(ctx, playerId, opponentTeamId)

  await requireChallengeablePair(ctx, challengerTeamId, opponentTeamId)

  // ONE CLOCK READ, so expiresAt - createdAt is exactly TTL_MS and a test can
  // assert it without a tolerance.
  const now = Date.now()
  return await ctx.db.insert('teamChallenges', {
    challengerTeamId,
    opponentTeamId,
    proposedBy: playerId,
    status: 'pending',
    expiresAt: now + TTL_MS,
    createdAt: now,
  })
}

export const proposeToTeam = mutation({
  args: { challengerTeamId: v.id('teams'), opponentTeamId: v.id('teams') },
  handler: async (ctx, { challengerTeamId, opponentTeamId }) => {
    const player = await requirePlayer(ctx)
    return await proposeToTeamFor(ctx, player._id, challengerTeamId, opponentTeamId)
  },
})

/**
 * An opaque, unguessable challenge token.
 *
 * THIS IS A CAPABILITY, NOT AN IDENTIFIER: anyone holding it can put one of
 * their own teams into a challenge, which is the whole difference between a link
 * and naming a team you are already on. It is looked up on a path reachable
 * before we know which team the holder acts for.
 *
 * crypto.getRandomValues, NOT Math.random. The "two tokens never collide" test
 * proves this call runs in this runtime; it does NOT prove unguessability, since
 * a counter would satisfy it just as well. If this line ever stops being
 * getRandomValues, no test will tell you — it is a code-review obligation, the
 * same one inviteLinks' newToken carries.
 */
function newToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Propose a challenge to whoever holds the link.
 *
 * THE OPPONENT IS UNKNOWN HERE, so only the checks that do not need one run:
 * membership, Pro, and the challenger's own cap. The pair checks run at claim
 * time instead — see claimChallengeLinkFor and design §8.1.
 *
 * WHY A LINK AT ALL: "someone you know on the other team" is a social fact the
 * app does not hold, and it has no friend graph outside team rosters. A link
 * leaves that fact where it actually lives — in whatever channel the friendship
 * already uses — rather than building a directory to approximate it.
 */
export async function proposeByLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  challengerTeamId: Id<'teams'>,
): Promise<string> {
  await requireTeamMemberFor(ctx, playerId, challengerTeamId)
  if (!(await isProFor(ctx, playerId))) throw accessError('PRO_REQUIRED')
  if ((await liveChallengeCountFor(ctx, challengerTeamId)) >= MAX_ACTIVE_CHALLENGES) {
    throw accessError('CHALLENGE_LIMIT_REACHED')
  }

  const token = newToken()
  // ONE CLOCK READ, so expiresAt - createdAt is exactly TTL_MS and a test can
  // assert it without a tolerance.
  const now = Date.now()
  await ctx.db.insert('teamChallenges', {
    challengerTeamId,
    proposedBy: playerId,
    status: 'pending',
    token,
    expiresAt: now + TTL_MS,
    createdAt: now,
  })
  return token
}

export const proposeByLink = mutation({
  args: { challengerTeamId: v.id('teams') },
  handler: async (ctx, { challengerTeamId }) => {
    const player = await requirePlayer(ctx)
    return await proposeByLinkFor(ctx, player._id, challengerTeamId)
  },
})
