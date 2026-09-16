import { v } from 'convex/values'
import { mutation } from './_generated/server'
import { accessError, isProFor, requirePlayer, requirePlausibleToday, requireTeamOwnerFor } from './access'
import { resetChatCursorFor } from './chat.ts'
import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'
import { monthsWithBoards, recomputeForJoiner } from './winners.ts'
import type { Id } from './_generated/dataModel'
import type { PuzzleDay } from './lib/puzzleDay.ts'
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

/**
 * Join the team a link points at. This is the half of the feature that lets
 * somebody actually get in, and it is the security-critical one.
 *
 * ONE MESSAGE FOR EVERY DEAD-LINK STATE, AND THIS PATH ESTABLISHES THAT ITSELF.
 * It does NOT inherit the property from revokeLinkFor, whose two refusals ARE
 * distinguishable — see the comment there, which says so after a mutant proved
 * an earlier claim to the contrary false. The difference is that this path is
 * reachable BEFORE sign-in: distinguishing "revoked" from "expired" from "the
 * team is gone" from "never existed" tells a stranger which tokens once
 * existed, and none of the four gives the holder anything different to do.
 *
 * THE CAP REFUSAL BELOW IS DELIBERATELY NOT IN THAT SET. A legitimate holder
 * blocked by the free-tier cap can act on it, and telling them to upgrade is
 * the point.
 */
export async function consumeLinkFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  token: string,
  today: PuzzleDay,
): Promise<void> {
  const link = await ctx.db
    .query('inviteLinks')
    .withIndex('by_token', (q) => q.eq('token', token))
    .unique()

  if (!link || link.revokedAt !== undefined || link.expiresAt < Date.now()) {
    throw accessError('INVITE_LINK_INVALID')
  }

  // THE FOURTH DEAD STATE, ANSWERED WITH THE SAME CODE rather than the
  // INVALID_TEAM the plan named. First reason is unchanged: INVALID_TEAM's copy
  // is "A team needs a name." — written for a rejected rename, and simply false
  // here. Answering differently would also tell a stranger holding an old link
  // that the team once existed.
  //
  // THE SECOND REASON USED TO BE THAT THIS STATE WAS REACHABLE, AND IT NO
  // LONGER IS (wordle-teams-2c1u). cascadeDeleteTeam did not collect
  // inviteLinks, so deleting a team left every link it had issued dangling and
  // this branch was the thing catching them. It sweeps them now, and it is the
  // only code path that deletes a `teams` document — so in ordinary operation
  // nothing should arrive here at all.
  //
  // THE GUARD STAYS, and the change of status is the argument for keeping it
  // rather than against. `link.teamId` is a stored reference this function must
  // dereference regardless, and its integrity now depends on a sweep in another
  // module continuing to be correct. This is the check that does not depend on
  // that being true — a future deletion path that forgets, or a row predating
  // the fix, lands here and is refused rather than reaching `team.playerIds` on
  // a null.
  const team = await ctx.db.get(link.teamId)
  if (!team) throw accessError('INVITE_LINK_INVALID')

  // IDEMPOTENT, AND BEFORE THE CAP CHECK. Appending unconditionally would put
  // the same id in the roster twice, which shows the person twice on the team
  // card and enters them twice in recomputeTeamMonth's candidate list — the
  // exact hazard teams.ts:266 records on the email path. Returning here also
  // means a current member is never refused by the cap for a team they are
  // already counted on, and never has a live chat cursor wiped: the same line
  // players.ts draws with its `if (!alreadyMember)`.
  if (team.playerIds.includes(playerId)) return

  // THE CAP, RE-ENFORCED. FREE_TEAM_LIMIT is enforced in exactly two places
  // today and a link join runs NEITHER: completeProfileFor applies it during
  // its invited-scan, and invitePlayerFor applies it when parking an address.
  // Without this the link is a hole the size of the whole cap.
  //
  // REFUSING IS NEW BEHAVIOUR, DELIBERATELY. The email path never refuses — it
  // PARKS the address in teams.invited and continues, and billing.ts's
  // upgradeTeamInvitesFor releases it on upgrade. A link has nowhere to park,
  // so TEAM_LIMIT_REACHED is a new code rather than a reused one.
  if (!(await isProFor(ctx, playerId))) {
    // COUNTED THE WAY completeProfileFor COUNTS IT, not via getMyTeamsFor. That
    // helper resolves every member of every team to build a display payload;
    // this needs a number. Same collect-and-filter scan — Convex cannot index
    // array membership — with none of the fan-out.
    const allTeams = await ctx.db.query('teams').collect()
    const mine = allTeams.filter((t) => t.playerIds.includes(playerId)).length
    if (mine >= FREE_TEAM_LIMIT) throw accessError('TEAM_LIMIT_REACHED')
  }

  // BEFORE THE ROSTER PATCH, so no window exists in which they are a member
  // holding a stale cursor. chat.ts's resetChatCursorFor documents the ordering
  // rule and players.ts:262 follows it on the email path. A previous stint on
  // this team leaves a chatReads row behind — removal never cleans one up,
  // deliberately — saying they have read everything up to the day they left.
  //
  // THAT THE RESET HAPPENS IS COVERED; THAT IT HAPPENS FIRST IS NOT. Swapping
  // these two lines moves no test — planted and confirmed — because both run
  // inside one Convex transaction and nothing in the harness can observe the
  // interleaving. Keeping the order is a code-review obligation, the same kind
  // revokeLinkFor's comment records about its own unobservable check order.
  await resetChatCursorFor(ctx, playerId, team._id)
  await ctx.db.patch(team._id, { playerIds: [...team.playerIds, playerId] })

  // THE ROSTER PATCH IS NOT THE WHOLE JOIN, and for a long time this function
  // behaved as though it were (wordle-teams-c5ry). `teamMonthStats` is built
  // from the boards of everyone currently in `playerIds`, so the instant that
  // line lands, every month the joiner has played is stale on this team — and
  // the one that bites is TODAY: a free player who entered their board and then
  // followed a link got no daily-fact card at all on their first visit, because
  // the aggregate the card reads did not contain them yet.
  //
  // recomputeForJoiner owns the two bounds and the reasoning for both; the
  // months are read here so a caller claiming SEVERAL teams at once reads the
  // joiner's history once (players.ts does exactly that). Re-read the team
  // first: both loops inside read `playerIds` off the document handed to them,
  // and `team` above is the pre-patch snapshot.
  const joined = (await ctx.db.get(team._id))!
  await recomputeForJoiner(ctx, joined, await monthsWithBoards(ctx, playerId), today)
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

/**
 * `today` IS BOUNDED, NOT TRUSTED, for the reason every mutation that feeds a
 * client date into winner recomputation bounds it: the value decides which days
 * are already due for every member of the team being joined and is written into
 * a monthlyWinners row the whole team reads. The STRICT bound, the same one
 * teams.ts and scores.ts take — this refuses one ACTION and the holder can
 * retry, unlike completeProfileFor, which falls back rather than locking a
 * wrong-clocked device out of the product at signup.
 */
export const consumeLink = mutation({
  args: { token: v.string(), today: v.string() },
  handler: async (ctx, { token, today }) => {
    const player = await requirePlayer(ctx)
    await consumeLinkFor(ctx, player._id, token, requirePlausibleToday(today))
  },
})
