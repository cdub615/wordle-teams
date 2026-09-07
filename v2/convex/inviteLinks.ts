import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { accessError, requirePlayer, requireTeamOwnerFor } from './access'
import type { Id } from './_generated/dataModel'
import type { WriterCtx } from './winners.ts'

/** Seven days. Long enough to sit unread in a chat, short enough to expire. */
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * An opaque, unguessable token.
 *
 * THIS IS A CAPABILITY, NOT AN IDENTIFIER: anyone holding it joins the team, which
 * is the whole difference between a link and an email invite. It is looked up on a
 * path reachable before sign-in, so guessability is the only thing standing between
 * a stranger and somebody's team.
 *
 * crypto.getRandomValues, NOT Math.random, which is seeded and predictable. Nothing
 * else in convex/ uses randomness, so there was no precedent to copy — the test
 * "two links never collide" is what actually proves this runs in this runtime rather
 * than a comment asserting it does.
 *
 * THAT TEST PROVES THE CALL RUNS HERE; IT DOES NOT PROVE UNGUESSABILITY. A counter
 * would satisfy 25 distinct tokens just as well (planted and confirmed). Nothing in
 * the suite can distinguish random from merely distinct, so the source of the bytes
 * is a code-review obligation: if this line ever stops being getRandomValues, no
 * test will tell you.
 */
function newToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<string> {
  await requireTeamOwnerFor(ctx, playerId, teamId)
  const token = newToken()
  await ctx.db.insert('inviteLinks', {
    teamId,
    token,
    createdBy: playerId,
    expiresAt: Date.now() + LINK_TTL_MS,
  })
  return token
}

export async function revokeLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  token: string,
): Promise<void> {
  const link = await ctx.db
    .query('inviteLinks')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique()
  // THESE TWO REFUSALS ARE DISTINGUISHABLE, and that is a deliberate limit rather
  // than a property to lean on. An unknown token answers INVITE_LINK_INVALID; a
  // real token on a team you do not own answers NOT_TEAM_OWNER, and this file's
  // tests assert exactly that pair. So a signed-in caller can use revokeLink as an
  // oracle for "does this token exist".
  //
  // TOLERABLE HERE AND ONLY HERE: you must already hold the token to ask, and
  // holding it IS the capability, so the oracle tells you nothing you did not
  // already have. It would NOT be tolerable on the consume path, which is
  // reachable BEFORE sign-in. That path answers unknown, expired and revoked with
  // one indistinguishable refusal, and it has to establish that itself rather than
  // inherit a property this function does not have. (The cap refusal there is
  // deliberately NOT folded in: a legitimate holder blocked by the free-tier cap
  // can act on that, and telling them to upgrade is the point.)
  //
  // The order of the two checks below is unobservable — ownership cannot be tested
  // until the row is loaded, so swapping them changes no outcome for any input.
  // Planted and confirmed: no test moves.
  if (!link) throw accessError('INVITE_LINK_INVALID')
  await requireTeamOwnerFor(ctx, playerId, link.teamId)
  await ctx.db.patch(link._id, { revokedAt: Date.now() })
}

export const createLink = mutation({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await createLinkFor(ctx, player._id, teamId)
  },
})

export const revokeLink = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const player = await requirePlayer(ctx)
    await revokeLinkFor(ctx, player._id, token)
  },
})
