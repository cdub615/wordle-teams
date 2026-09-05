import { ConvexError } from 'convex/values'
import { authComponent } from './auth'
import { isPlausibleToday, toPuzzleDay } from './lib/puzzleDay.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { GenericDatabaseReader } from 'convex/server'
import type { PuzzleDay } from './lib/puzzleDay.ts'

/**
 * The access checks that replace Supabase's RLS policies.
 *
 * v1 enforced reads in the database; Convex has no equivalent, so every query
 * and mutation calls one of these FIRST. See the parent design's Postgres logic
 * relocation table.
 *
 * The membership check takes an explicit playerId (requireTeamMemberFor) so
 * the negative cases can be proven against real documents without standing up
 * a Better Auth session in the harness. The functions call it directly with
 * their own `requirePlayer(ctx)` result rather than through a ctx-only
 * wrapper — see requireTeamOwnerFor below for the owner-checking sibling.
 */

// If you add a member here, src/lib/convex-error.ts's typedCodeMessage switch
// must grow a case too — it is exhaustive against this type on purpose.
// INVALID_DATE is thrown here (requirePlausibleToday); OWNER_NOT_REMOVABLE
// is thrown in teams.ts; INVALID_NAME is thrown in players.ts. INVALID_EMAIL is
// thrown in teams.ts too, by invitePlayerFor and cancelInviteFor, when
// normaliseInviteEmail rejects the submitted address. INVALID_REMINDER_METHOD,
// INVALID_REMINDER_TIME and INVALID_TIME_ZONE are thrown in settings.ts, by
// updateReminderMethodsFor, updateReminderTimeFor and updateTimeZoneFor.
// INVALID_PUSH_ENDPOINT is thrown in push.ts, by saveSubscriptionFor, when the
// submitted endpoint does not parse as a URL with protocol exactly "https:" —
// rejecting it there covers every writer, not just the public mutation, and
// keeps a caller from pointing webpush.sendNotification (an https.request
// under the hood) at an arbitrary host.
// INVALID_MESSAGE and RATE_LIMITED are thrown in lib/chat.ts, by requireBody
// and by the send path's rate-limit check.
export type AccessCode =
  | 'UNAUTHENTICATED'
  | 'NO_PLAYER'
  | 'NOT_A_MEMBER'
  | 'INVALID_BOARD'
  | 'NOT_TEAM_OWNER'
  | 'INVALID_TEAM'
  | 'INVALID_DATE'
  | 'OWNER_NOT_REMOVABLE'
  | 'INVALID_SYSTEM'
  | 'INVALID_EMAIL'
  | 'INVALID_NAME'
  | 'INVALID_REMINDER_METHOD'
  | 'INVALID_REMINDER_TIME'
  | 'INVALID_TIME_ZONE'
  | 'INVALID_PUSH_ENDPOINT'
  | 'INVALID_MESSAGE'
  | 'RATE_LIMITED'

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

/**
 * The team, if that player owns it.
 *
 * WHY OWNER-ONLY, AND WHY SERVER-SIDE. v1's UI offers Settings, Invite and
 * Delete only to the owner, but its RLS policy permits UPDATE to the owner
 * OR any member — including writes to player_ids, so any member can remove any
 * other member through the API. v2 makes the UI's rule the real one. No user
 * sees a behaviour change; the rule simply stops being cosmetic. Recorded as
 * divergence 4 in V2-ADDENDUM 7a.
 *
 * A non-member gets NOT_A_MEMBER rather than NOT_TEAM_OWNER, matching
 * requireTeamMemberFor: a probe must not be able to distinguish "no such team"
 * from "not yours" from "yours but not yours to edit".
 *
 * `owner` is optional because a scoped copy may not include it. Such a team
 * has NOBODY who can edit it. That is honest — you are not the owner — and it
 * is asserted in the tests so it is a known property rather than a beta
 * surprise.
 */
export async function requireTeamOwnerFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<Doc<'teams'>> {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  if (team.owner !== playerId) throw accessError('NOT_TEAM_OWNER')
  return team
}

/**
 * The submitter's own local today, bounded server-side.
 *
 * The bound itself — isPlausibleToday — is shared across every mutation that
 * feeds a client-supplied `today` into winner recomputation: updateTeam,
 * removeMember, leaveTeam and invitePlayer in teams.ts, setScoringSystem in
 * scoringSystems.ts, and upsertBoard in scores.ts. All SIX reach it through
 * THIS function, and need it for the identical reason: see the doc comment on
 * isPlausibleToday in lib/puzzleDay.ts.
 *
 * ONE DOCUMENTED EXCEPTION, and it is not an omission: completeProfileFor
 * (players.ts) applies isPlausibleToday directly and falls back to the server's
 * date instead of calling this. Throwing there would refuse to create the
 * PLAYER ROW, and every route guard bounces a playerless account back to
 * /complete-profile, so a wrong device clock would lock the account out of the
 * product rather than blocking one action. It is still a clock-bounded surface;
 * it is not a requirePlausibleToday call site.
 *
 * KEEP THIS LIST WHOLE — wordle-teams-04r's pre-cutover check is "every
 * clock-bounded surface", and this is where a reader goes to enumerate them.
 * See wordle-teams-04r: that Convex's clock is UTC is currently an inference,
 * and confirming it is a pre-cutover task.
 */
export function requirePlausibleToday(today: PuzzleDay): PuzzleDay {
  const serverToday = toPuzzleDay(new Date())
  if (!isPlausibleToday(today, serverToday)) {
    // NOT INVALID_TEAM, NOT INVALID_BOARD, NOT INVALID_SYSTEM — one per calling
    // module. A clock this far off is not a naming problem, a board-shape
    // problem or an out-of-range points problem, and every one of those
    // messages would be actively wrong here: the input can be perfectly valid
    // and the device's clock is what's off. See the code split in Task 4.
    throw accessError('INVALID_DATE')
  }
  return today
}

/**
 * Whether this player is on the pro plan.
 *
 * ENFORCED AT EXACTLY ONE GATE, AND IT IS THE ONE v1 ENFORCES. One gate, two
 * call sites — v1 splits the same rule across two RPCs and so does v2. Decision K, and
 * this comment used to defer to "Phase 5 owns whether that changes" — Phase 5
 * happened, and the answer is "no change, with one exception that was already
 * decided". v2 enforces exactly as far as v1 does and no further:
 *
 * - THE TEAM CAP ON INVITEES IS ENFORCED, in teams.ts's invitePlayerFor and
 *   players.ts's completeProfileFor. v1 enforces it too, in the RPCs
 *   handle_add_player_to_team and handle_invited_signup — both of which work.
 *   Over cap and not pro, the address is parked in `teams.invited` and released
 *   by billing.ts's upgradeTeamInvitesFor on upgrade.
 * - `createTeam` PAST THE CAP IS NOT ENFORCED. v1 shows "Upgrade for more" but
 *   nothing stops a free account creating five teams through its API.
 * - THE SCORING-SYSTEM EDITOR IS NOT ENFORCED. v1's `save` action does not check
 *   pro either.
 *
 * Refusing either of those last two would start rejecting writes production
 * accepts today — a behaviour change dressed as a port. The asymmetry is v1's,
 * not one introduced here: v1 enforces the cap on the path where SOMEBODY ELSE
 * puts you on a team, and leaves the paths you drive yourself to the UI.
 *
 * THE FOURTH GATE wordle-teams-6tn NAMES — the month window — IS NOT LISTED
 * ABOVE BECAUSE IT DOES NOT EXIST HERE YET. month-picker.tsx's monthOptions
 * offers everyone the same three months, pro or not, so v2 currently shows a
 * pro player LESS history than production rather than gating more. There is
 * nothing to enforce until the pro expansion is built, and Phase 5 deliberately
 * did not build it: it is not a billing behaviour, and it still has no owning
 * phase. Whoever adds it inherits the enforcement question with it.
 */
export async function isProFor(ctx: ReaderCtx, playerId: Id<'players'>): Promise<boolean> {
  const membership = await ctx.db
    .query('playerMembership')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .first()
  return membership?.membershipStatus === 'pro'
}
