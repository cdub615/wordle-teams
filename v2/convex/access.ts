import { ConvexError } from 'convex/values'
import { authComponent } from './auth'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { GenericDatabaseReader } from 'convex/server'

/**
 * The access checks that replace Supabase's RLS policies.
 *
 * v1 enforced reads in the database; Convex has no equivalent, so every query
 * and mutation calls one of these FIRST. See the parent design's Postgres logic
 * relocation table.
 *
 * The membership check comes in two forms on purpose. requireTeamMemberFor takes
 * an explicit playerId and is what the tests exercise, so the negative cases can
 * be proven against real documents without standing up a Better Auth session in
 * the harness. requireTeamMember is the thin wrapper the functions actually call.
 */

// If you add a member here, src/lib/convex-error.ts's boardErrorMessage switch
// must grow a case too — it is exhaustive against this type on purpose.
// INVALID_DATE and CREATOR_NOT_REMOVABLE are not thrown anywhere yet — Tasks 6
// and 7 do that. Added now, alongside INVALID_TEAM, because the union and the
// exhaustive switch in convex-error.ts are already open for INVALID_TEAM's
// split; adding them later would mean reopening both files a second time.
export type AccessCode =
  | 'UNAUTHENTICATED'
  | 'NO_PLAYER'
  | 'NOT_A_MEMBER'
  | 'INVALID_BOARD'
  | 'NOT_TEAM_CREATOR'
  | 'INVALID_TEAM'
  | 'INVALID_DATE'
  | 'CREATOR_NOT_REMOVABLE'
  | 'INVALID_SYSTEM'

/**
 * Throws a ConvexError carrying `{ code }`.
 *
 * It throws INTERNALLY rather than constructing an error for the caller to
 * throw, so a call site that forgets `throw` still refuses the request. That
 * runtime guarantee is the point, not the `never` return type: TypeScript does
 * NOT reject a bare `accessError(...)` call — it silently treats what follows
 * as unreachable — so the type alone would not have saved us.
 *
 * Measured, not assumed. With the earlier construct-and-return signature, a
 * guard written `if (!allowed) accessError('NOT_A_MEMBER')` returned the
 * caller's data with no type error and no runtime error: a silent
 * authorization bypass. On an access check that is the failure mode that
 * matters, and this shape removes it.
 */
export function accessError(code: AccessCode): never {
  throw new ConvexError({ code })
}

/**
 * Anything with a `db` reader — a query, mutation, or a convex-test `ctx.run`.
 *
 * Deliberately narrower than the real Convex function contexts: playerForEmail
 * and requireTeamMemberFor only ever touch `ctx.db`, and keeping the parameter
 * type to just that lets convex-test's `t.run` callback ctx (a real
 * GenericMutationCtx, which structurally has a `db: GenericDatabaseWriter` —
 * itself a `GenericDatabaseReader`) satisfy it with no cast.
 */
type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

/**
 * The real Convex function contexts — what `query`/`mutation` handlers actually
 * receive, and what `authComponent.getAuthUser` requires (it wants
 * `GenericCtx<DataModel> = GenericQueryCtx | GenericMutationCtx |
 * GenericActionCtx`; `QueryCtx`/`MutationCtx` from `./_generated/server` are
 * exactly the first two members of that union, which is what me.ts and auth.ts
 * already pass it with no cast). Access checks are only ever called from
 * queries and mutations, never actions, so this narrower union is enough.
 */
type AuthCtx = QueryCtx | MutationCtx

/**
 * The copied player behind an email address.
 *
 * THE LINK IS BY EMAIL, for the reason me.ts spells out: copied players carry a
 * Supabase legacyId but nothing joins them to a Better Auth user id. Normalised
 * to lowercase because copied emails always are and a provider may not be.
 *
 * .first() rather than .unique(): a duplicate email would be a real data problem,
 * but throwing here would take down the signed-in page instead of showing the
 * user their teams.
 */
export async function playerForEmail(
  ctx: ReaderCtx,
  email: string,
): Promise<Doc<'players'> | null> {
  return await ctx.db
    .query('players')
    .withIndex('by_email', (q) => q.eq('email', email.toLowerCase()))
    .first()
}

/** The signed-in user's player, or null if there is no session or no match. */
export async function currentPlayer(ctx: AuthCtx): Promise<Doc<'players'> | null> {
  const user = await authComponent.getAuthUser(ctx)
  if (!user?.email) return null
  return await playerForEmail(ctx, user.email)
}

/** The signed-in user's player, or a typed throw. */
export async function requirePlayer(ctx: AuthCtx): Promise<Doc<'players'>> {
  const user = await authComponent.getAuthUser(ctx)
  if (!user?.email) throw accessError('UNAUTHENTICATED')
  const player = await playerForEmail(ctx, user.email)
  if (!player) throw accessError('NO_PLAYER')
  return player
}

/**
 * The team, if that player is on it. Throws NOT_A_MEMBER otherwise — including
 * when the team does not exist, so a probe cannot distinguish "no such team"
 * from "not yours".
 */
export async function requireTeamMemberFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<Doc<'teams'>> {
  const team = await ctx.db.get(teamId)
  if (!team) throw accessError('NOT_A_MEMBER')
  if (!team.playerIds.includes(playerId)) throw accessError('NOT_A_MEMBER')
  return team
}

/** The signed-in player and a team they belong to. */
export async function requireTeamMember(
  ctx: AuthCtx,
  teamId: Id<'teams'>,
): Promise<{ player: Doc<'players'>; team: Doc<'teams'> }> {
  const player = await requirePlayer(ctx)
  const team = await requireTeamMemberFor(ctx, player._id, teamId)
  return { player, team }
}

/**
 * The team, if that player created it.
 *
 * WHY CREATOR-ONLY, AND WHY SERVER-SIDE. v1's UI offers Settings, Invite and
 * Delete only to the creator, but its RLS policy permits UPDATE to the creator
 * OR any member — including writes to player_ids, so any member can remove any
 * other member through the API. v2 makes the UI's rule the real one. No user
 * sees a behaviour change; the rule simply stops being cosmetic. Recorded as
 * divergence 4 in V2-ADDENDUM 7a.
 *
 * A non-member gets NOT_A_MEMBER rather than NOT_TEAM_CREATOR, matching
 * requireTeamMemberFor: a probe must not be able to distinguish "no such team"
 * from "not yours" from "yours but not yours to edit".
 *
 * `creator` is optional because a scoped copy may not include it. Such a team
 * has NOBODY who can edit it. That is honest — you are not the creator — and it
 * is asserted in the tests so it is a known property rather than a beta
 * surprise.
 */
export async function requireTeamCreatorFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<Doc<'teams'>> {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  if (team.creator !== playerId) throw accessError('NOT_TEAM_CREATOR')
  return team
}

/** The signed-in player and a team they created. */
export async function requireTeamCreator(
  ctx: AuthCtx,
  teamId: Id<'teams'>,
): Promise<{ player: Doc<'players'>; team: Doc<'teams'> }> {
  const player = await requirePlayer(ctx)
  const team = await requireTeamCreatorFor(ctx, player._id, teamId)
  return { player, team }
}

/**
 * Whether this player is on the pro plan.
 *
 * READ ONLY, AND NOT ENFORCED. Phase 3 uses this to hide the scoring editor and
 * to swap "New Team" for "Upgrade for more" past two teams — the same two gates
 * v1 has. v1's gates are UI-only too: its `save` action does not check pro, and
 * nothing stops a free account creating five teams through the API. Enforcing
 * here would be a behaviour change rather than a port. Phase 5 owns whether
 * that changes.
 */
export async function isProFor(ctx: ReaderCtx, playerId: Id<'players'>): Promise<boolean> {
  const membership = await ctx.db
    .query('playerMembership')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .first()
  return membership?.membershipStatus === 'pro'
}
