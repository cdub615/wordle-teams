import { ConvexError } from 'convex/values'
import { authComponent } from './auth'
import { insightsAccess } from './lib/insightsAccess.ts'
import { isPlausibleToday, toPuzzleDay } from './lib/puzzleDay.ts'
import type { Doc, Id, DataModel } from './_generated/dataModel'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { GenericDatabaseReader } from 'convex/server'
import type { InsightsAccess } from './lib/insightsAccess.ts'
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

// If you add a member here, BOTH functions in src/lib/convex-error.ts must grow
// an entry, and only one of them will tell you. typedCodeMessage's switch is
// exhaustive against this type on purpose, so it stops the build until the case
// exists. convexErrorCode's `||` chain cannot be — it narrows an arbitrary string
// off the wire — so a missing entry there is silent, and the copy you just wrote
// becomes unreachable behind the generic "Something went wrong". The mechanism
// that catches that is a test: src/lib/convex-error.test.ts parses this union out
// of this file and asserts every member appears in that chain.
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
// INVALID_MESSAGE is thrown in lib/chat.ts, by requireBody. RATE_LIMITED is
// thrown in chat.ts, by sendMessageFor — lib/chat.ts's nextPostWindow only
// RETURNS null to report a refusal; the caller decides what to throw.
// SCROLL_RATE_LIMITED is chat.ts's olderMessagesFor doing the same with
// nextScrollWindow — a DISTINCT code from RATE_LIMITED, not a reuse, because
// RATE_LIMITED's copy ("You are sending messages very quickly") names the
// wrong action for a refused scroll.
// AVATAR_RATE_LIMITED is thrown in players.ts, by generateAvatarUploadUrl, when
// lib/avatar.ts's nextAvatarUploadWindow reports a refusal — same division of
// labour as RATE_LIMITED above, where the pure function only returns null and
// the caller decides what to throw. A DISTINCT code rather than a reuse of
// RATE_LIMITED for the same reason SCROLL_RATE_LIMITED is one: that code's copy
// names sending messages, which is the wrong action entirely here.
// INVITE_LINK_INVALID is thrown in inviteLinks.ts, by revokeLinkFor, for a
// token no live row matches. It is DELIBERATELY the single answer for every
// way a token can fail — unknown, expired, revoked — so the refusal a holder
// sees never tells them which, and so a probe cannot use the distinction to
// enumerate live tokens. Its copy is written for someone a friend handed a
// link to, who has done nothing wrong.
// TEAM_LIMIT_REACHED is thrown in inviteLinks.ts, by consumeLinkFor, when a
// non-pro joiner following a link is already on FREE_TEAM_LIMIT teams. It is
// NOT folded into INVITE_LINK_INVALID: the link is fine and the holder is
// legitimate, and unlike the three dead-link states there IS something they can
// do about it. It is also a code the email path has no use for — that path
// never refuses, it PARKS the address in teams.invited and lets billing.ts's
// upgradeTeamInvitesFor release it later. A link cannot park, so refusing is a
// new outcome and gets a new code rather than a reused one.
// MONTH_OUT_OF_WINDOW is thrown in scores.ts, by getTeamMonthFor, when the
// requested month falls below what the caller's tier reaches — or is not a
// 'YYYY-MM' at all, which is the same refusal because a bare '2026' lexically
// brackets a whole year of boards. THE SAME CODE FOR BOTH ON PURPOSE, so the
// message a caller reads does not name which rule stopped them — the reason
// INVITE_LINK_INVALID collapses its three states. NOT a claim that the two are
// indistinguishable, and do not write one: a shape refusal returns before
// isProFor and reads ZERO documents, while a tier refusal reads the caller's
// playerMembership row and may walk the roster. That is a latency difference and,
// more reliably, a READ-SET difference — a shape-refused subscription can never
// be invalidated by a membership change, and a tier-refused one can. Collapsing
// the copy is worth doing; pretending the two paths are identical is not. It is
// also a BACKSTOP rather than a conversion surface — the dropdown never offers a
// month outside the window — so unlike TEAM_LIMIT_REACHED its copy does not
// carry the upgrade flow.
// INVALID_AVATAR is thrown in players.ts, by setAvatarFor, when an uploaded
// file fails the server-side type or size check — the same function deletes
// the file before throwing, so a rejection never leaves an orphan in storage.
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
  | 'SCROLL_RATE_LIMITED'
  | 'INVITE_LINK_INVALID'
  | 'TEAM_LIMIT_REACHED'
  | 'MONTH_OUT_OF_WINDOW'
  | 'INVALID_AVATAR'
  | 'AVATAR_RATE_LIMITED'

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
 * THE FOURTH GATE wordle-teams-6tn NAMES — the month window — IS NOW ENFORCED,
 * and this function is what enforces it. scores.ts's getTeamMonthFor refuses any
 * month below the free floor unless `isProFor` says yes (wordle-teams-kusd's task
 * 3). This paragraph used to say the gate did not exist and there was nothing to
 * enforce until the pro expansion was built; that stopped being true the moment
 * the gate landed, and it is listed with the three above rather than apart from
 * them now.
 *
 * THE CLIENT HALF LANDED WITH IT (wordle-teams-kusd tasks 5 and 6), and the
 * paragraph that used to sit here — "monthOptions still offers everyone the same
 * three months … the gate is strictly a backstop that no UI can trip" — is false
 * on both counts now. routes/app.tsx queries the team's earliest board and builds
 * the dropdown from the same monthWindow.ts rule this gate uses, so a pro player
 * is shown the history they pay for; and the UI CAN reach this gate, in the frame
 * between an out-of-window `?month=` arriving and the after-commit correction
 * moving it (src/lib/dashboard-months.ts), plus the open team-switch race on
 * wordle-teams-alr7.
 *
 * EVERY PATH THAT TAKES A CALLER-SUPPLIED MONTH HAS NOW BEEN AUDITED
 * (wordle-teams-kusd's task 4), AND THEY DO NOT ALL END IN THIS FUNCTION. The
 * sweep — `grep "month: v.string()" convex/*.ts` — found six. FOUR ARE PUBLIC AND
 * TEAM-SCOPED, and exactly TWO OF THOSE FOUR call this function; the other two
 * have their own reasons. A fifth is listed with them only so the sweep is
 * reproducible from this comment rather than re-derived, and the sixth is not
 * team-scoped and is described after the list. An earlier version of this
 * paragraph described two of them as "check membership alone", which was false of
 * the first, and that error reached a beads issue — which is why they are spelled
 * out at length here rather than summarised.
 *
 * - scores.ts's `getTeamMonth` — the surface this function exists for. Shape
 *   check, free floor, then `isProFor`, then a roster walk. See getTeamMonthFor.
 *
 * - winners.ts's `getLastMonthWinner` — GATED SINCE TASK 4, and it calls this
 *   function. It was the genuinely ungated sibling: membership and nothing else,
 *   so any member could name the winner of any month the team ever played. One
 *   name and a boolean per call, but walking the months yields the team's whole
 *   hall of fame, which is the history Pro sells. Gating it took nothing from any
 *   tier — the celebration dialog only ever asks for last month. It has NO PRO
 *   FLOOR, deliberately, and for the PRODUCT reason rather than the cost one: a
 *   Pro caller asking who won an old month is asking for what they paid for. Cost
 *   only settles the shape (a point lookup versus a roster walk), and the
 *   divergence that buys — this serves months beyond the scoreboard's MAX_MONTHS
 *   cap — is named in `lastMonthWinnerFor`'s own gate comment rather than assumed
 *   away. wordle-teams-7uv8 is the issue.
 *
 * - winners.ts's `markCelebrationSeen` — NOT GATED, and it needs none. It returns
 *   void with both of its early returns silent successes, so it discloses nothing
 *   at all, not even whether a winner row for that month exists; it writes only
 *   the caller's own id; and requireTeamMemberFor already runs before the patch.
 *   Its own doc comment lists the four conditions that would change that answer.
 *
 * - teamStats.ts's `rollupOne` — THE FIFTH, AND IT IS NOT PUBLIC: an
 *   `internalMutation` scheduled by `sweep`. Nothing a browser holds can call it,
 *   so there is no caller to gate. It is in this list to be crossed off, not
 *   counted among the four above.
 *
 * - insights.ts's `teamMonth` — gated, by LAYER rather than by month:
 *   `hasFullTeamMonth(access.layer3)`. layer3 is `paid ? 'full' : 'free'` and
 *   `paid = isPro || trialActive` (lib/insightsAccess.ts's `insightsAccess`),
 *   so a FREE member gets the reduced teaser for every month, current or ancient.
 *   There is no free leak of `stats` here. What reaches an out-of-window month is
 *   the TRIAL tier: `trialActive` makes layer3 'full' while THIS function still
 *   returns false, so a trial player gets their team's full stats for any month on
 *   /insights and three months of scoreboard on /app.
 *
 *   THAT SEAM IS DELIBERATE AND ALREADY ACCEPTED — do not "fix" it here. The
 *   spec's §4 ("The trial does not widen this window",
 *   docs/superpowers/specs/2026-09-17-pro-month-window-design.md) states the
 *   split in those words and takes it knowingly: the trial was specified as an
 *   Insights grant rather than a scoreboard grant, and honouring it here would
 *   make this rule take an InsightsAccess tier instead of a boolean and let the
 *   trial's expiry silently withdraw history. scores.test.ts's "refuses a caller
 *   inside the Insights trial the pro window" pins the /app half on purpose.
 *
 *   ONE FIELD THERE IS STILL MONTH-UNBOUNDED FOR A FREE CALLER — the `rank`
 *   teaser, computed from the requested month's aggregate. Not UI-reachable (that
 *   component's free branch asks only for the current month) and narrow, but it
 *   is a decision rather than a non-finding: wordle-teams-g03s.
 *
 * THE SIXTH IS NOT TEAM-SCOPED, WHICH IS WHY IT IS NOT IN THE LIST: scores.ts's
 * `getMyMonth`, which serves `currentPlayer`'s OWN boards for any month with no
 * shape check and no floor. Task 4 re-examined it and left it ungated; its doc
 * comment carries the argument, including the one thing that argument does not
 * settle (insights.ts's `myBenchmarkBoards` already rations a player's own
 * history by layer, so "your own data is free" is not this repo's rule —
 * wordle-teams-byft).
 *
 * Do not read this function's presence in getTeamMonthFor as evidence the whole
 * family is covered, and do not read the family as uniformly leaky either.
 */
export async function isProFor(ctx: ReaderCtx, playerId: Id<'players'>): Promise<boolean> {
  const membership = await ctx.db
    .query('playerMembership')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .first()
  return membership?.membershipStatus === 'pro'
}

/**
 * Which insight layers this player may see, right now.
 *
 * THE WRAPPER ONLY SUPPLIES INPUTS. Every rule — what the trial grants, when it
 * expires, what a free player still gets — lives in lib/insightsAccess.ts, which
 * imports nothing and is therefore both testable without a session
 * (wordle-teams-obw) and safe for the browser to import. This function reads two
 * facts and hands them over.
 *
 * A MISSING PLAYER IS NOT AN ERROR HERE. Insights is a read surface; a caller
 * that cannot resolve a player should render the free view, not throw. The
 * callers that must refuse already do so through requirePlayer before reaching
 * this.
 */
export async function insightsAccessFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
): Promise<InsightsAccess> {
  const [isPro, player] = await Promise.all([isProFor(ctx, playerId), ctx.db.get(playerId)])
  return insightsAccess({
    isPro,
    trialEndsAt: player?.insightsTrialEndsAt,
    now: Date.now(),
  })
}
