import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { authComponent } from './auth'
import { accessError, currentPlayer, isProFor, playerForEmail, requirePlayer } from './access'
import { resetChatCursorFor } from './chat.ts'
import { MAX_AVATAR_BYTES, isAllowedAvatarType, shouldSyncSocialImage } from './lib/avatar.ts'
import { isCompleteName } from './lib/invite.ts'
import { isPlausibleToday, toPuzzleDay } from './lib/puzzleDay.ts'
import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'
import { monthsWithWinners, recomputeTeamMonths } from './winners.ts'
import type { Id, DataModel } from './_generated/dataModel'
import type { GenericDatabaseWriter, StorageWriter } from 'convex/server'
import type { WriterCtx } from './winners.ts'
import type { PuzzleDay } from './lib/puzzleDay.ts'

/**
 * Onboarding. Phase 4 (wt-ksh.5.14).
 *
 * THIS MODULE IS THE ONLY PLACE A REAL PERSON'S PLAYER ROW IS BORN. The table's
 * only other writers are the Supabase copy (migrate.ts) and e2eSeed.ts, which is
 * gated on E2E_TEST_MODE and an e2e+* address. Before Phase 4 there was no third
 * writer at all: players.legacyId was a required Supabase auth uuid, so the
 * schema itself forbade creating a person natively, and BOTH cold signup and the
 * invite flow dead-ended (wt-ksh.5.1).
 *
 * A `players` ROW IS BORN ONLY WHEN SOMEONE SUBMITS THEIR NAME. That is
 * narrower than v1, which created a nameless row from a Postgres trigger
 * (handle_new_user) at signup and collected the name at /complete-profile
 * afterwards — leaving 151 of production's 533 players permanently nameless.
 * The alternatives considered and rejected are in the Phase 4 design: porting
 * the trigger via Better Auth's user.onCreate reproduces the nameless state
 * natively, and an `ensurePlayer` on first dashboard load is a write on a read
 * path. The consequence worth naming: the row and the validated name appear in
 * the SAME write, so there is never a moment where one exists without the other,
 * and needsProfile can be a pure row-existence check rather than a name check.
 *
 * NOT BUILT ON requirePlayer, unlike the team, board and scoring mutations.
 * requirePlayer throws NO_PLAYER when the address resolves to nothing, and that
 * is the exact state this mutation exists to leave: there is no player yet, and
 * creating one is the point.
 */

/**
 * v1's Postgres column defaults for a new player, which handle_new_user relied
 * on rather than setting — see 20240712143705_reminder_time_and_time_zone.sql,
 * which declares has_pwa DEFAULT false, reminder_delivery_methods DEFAULT
 * ARRAY['email'] and reminder_delivery_time DEFAULT '10:00:00'. Convex has no
 * column defaults, so an insert that omits them fails schema validation.
 *
 * A FUNCTION, not a frozen const like lib/scoringSystem.ts's DEFAULT_SYSTEM.
 * That one is all numbers, so `as const` costs nothing; here `as const` would
 * type reminderDeliveryMethods as `readonly ['email']`, which is not assignable
 * to the schema's `v.array(v.string())`. Returning a fresh object also means no
 * single array literal is shared across every insert this module ever makes.
 *
 * handle_new_user ALSO inserted a player_customer row with status 'new'. There
 * is deliberately no equivalent here, and the reason is NOT that the schema
 * forbids one — Phase 5 widened playerMembership.legacyId to optional, so a
 * native membership row is writable now. It is that isProFor (access.ts) already
 * reads a MISSING membership row as not-pro, which is exactly what 'new' meant,
 * so a row that says "nothing yet" would buy nothing.
 */
const newPlayerDefaults = () => ({
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '10:00:00',
})

/**
 * Bring a player into existence under `email` with the submitted name, claim the
 * invites waiting for that address that the free-tier cap allows, and repair the
 * winner rows the claim just invalidated.
 *
 * NOT "EVERY INVITE", AND THAT WORDING WAS TRUE UNTIL PHASE 5. A non-pro player
 * claims at most FREE_TEAM_LIMIT of them; the rest stay parked until they
 * upgrade. See the cap at the loop.
 *
 * VALIDATION AND NORMALISATION LIVE HERE, NOT IN THE MUTATION, matching
 * updateTeamFor and removeMemberFor in teams.ts — the exported Convex function
 * resolves the caller's identity and nothing else, and the `...For` helper owns
 * the rules. That is not only consistency: no test in this repo can drive a
 * `mutation` wrapper, because doing so needs a real Better Auth session in the
 * harness — that is exactly why access.ts's module comment gives
 * requireTeamMemberFor an explicit-playerId shape. Rules stated in the wrapper
 * would be rules nothing could prove: every mutant planted in the two wrappers
 * below survives the suite, and moving these four rules in here turned four such
 * mutants into killed ones.
 *
 * isCompleteName IS LOAD-BEARING, and is the whole reason a blank name cannot
 * reach the database. players.firstName/lastName are required as of Phase 4, so
 * a name can never be ABSENT — but `v.string()` accepts `''` and Convex has no
 * minLength, so the schema cannot express non-empty. A blank-named player would
 * appear on the scoreboard and the team card, and would enter the winner
 * computation, where it can actually win a month; scores-table.tsx renders
 * `lastName[0]`, which is `undefined` for `''`. This check, and the copy
 * script's isNamed, are the two things holding that line.
 *
 * THE OUTER .trim() IS NOT REDUNDANT WITH isCompleteName'S INTERNAL ONE. That
 * one trims to JUDGE raw, untrimmed client state — lib/invite.ts's doc explains
 * why its other intended consumer, a form's canSubmit predicate, has to count
 * ' Ada ' as complete rather than rejecting it. This one decides what gets
 * STORED. isCompleteName returns a verdict, never a value, so deleting these two
 * calls stores ' Ada ' and no test in lib/invite.test.ts would notice, because
 * that function behaves identically either way.
 *
 * THE ORDER OF THE THREE STEPS IS FORCED. The player must exist before invites
 * are claimed, because claiming writes their id into team.playerIds. The claim
 * must precede the recompute, because the recompute's answer is a function of
 * the roster the claim just changed — run first, it would recompute the team
 * the joiner is not on yet and write back the same stale winner.
 */
export async function completeProfileFor(
  ctx: WriterCtx,
  rawEmail: string,
  names: { firstName: string; lastName: string },
  rawToday: PuzzleDay,
): Promise<Id<'players'>> {
  // Normalised HERE rather than at the call site so the module has one rule
  // instead of a precondition. players.email is always lowercase (schema), and
  // the invite scan below compares against this value — so it has to be reduced
  // by exactly the same rule lib/invite.ts's normaliseInviteEmail applies on the
  // write side, trim() included, or the two sides can disagree.
  const email = rawEmail.trim().toLowerCase()

  // ONBOARDING IS NOT A NORMAL SURFACE, which is why this does NOT call
  // access.ts's requirePlausibleToday like every other mutation that feeds a
  // client `today` into winner recomputation. That helper THROWS. Everywhere
  // else it blocks one ACTION and the user retries; here it would block the
  // player ROW itself — and every route guard bounces a playerless account back
  // to /complete-profile, so the bound would lock a wrong-clocked device out of
  // the whole product, at the single worst moment: signup is already the
  // largest measured leak here (wordle-teams-456 — 87% of production signups
  // never enter a board). Owner's decision, Task 6 Step 3b.
  //
  // Lenient is not unbounded. The recompute below writes a monthlyWinners row
  // the whole team reads, so an implausible date must not reach it; it falls
  // back to the server's own date instead of being trusted OR refused. Same
  // predicate access.ts uses, imported from lib/puzzleDay.ts, so the strict and
  // lenient call sites cannot drift apart on what "plausible" means.
  //
  // ONE clock read, reused for both the test and the fallback: two `new Date()`
  // calls either side of midnight could judge `rawToday` against one day and
  // then fall back to the next.
  const serverToday = toPuzzleDay(new Date())
  const today = isPlausibleToday(rawToday, serverToday) ? rawToday : serverToday

  const firstName = names.firstName.trim()
  const lastName = names.lastName.trim()
  if (!isCompleteName(firstName, lastName)) throw accessError('INVALID_NAME')

  // A COPIED PLAYER MAY ALREADY EXIST at this address — that is the ordinary
  // case for everyone who used v1 — so this patches rather than inserting a
  // second row under the same email. It also makes a resubmit idempotent: two
  // tabs, or a double-tapped submit button, cannot mint a duplicate. The patch
  // touches only the names, so a copied row keeps its legacyId, timeZone,
  // reminder settings and createdAt.
  const existing = await playerForEmail(ctx, email)
  let playerId: Id<'players'>
  if (existing) {
    await ctx.db.patch(existing._id, { firstName, lastName })
    playerId = existing._id
  } else {
    playerId = await ctx.db.insert('players', {
      // NO legacyId. Absence is meaningful and is what Phase 7's reconciliation
      // against Supabase reads as "born in v2, not copied" — see the schema.
      email,
      firstName,
      lastName,
      ...newPlayerDefaults(),
      createdAt: Date.now(),
    })
  }

  // Collect-and-filter, because Convex cannot index array membership — the same
  // constraint teams.ts's getMyTeamsFor and winners.ts's recomputePlayerMonth
  // pay, and for the same reason. Cheapest of the three to accept: this is an
  // onboarding submit, not a read path or the board-entry write path.
  const allTeams = await ctx.db.query('teams').collect()
  const claimed = []

  // THE NON-PRO TEAM CAP AT SIGNUP — the second half of the same rule
  // teams.ts's invitePlayerFor enforces, ported from v1's OTHER capping RPC,
  // handle_invited_signup (20240426201800). Without it the cap has a hole the
  // size of the whole invite flow: invitePlayerFor parks an address with no
  // account WITHOUT capping — there is no player yet to count teams for — so
  // being invited to five teams before signing up and then joining all five is
  // exactly the state v1 refuses and v2 used to allow.
  //
  // v1's rule is `IF NOT pro AND (pending invites) > 2 THEN claim 2 ELSE claim
  // all`. Those two branches collapse: claiming at most FREE_TEAM_LIMIT is the
  // same function, and it removes the `>` / `>=` boundary this transliterates
  // badly at. What is NOT a transliteration is counting teams the player is
  // ALREADY on. v1 counts only pending invites, because handle_invited_signup
  // fires at signup, when a v1 account is always on zero teams. v2's
  // completeProfileFor is also reachable for a row that already exists — a
  // double-submitted form is enough — and on the second pass v1's formula would
  // see the leftover parked invite, count 1, decide 1 <= 2 and hand out a THIRD
  // team. Counting memberships is what makes it idempotent, and it is not
  // stricter than v1 in any state v1 could reach.
  //
  // A TEAM THEY ARE ALREADY ON COSTS NO SLOT (see the loop). Clearing a stale
  // address off a team they are already a member of is not joining anything —
  // billing.ts's pendingInviteCountFor draws the same line for the same reason.
  //
  // WHICH invites lose is left to table order, i.e. oldest team first. v1's
  // `LIMIT 2` has no ORDER BY at all, so its answer is whatever the planner
  // returns; any deterministic choice is at least as good, and the invites that
  // lose are not lost — they stay parked, and upgrading releases them.
  const isPro = await isProFor(ctx, playerId)
  let freeSlots = FREE_TEAM_LIMIT - allTeams.filter((t) => t.playerIds.includes(playerId)).length

  for (const team of allTeams) {
    // NORMALISED ON READ, MIRRORING normaliseInviteEmail'S trim().toLowerCase()
    // ON WRITE. This is the read half of amendment A2, and it is DEFENCE IN
    // DEPTH, not a claim that abnormal rows exist: every write path already
    // lowercases — the copy at scripts/copy-from-supabase.mjs and again at
    // migrate.ts, "the last gate before the data lands" — and all 44 pending
    // invites in production were measured lowercase. schema.ts says the table
    // cannot hold a mixed-case invite, and that is true today.
    //
    // It stays because the cost of being wrong is asymmetric and silent. A
    // stored value this fails to match is not an error anybody sees: the invite
    // simply sits there and the person never joins, which is exactly the v1 bug
    // A2 exists to kill. One future writer that forgets to normalise reintroduces
    // it. Do not delete this on the grounds that the data is currently clean.
    //
    // `email` is trimmed and lowercased by construction above.
    if (!team.invited.some((entry) => entry.trim().toLowerCase() === email)) continue

    // The cap, applied. `continue` LEAVES THE ADDRESS PARKED rather than
    // dropping it, which is the whole point: upgrading runs
    // upgradeTeamInvitesFor over exactly these entries and lets the player in.
    const alreadyMember = team.playerIds.includes(playerId)
    if (!isPro && !alreadyMember) {
      if (freeSlots <= 0) continue
      freeSlots -= 1
    }

    // wordle-teams-0yhm. THE THIRD ADD PATH, and it was missed when the other
    // two were wired (teams.ts's invitePlayerFor and billing.ts's
    // upgradeTeamInvitesFor). A previous stint on this team leaves a
    // `chatReads` row behind — removal never cleans one up, deliberately — and
    // it says they have read everything up to the day they left. Rejoining on
    // top of it means no unread badge for anything said while they were gone.
    //
    // NOT UNREACHABLE, WHICH IS WHY IT IS HERE RATHER THAN ARGUED AWAY. The
    // common case for this function is somebody with no player row at all, who
    // by definition has no cursor to be stale — but this branch is reached for
    // an EXISTING row too (see the idempotence note above: a double-submitted
    // form is enough, and every copied v1 player has had a row since the
    // migration), and the mutation below guards only on the caller's email,
    // never on the absence of a player. Nothing structural keeps a stale
    // cursor out.
    //
    // ONLY ON THE BRANCH THAT ACTUALLY JOINS THEM, exactly as
    // upgradeTeamInvitesFor draws the same line: when `alreadyMember`, this
    // pass is only clearing a stale address off a roster they are already on,
    // and wiping a CURRENT member's cursor would mark a conversation they have
    // been reading all along unread.
    //
    // BEFORE the patch, so no window exists in which they are on the roster
    // holding a stale cursor. See resetChatCursorFor in chat.ts for why this is
    // done on add rather than on the three separate removal paths.
    if (!alreadyMember) await resetChatCursorFor(ctx, playerId, team._id)

    await ctx.db.patch(team._id, {
      invited: team.invited.filter((entry) => entry.trim().toLowerCase() !== email),
      // A COPIED TEAM CAN LIST BOTH — the address in `invited` AND the player in
      // `playerIds` — because v1 never removed an invite it could not match.
      // Appending unconditionally would put the same id in the roster twice,
      // which shows the person twice on the team card and enters them twice in
      // recomputeTeamMonth's candidate list for the month.
      playerIds: alreadyMember ? team.playerIds : [...team.playerIds, playerId],
    })
    // Re-read: recomputeTeamMonth reads playerIds off the doc it is handed, and
    // `team` is the pre-patch snapshot.
    claimed.push((await ctx.db.get(team._id))!)
  }

  // wt-ksh.5.2. THE JOINER IS NOW ELIGIBLE FOR EVERY MONTH THESE TEAMS ALREADY
  // HAVE A WINNER ROW FOR, and without this each one stays wrong forever: v1's
  // update_monthly_winners is a trigger on daily_scores, so a membership change
  // never fires it, and in v2 only a board entry recomputes anything, and only
  // for the month it is dated in (upsertBoardFor passes monthOf(puzzleDay), not
  // the current month). A copied player claiming an invite brings their whole
  // history with them, so the months at stake are not hypothetical — and NOT
  // reachable later by the joiner entering a board, since that would only ever
  // fix the one month they backdated it to.
  //
  // monthsWithWinners does not solve this on its own — it returns the months
  // that already HAVE a row, and the joiner was excluded from every computation
  // that produced them. It is the bound on the work, not the fix.
  //
  // WHAT THAT BOUND LEAVES OUT, deliberately: a month the team has NO winner row
  // for is not created here, even when the joiner's boards would have won it. So
  // a joiner who played that month on some other team does not retroactively win
  // it on this one. Phase 3's removeMember and setScoringSystem carry the
  // identical bound, and nothing in src/ reads monthlyWinners today, so widening
  // it is a product decision rather than a bug fix.
  for (const team of claimed) {
    await recomputeTeamMonths(ctx, team, await monthsWithWinners(ctx, team._id), today)
  }

  return playerId
}

/**
 * Create the caller's player row from a submitted name.
 *
 * `today` is client-supplied and bounded server-side inside the helper, for the
 * reason every other mutation that feeds one into winner recomputation bounds
 * it: the value decides which missed days are already due for every member of a
 * claimed team and is written into a monthlyWinners row the whole team reads.
 * THE BOUND HERE IS THE LENIENT ONE — an implausible date falls back to the
 * server's own rather than throwing INVALID_DATE, because this is the mutation
 * that creates the account. See the reasoning at the fallback itself.
 */
export const completeProfile = mutation({
  args: { firstName: v.string(), lastName: v.string(), today: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx)
    // Not requirePlayer: there is no player yet — see the module comment.
    if (!user?.email) throw accessError('UNAUTHENTICATED')
    return await completeProfileFor(
      ctx,
      user.email,
      { firstName: args.firstName, lastName: args.lastName },
      args.today,
    )
  },
})

/**
 * Whether the caller still has to complete their profile. Defined here so the
 * rule lives beside the mutation that clears it.
 *
 * TWO CONSUMERS, both route guards, and they are mirror images: src/routes/
 * app.tsx's beforeLoad sends a caller with no player TO /complete-profile,
 * and src/routes/complete-profile.tsx's sends a caller who has one AWAY to the
 * dashboard. Inverting this predicate therefore breaks onboarding in one of two
 * ways — an endless redirect back to the form, or a form nobody who needs it
 * ever reaches — and no unit test can see it, because convex-test cannot stand
 * up a Better Auth session and this wrapper's body never runs there
 * (wordle-teams-obw). e2e/complete-profile.spec.ts drives both directions.
 *
 * A ROW-EXISTENCE CHECK THAT NEVER READS A NAME BACK. completeProfileFor above
 * rejects an empty pair BEFORE it inserts and always leaves a row behind, so a
 * successful submit flips this predicate unconditionally — a guard built on it
 * cannot bounce someone who just succeeded.
 *
 * That is strictly stronger than fetching the player and calling isCompleteName.
 * Nothing puts a name on the wire, and — the part that actually matters — there
 * is only ONE opinion about what a good name is, so the save rule and the
 * guard's rule cannot disagree. v1 had two: it saved any non-empty name but
 * guarded its redirect on `length > 1`, so a one-character name saved and then
 * redirected forever. Do not "improve" this into the weaker version;
 * lib/invite.ts's doc comment argues the same point from its side.
 *
 * FALSE WHEN UNAUTHENTICATED, deliberately. A signed-out visitor is /login's
 * business; returning true would send them toward onboarding with no account to
 * attach a profile to.
 */
export const needsProfile = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx)
    if (!user?.email) return false
    // playerForEmail lowercases for itself.
    return (await playerForEmail(ctx, user.email)) === null
  },
})

/**
 * The caller's own name, for the settings menu's avatar initials and label
 * (Phase 6, Task 6).
 *
 * DELIBERATELY JUST THESE TWO FIELDS. getMyPlayerId (scores.ts) already gives
 * the id and amIPro (teams.ts) the plan; myData (me.ts) has both names too,
 * but it is a Phase-1 diagnostic that collects every team and score the
 * caller has ever recorded — the wrong query to run on every authenticated
 * page load just to paint two letters in the corner of the header.
 *
 * currentPlayer, NOT requirePlayer: the header this feeds mounts globally,
 * including on /complete-profile, where a signed-in session with no player
 * row yet is the expected state, not an error. requirePlayer would throw
 * NO_PLAYER there; this just returns null, and the menu falls back to the
 * Better Auth user's email (user-menu.tsx).
 */
export const myName = query({
  args: {},
  handler: async (ctx) => {
    const player = await currentPlayer(ctx)
    if (!player) return null
    return { firstName: player.firstName, lastName: player.lastName }
  },
})

/**
 * Applies the mirror decision to one player row. Exported for its tests: the
 * mutation below reads the Better Auth user, which convex-test cannot stand up
 * (wordle-teams-bya), so the wrapper's body is unreachable there and everything
 * worth asserting has to live in a function that is not the wrapper.
 */
export async function applySocialImageSync(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  incoming: string | null | undefined,
) {
  const player = await ctx.db.get(playerId)
  if (!player) return
  const decision = shouldSyncSocialImage(player.socialImage, incoming)
  if (decision.action === 'none') return
  await ctx.db.patch(playerId, {
    socialImage: decision.action === 'clear' ? undefined : decision.value,
  })
}

/**
 * Mirrors the caller's OWN Better Auth profile image onto their player row.
 *
 * TAKES NO ARGUMENTS, AND THAT IS THE SECURITY PROPERTY RATHER THAN A STYLE
 * CHOICE. The value comes from the authenticated user server-side. A
 * client-supplied URL here would let anybody point their teammate-visible
 * avatar at any URL on the internet.
 *
 * ONLY EVER YOUR OWN. Another player's Better Auth record is reachable only
 * from their own session, so a teammate's Google photo appears in chat when
 * THEY next open the app, not when you do. Chat therefore fills in with faces
 * over the days after launch rather than all at once. Accepted, not overlooked.
 *
 * SILENT ON FAILURE at the call site: this is a convenience, and a failed sync
 * costs initials until the next load.
 *
 * READS THE AUTH USER EXACTLY ONCE. This runs on EVERY app load, so the two
 * auth-component round trips the previous shape made — one indirectly via
 * currentPlayer, one directly for `user.image` — cost double what one buys.
 * Resolving the player from the SAME user object via playerForEmail, rather
 * than through currentPlayer, is what removes the second round trip; it is not
 * a change to who this can act on, since currentPlayer itself is defined as
 * exactly this same authComponent.getAuthUser -> playerForEmail lookup.
 */
export const syncSocialImage = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx)
    if (!user?.email) return
    // playerForEmail lowercases for itself.
    const player = await playerForEmail(ctx, user.email)
    if (!player) return
    await applySocialImageSync(ctx, player._id, user.image ?? null)
  },
})

/**
 * `storage` JOINED `db` HERE FOR THE AVATAR UPLOAD PATH, mirroring teams.ts's
 * own ReaderCtx (added there for the identical reason, on the read side).
 * WriterCtx (winners.ts) is `{ db }` only, and setAvatarFor/removeAvatarFor
 * both need to delete files, so a plain WriterCtx cannot satisfy them.
 *
 * LOCAL TO THIS MODULE RATHER THAN WIDENING THE SHARED WriterCtx EXPORT.
 * WriterCtx is imported by chat.ts, teams.ts, billing.ts, inviteLinks.ts,
 * scoringSystems.ts and chatNotify.ts, none of which touch storage — adding
 * `storage` to the shared type would claim a capability every one of those
 * call sites does not use and does not need satisfied. Every real mutation
 * ctx, and convex-test's `t.run` callback ctx, structurally satisfy this with
 * no cast, the same property WriterCtx's own doc comment relies on.
 */
type AvatarCtx = { db: GenericDatabaseWriter<DataModel>; storage: StorageWriter }

/**
 * Attaches an uploaded file to a player as their avatar.
 *
 * VALIDATES SERVER-SIDE, WHICH IS THE POINT OF THIS FUNCTION. The client
 * resizes to a 256px WebP before it uploads, but `generateAvatarUploadUrl`
 * hands out a URL that accepts whatever is POSTed to it — so the resize is a
 * courtesy to the player's connection, not a constraint on what lands in
 * storage. Without the two checks below, one broken client puts a 12MP original
 * in the bucket and on every teammate's wire.
 *
 * REJECTION DELETES THE FILE. A refused upload that stayed in storage would be
 * an orphan nothing references and nothing will ever clean up — and a free way
 * for anybody with an account to fill the bucket.
 *
 * `ctx.db.system.get('_storage', id)` rather than `ctx.storage.getMetadata`,
 * which is deprecated in convex@1.42.
 */
export async function setAvatarFor(ctx: AvatarCtx, playerId: Id<'players'>, storageId: Id<'_storage'>) {
  const metadata = await ctx.db.system.get('_storage', storageId)
  if (!metadata || !isAllowedAvatarType(metadata.contentType) || metadata.size > MAX_AVATAR_BYTES) {
    await ctx.storage.delete(storageId)
    throw accessError('INVALID_AVATAR')
  }

  const player = await ctx.db.get(playerId)
  if (!player) throw accessError('NO_PLAYER')

  await ctx.db.patch(playerId, { imageId: storageId })
  // AFTER the patch, so a failure here cannot leave the row pointing at a file
  // that no longer exists.
  if (player.imageId) await ctx.storage.delete(player.imageId)
}

/**
 * Drops the uploaded avatar. `socialImage` is deliberately untouched, so
 * removing an upload reveals the provider's image again rather than falling all
 * the way to initials — which is what "remove" means to someone who never chose
 * the social one in the first place.
 */
export async function removeAvatarFor(ctx: AvatarCtx, playerId: Id<'players'>) {
  const player = await ctx.db.get(playerId)
  if (!player?.imageId) return
  await ctx.db.patch(playerId, { imageId: undefined })
  await ctx.storage.delete(player.imageId)
}

/**
 * A one-shot URL the client POSTs the resized blob to. Authenticated, so an
 * anonymous visitor cannot obtain one and use this deployment's storage.
 */
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requirePlayer(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const setAvatar = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    const player = await requirePlayer(ctx)
    await setAvatarFor(ctx, player._id, args.storageId)
  },
})

export const removeAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    await removeAvatarFor(ctx, player._id)
  },
})
