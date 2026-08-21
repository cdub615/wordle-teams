import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { authComponent } from './auth'
import { accessError, playerForEmail, requirePlausibleToday } from './access'
import { isCompleteName } from './lib/invite.ts'
import { monthsWithWinners, recomputeTeamMonths } from './winners.ts'
import type { Id } from './_generated/dataModel'
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
 * is deliberately no equivalent here: playerMembership.legacyId is a required
 * string with no native source, and isProFor (access.ts) already reads a missing
 * membership row as not-pro, which is what 'new' meant.
 */
const newPlayerDefaults = () => ({
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '10:00:00',
})

/**
 * Bring a player into existence under `email` with the submitted name, claim
 * every invite waiting for that address, and repair the winner rows the claim
 * just invalidated.
 *
 * VALIDATION AND NORMALISATION LIVE HERE, NOT IN THE MUTATION, matching
 * updateTeamFor and removeMemberFor in teams.ts — the exported Convex function
 * resolves the caller's identity and nothing else, and the `...For` helper owns
 * the rules. That is not only consistency: no test in this repo can drive a
 * `mutation` wrapper, because doing so needs a real Better Auth session in the
 * harness — that is exactly why access.ts's module comment gives
 * requireTeamMemberFor an explicit-playerId shape. Rules stated in the wrapper
 * would be rules nothing could prove: a mutant planted in either wrapper below
 * survives the suite, and one planted in here does not.
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
  // Lowercased HERE rather than at the call site so the module has one rule
  // instead of a precondition. players.email is always lowercase (schema), and
  // the invite scan below compares against this value.
  const email = rawEmail.toLowerCase()
  const today = requirePlausibleToday(rawToday)
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

  for (const team of allTeams) {
    // CASE-INSENSITIVE ON READ even though `invited` is lowercase on write.
    // This is the read half of amendment A2. Teams copied out of v1 predate v1's
    // own case fix and can hold an address exactly as it was typed, so a stored
    // value cannot be assumed normal — matching it case-sensitively is precisely
    // the v1 bug where anyone invited at a mixed-case address silently never
    // joined their team. `email` is lowercase by construction above.
    if (!team.invited.some((entry) => entry.toLowerCase() === email)) continue

    await ctx.db.patch(team._id, {
      invited: team.invited.filter((entry) => entry.toLowerCase() !== email),
      // A COPIED TEAM CAN LIST BOTH — the address in `invited` AND the player in
      // `playerIds` — because v1 never removed an invite it could not match.
      // Appending unconditionally would put the same id in the roster twice,
      // which shows the person twice on the team card and enters them twice in
      // recomputeTeamMonth's candidate list for the month.
      playerIds: team.playerIds.includes(playerId)
        ? team.playerIds
        : [...team.playerIds, playerId],
    })
    // Re-read: recomputeTeamMonth reads playerIds off the doc it is handed, and
    // `team` is the pre-patch snapshot.
    claimed.push((await ctx.db.get(team._id))!)
  }

  // wt-ksh.5.2. THE JOINER IS NOW ELIGIBLE FOR EVERY MONTH THESE TEAMS ALREADY
  // HAVE A WINNER ROW FOR, and without this each one stays wrong forever: v1's
  // update_monthly_winners is a trigger on daily_scores, so a membership change
  // never fires it, and in v2 only a board entry in the CURRENT month would
  // recompute anything. A copied player claiming an invite brings their whole
  // history with them, so the months at stake are not hypothetical.
  //
  // monthsWithWinners does not solve this on its own — it returns the months
  // that already HAVE a row, and the joiner was excluded from every computation
  // that produced them. It is the bound on the work, not the fix.
  for (const team of claimed) {
    await recomputeTeamMonths(ctx, team, await monthsWithWinners(ctx, team._id), today)
  }

  return playerId
}

/**
 * Create the caller's player row from a submitted name.
 *
 * `today` is client-supplied and bounded server-side by requirePlausibleToday
 * inside the helper, for the reason every other mutation that feeds one into
 * winner recomputation bounds it: the value decides which missed days are
 * already due for every member of a claimed team and is written into a
 * monthlyWinners row the whole team reads.
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
 * Whether the caller still has to complete their profile. Nothing consumes this
 * yet; it is the predicate an onboarding route guard needs, and it is defined
 * here so the rule lives beside the mutation that clears it.
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
