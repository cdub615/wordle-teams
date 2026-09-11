import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import {
  activityFloor,
  allowlistFrom,
  allowsAddress,
  alreadyRemindedToday,
  hasKnownMethod,
  localParts,
  METHODS,
  nextOccurrence,
  weekendPlayerIdsFrom,
} from './lib/reminders.ts'
import type { LocalTime } from './lib/reminders.ts'
import { boardEntryReminderEmail } from './reminderEmails.ts'
import { sendEmail } from './email.ts'

// Derived from METHODS (lib/reminders.ts) rather than re-typed as string
// literals, so the two `.includes()` checks below — `deliver`'s email branch
// and its push branch, which a grep of this file confirms are now the only
// two, the other pair having gone with `sweep` — and settings.ts's membership
// guard cannot drift out of sync with each other. The drift shape being
// guarded against is the one REMINDER_TIMES's own doc comment describes for
// times: a value that stores fine and looks right in the UI but that no
// branch on the server side ever matches. The separate question "is any
// stored method known at all" lives in lib/reminders.ts's hasKnownMethod,
// which `deliver` calls.
const [EMAIL_METHOD, PUSH_METHOD] = METHODS

/**
 * OBSERVABILITY ONLY. Warn when the instant just computed does not resolve back
 * to the wall clock it was computed FOR. Never throws, never changes what is
 * scheduled.
 *
 * NOT A REDUNDANT ASSERTION OF WHAT nextOccurrence ALREADY GUARANTEES.
 * `instantForLocal` (lib/reminders.ts) returns its guess UNVERIFIED after four
 * probe rounds. For every wall clock that exists it has converged by the third
 * — measured across all 418 zones x 18 REMINDER_TIMES x 2026-2028, 8,246,304
 * cases, the round histogram is {1: 412632, 2: 7832373, 3: 1296, 4: 3}. Those
 * three are the whole story: the unverified return is reached only for a wall
 * clock a DST spring-forward erased, where there is no correct answer and the
 * round count's parity picks the instant just before the gap — an hour early.
 * Today that is `Pacific/Easter` at 22:00, on three days across 2026-2028, and
 * the same sweep found zero false positives.
 *
 * WHAT WAS MISSING IS NOTICING. Nothing anywhere observed that exit, so if ICU
 * data shifts and a zone nobody checked starts erasing one of the eighteen
 * REMINDER_TIMES hours, the first signal would be a player reporting a reminder
 * an hour early. Resolving `dueAt` BACK through `localParts` in the player's own
 * zone costs one Intl call against a memoized formatter on the per-player path,
 * and turns that into a log line.
 *
 * IT SWALLOWS ITS OWN ERRORS, AND THAT IS THE REASON IT IS A SEPARATE FUNCTION
 * RATHER THAN FOUR LINES INLINE. An observability check must never be able to
 * abort the write it observes. Inline, this code sat OUTSIDE the catch that
 * wraps `nextOccurrence`, and was the one statement in `scheduleNextFor` that
 * could throw — so a throw from here would have rolled back `maintain`'s entire
 * daily pass, including every `playsWeekends` patch already made in it. (An
 * earlier version of this paragraph went on to say that `maintain` calls
 * `reschedulePlayerReminderFor` bare with no per-player try/catch, so that the
 * batch-tolerance property rested on this catch. It no longer does: `maintain`
 * wraps its per-player body in its own guard. Both catches are still wanted —
 * this one keeps an observability check from being able to fail a write at all,
 * which is a stronger property than being caught one frame up.)
 *
 * It is unreachable today, and the catch is still not decoration. `localParts`
 * cannot reject the zone — `nextOccurrence` already resolved it in the same
 * call, so an unresolvable one never gets here — and a NaN instant cannot
 * arrive, because `nextOccurrence` only returns one that compared `> from`.
 * What is left is the range bound: on the four-round fallback path
 * `instantForLocal` returns a `guess` it never formatted itself, so a `dueAt`
 * outside `Date`'s +/-8.64e15 ms would make `new Date(dueAt)` an Invalid Date
 * and `formatToParts` throw `RangeError: Invalid time value`. That needs a
 * `from` near year +/-275760 and every caller derives `from` from `Date.now()`,
 * so it is unreachable rather than tolerated — but "unreachable" is a property
 * of today's callers, and the catch is what stops a future one from paying for
 * it with a rolled-back daily pass.
 *
 * ONE SHAPE OF FALSE POSITIVE, worth naming so a warning is not read as proof
 * of an erased clock: a `requested` time that parses but is not the padded
 * 'HH:MM:SS' `localParts` returns — '9:00:00', say — schedules at the right
 * instant and still warns. settings.ts checks membership in REMINDER_TIMES so
 * no live write can produce one, and a copied Postgres `time` always pads.
 *
 * IT LIVES HERE RATHER THAN IN lib/reminders.ts because `console.warn` is I/O,
 * and that module's header sells itself as pure — no Convex, no I/O, no env, no
 * clock. Purity there is what makes this time arithmetic testable at all in a
 * repo where convex-test cannot authenticate.
 */
function warnIfWallClockDrifted(
  playerId: Id<'players'>,
  timeZone: string,
  requested: LocalTime,
  dueAt: number,
): void {
  try {
    const resolved = localParts(timeZone, new Date(dueAt)).time
    if (resolved === requested) return
    console.warn(
      '[reminders] scheduled instant does not resolve back to the requested wall clock',
      { playerId, timeZone, requested, resolved, dueAt },
    )
  } catch (error) {
    console.warn(
      '[reminders] could not verify the scheduled instant against the requested wall clock',
      { playerId, timeZone, requested, dueAt },
      error,
    )
  }
}

/**
 * Schedule this player's next reminder WITHOUT cancelling their current one.
 *
 * THE MISSING CANCEL IS THE POINT, not an omission. `deliver` calls this to
 * schedule tomorrow, and at that moment `player.reminderJobId` is the id of
 * the job that is running right now. Convex documents `cancel` as able to fail
 * once a job has committed, so cancelling yourself is the one call guaranteed
 * to be pointless at best. Everything with a genuinely stale job to clear calls
 * `reschedulePlayerReminderFor` below instead.
 *
 * PATCHES BOTH FIELDS TOGETHER, AND `dueAt` GOES INTO THE JOB'S ARGS. That
 * pairing is the staleness mechanism: the row says when the pending job is for,
 * the job says which instant it was created for, and `deliver` refuses to act
 * unless they agree. Split them, or drop `dueAt` from the args, and a job that
 * outlived a settings change starts delivering at the old time.
 *
 * A PLAYER WITH NO USABLE ZONE IS LEFT UNSCHEDULED, not thrown over. There is
 * no zone to compute an occurrence in. `updateTimeZoneFor` schedules them the
 * moment they get one, and `maintain` retries them daily at no extra cost,
 * since it is already reading every row. An unresolvable zone is logged and
 * swallowed for the reason the deleted sweep did the same: `schema.ts` types
 * timeZone as unvalidated `v.optional(v.string())`, a copied Supabase row never
 * passed through `updateTimeZoneFor`, and one bad row must not abort a batch
 * that `maintain` runs over every player row — ~393 of them, the figure this
 * change's spec measures for the Convex `players` table and the one every other
 * comment here uses.
 *
 * DO NOT DERIVE THAT FIGURE FROM SUPABASE'S. The deleted `sweep` said 533, and
 * a note reconciling the two claimed 393 was 533 minus the 151 nameless rows the
 * copy's `isNamed` filter drops. It is not: that subtraction gives 382. The
 * Supabase count has moved between measurements — 533 on 2026-08-20
 * (scripts/lib/copy-filters.mjs), 535 on 2026-08-24, and "151 of 543" in that
 * same file's explainTeamMemberDrops note — and the Convex table also gains
 * natively-signed-up players the copy never saw. The two are separate
 * measurements and neither one implies the other.
 *
 * RETURNS WHETHER IT SCHEDULED, and the boolean is load-bearing rather than
 * informational: `reschedulePlayerReminderFor` below cancels ONLY on true, so
 * that a player it cannot reschedule keeps the chain they already had. Every
 * `false` path has either logged or is a deliberate silence — see the three-way
 * ladder below.
 *
 * THE THREE-WAY LOG LADDER IS DESIGNED, NOT ACCIDENTAL. A missing player is
 * SILENT: the row is gone, which is the normal outcome of a delete racing a
 * scheduled job, and nothing is wrong. A missing `timeZone` is also silent —
 * it is the expected state of a copied row, true of hundreds of them, and
 * logging it would mean ~393 lines a day from `maintain` saying "as expected".
 * An UNRESOLVABLE zone is `console.error`: the field is set but ICU rejects it,
 * so a human has to look. A failed `cancel` is `console.warn`: harmless by
 * design, but the only trace it happened.
 */
export async function scheduleNextFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  from: number,
): Promise<boolean> {
  const player = await ctx.db.get(playerId)
  if (!player) return false

  const timeZone = player.timeZone
  if (!timeZone) return false

  let dueAt: number
  try {
    dueAt = nextOccurrence(
      timeZone,
      player.reminderDeliveryTime,
      from,
      player.playsWeekends ?? false,
    )
  } catch (error) {
    console.error(
      '[reminders] cannot compute a next occurrence for a player',
      { playerId, timeZone, reminderDeliveryTime: player.reminderDeliveryTime },
      error,
    )
    return false
  }

  warnIfWallClockDrifted(playerId, timeZone, player.reminderDeliveryTime, dueAt)

  const reminderJobId = await ctx.scheduler.runAt(dueAt, internal.reminders.deliver, {
    playerId,
    dueAt,
  })
  await ctx.db.patch(playerId, { reminderJobId, nextReminderAt: dueAt })
  return true
}

/**
 * Schedule this player's next reminder, and cancel the one it replaces.
 *
 * Called from every path that changes an input to the schedule — `timeZone` and
 * `reminderDeliveryTime` (settings.ts) — and from `maintain` when it finds a
 * chain that needs repairing or has never existed.
 *
 * READS THE ROW LIVE, AS COMMITTED AT CALL TIME — this does its own
 * `ctx.db.get` (inside `scheduleNextFor`), so a caller changing a value
 * `nextOccurrence` reads (`timeZone`, `reminderDeliveryTime`, `playsWeekends`)
 * MUST patch that field BEFORE calling this, not after: calling it first would
 * compute the next occurrence from the OLD value and schedule the wrong
 * instant, silently, with no error and nothing logged. settings.ts's three
 * call sites all patch first — mutation testing confirmed a reordering there
 * produces exactly this bug (see settings.ts's module doc comment) — but nowhere
 * pins it on THIS side, so a fourth caller (a future settings field, or Task
 * 5/6) gets no warning at the place it would actually look.
 *
 * `reminderDeliveryMethods` CALLS THIS TOO, BUT IS NOT AN INPUT TO THE
 * SCHEDULE, and the distinction is worth stating so nobody hunts for a
 * dependency that does not exist — or "restores" a methods gate here.
 * `nextOccurrence` takes the zone, the time, `from` and `playsWeekends`;
 * nothing in this file reads methods, so changing them cannot move the
 * instant. IT IS NOT A BOOTSTRAP TRIGGER EITHER, despite an earlier version of
 * this comment claiming that: `scheduleNextFor` gates only on `timeZone`
 * (below), so a methods write can never be what first schedules a player, and
 * `deliver` (Task 5) runs a chain with empty methods regardless, via
 * `skipAndReschedule('no-method')`. It reschedules anyway so that "every write
 * in settings.ts reschedules" holds with NO EXCEPTION a reader has to
 * re-derive.
 * THE ACCEPTED COST: a methods write still cancels the pending job and
 * reschedules from `Date.now()`, even though it cannot move the instant — so a
 * methods toggle landing in the scheduler-latency window between a due instant
 * and that job's execution cancels the about-to-fire job and reschedules for
 * the NEXT occurrence — the following day, or later if a skipped weekend
 * intervenes — eating that day's reminder, which the player never asked to
 * move.
 * `maintain` cannot detect this: the row is self-consistent afterward, just a
 * day later than the player would have chosen. Accepted as the cost of the
 * exceptionless rule, not a defect of it.
 *
 * `from` DEFAULTS TO `Date.now()`, WHICH IS SAFE HERE AND IS NOT THE
 * `crons.hourly` HAZARD crons.ts SPENDS A PARAGRAPH ON. That hazard is
 * serialisation at MODULE EVALUATION: `Crons.schedule` freezes its args when
 * the module defining the cron is evaluated, so an instant passed from crons.ts
 * would be stamped at deploy time forever. A default parameter is evaluated per
 * call, inside the mutation, so it reads the transaction timestamp — which is
 * the same thing the deleted `sweep` did with its own `nowArg ?? Date.now()`.
 * The asymmetry with `scheduleNextFor`, whose `from` is REQUIRED, is deliberate: its callers
 * (`deliver`, and this function) always have a meaningful instant already —
 * `deliver`'s is the instant it was itself due — and defaulting there would let
 * one be forgotten silently.
 *
 * SCHEDULE FIRST, CANCEL ONLY ON SUCCESS. Cancelling first looks tidier and is
 * wrong: `scheduleNextFor` returns false for a player with no usable zone
 * without touching the row, so a cancel-then-bail would leave `reminderJobId`
 * naming a CANCELED job and `nextReminderAt` holding a future instant. Task 6's
 * health predicate is exactly `nextReminderAt !== undefined && nextReminderAt >
 * now`, so `maintain` would read that row as healthy and skip it until the
 * stale instant passed — the row would be lying, and the row being the source
 * of truth is the invariant this whole design rests on. Reachable, not
 * hypothetical: it needs a zone that became unusable after a chain existed, and
 * the cutover copy overwriting `timeZone` is the plausible route. On failure
 * this leaves the row and the old job entirely alone, so the existing chain
 * keeps running and self-repairs.
 *
 * THE CANCEL IS BEST-EFFORT AND ITS FAILURE IS HARMLESS, which is a stronger
 * property than tolerating a throw. Convex documents `cancel` as throwing for a
 * completed action and as able to "fail to cancel if it has committed" for a
 * mutation, and neither case can be reproduced in `convex-test` at all. It does
 * not matter: the row is the source of truth, so an uncancelled job carrying a
 * superseded `dueAt` reads the row, sees the mismatch, and retires without
 * delivering or rescheduling. Cancelling is a tidiness measure that keeps
 * `_scheduled_functions` from filling with jobs that will no-op.
 *
 * SO DO NOT "FIX" THIS BY LETTING THE ERROR PROPAGATE. Throwing here would roll
 * back the whole transaction, which means the settings change the player just
 * made would be discarded because a cleanup step failed.
 *
 * The missing player is silent, as in `scheduleNextFor` — see the log ladder on
 * its doc comment.
 */
export async function reschedulePlayerReminderFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  from: number = Date.now(),
): Promise<void> {
  // Captured BEFORE delegating, because `scheduleNextFor` overwrites
  // `reminderJobId` with the replacement's id.
  const player = await ctx.db.get(playerId)
  if (!player) return
  const supersededJobId = player.reminderJobId

  const scheduled = await scheduleNextFor(ctx, playerId, from)
  if (!scheduled || !supersededJobId) return

  try {
    await ctx.scheduler.cancel(supersededJobId)
  } catch (error) {
    console.warn(
      '[reminders] could not cancel a pending reminder job; it will retire on its own',
      { playerId, reminderJobId: supersededJobId },
      error,
    )
  }
}

/**
 * Deliver one player's board-entry reminder, then schedule their next one.
 *
 * REPLACES THE HOURLY SWEEP. That sweep opened with
 * `ctx.db.query('players').collect()` — a full table scan, unconditionally,
 * 720 times a month. ARITHMETIC: 393 players x 720 runs = 282,960 document
 * reads a month; at the ~291 bytes/document wordle-teams-yhii estimates, that
 * is ~82 MB decimal (78.5 MiB), against a 1 GB cap whose failure mode is
 * mutations FAILING rather than a bill (wordle-teams-dcu) — so ~8% either way
 * you count the unit.
 *
 * WHAT THIS READS INSTEAD, ON THE DELIVERED PATH: the player row TWICE — once
 * here and once inside `scheduleNextFor`, which does its own `ctx.db.get` —
 * plus at most one `dailyScores` row, over two index ranges. Three documents
 * and two ranges. NOT "one player row": that phrasing was in an earlier
 * version of this comment and it undercounted by forgetting the second get.
 * Task 8's DELIVER_READS enumerates the same figures.
 *
 * IT IS NOT A FUTURE COST. An earlier version of this comment said the sweep
 * "cost nothing only because REMINDERS_ENABLED was empty", deferring the bill
 * to cutover day. That was wrong: REMINDERS_ENABLED was read as 'true' on beta
 * from the Convex dashboard on 2026-09-11 (recorded in this change's plan;
 * `convex env list` is not the way to re-check it, because it prints every
 * deployment secret in plaintext). The `players` collect sat ABOVE the
 * per-player allowlist filter in `sweep`, so the scan had been running hourly
 * there all along, right up to the deletion. What keeps real people from being
 * mailed is the allowlist (Gate 2), not the enable flag (Gate 1).
 *
 * THIS PARAGRAPH IS THE ONE AUTHORITATIVE STATEMENT OF THAT, and crons.ts cites
 * it rather than restating it — the wrong version has now been written twice,
 * once here and once in the text Task 7 was handed for crons.ts.
 *
 * STILL A MUTATION, NOT AN ACTION, for every reason the deleted `sweep` was
 * one, and restated rather than cited because that function is gone: eligibility
 * has to be decided against one consistent snapshot, the claim has to commit in
 * the same transaction as that decision, `sendEmail` enqueues into the Resend
 * component's tables via `ctx.runMutation`, and an OCC retry simply re-runs the
 * whole handler having committed nothing.
 *
 * THE STALENESS GUARD IS FIRST, AND IT IS WHAT MAKES THE DESIGN SAFE. `dueAt`
 * is the instant this job was created for; `player.nextReminderAt` is the
 * instant the row currently expects. If they disagree, this job has been
 * superseded by a settings change or a repair, and it retires — delivering
 * nothing and, crucially, rescheduling nothing, because the job that replaced
 * it already owns the schedule. Without this, `ctx.scheduler.cancel` would have
 * to be reliable; see `reschedulePlayerReminderFor` for what Convex documents
 * about that.
 *
 * IT RESCHEDULES ON EVERY PATH THAT REACHES AN ELIGIBILITY DECISION, including
 * when the kill switch is off and when the player turns out to be ineligible.
 * Each of those is a day this player is not reminded; none of them is a reason
 * to end their chain forever. Miss this and turning REMINDERS_ENABLED off would
 * strand every player, and turning it back on would need a full re-bootstrap —
 * which is exactly the coupling keeping the gate at delivery was meant to
 * avoid.
 *
 * THREE BRANCHES RETURN WITHOUT RESCHEDULING, AND ALL THREE ARE DELIBERATE.
 * 'superseded' is the one the paragraph above is about, and the only one of
 * the three that is a correctness requirement rather than a tidiness choice.
 * 'no-player': the row is gone, so there is nothing to schedule for and
 * `scheduleNextFor` would return false anyway — the log ladder on that function
 * explains why a missing player is silent. 'bad-time-zone': there is no zone to
 * compute an occurrence in, so `scheduleNextFor` would resolve the same
 * unresolvable zone, log a second time and return false (measured, by mutating
 * this branch into a rescheduling one). In that last case the chain ends and
 * `maintain` retries the row daily — self-limiting and visible, which is the
 * right failure for a row nobody can schedule.
 *
 * A FOURTH BRANCH REACHES THE SAME END STATE WITHOUT BEING ONE OF THOSE, so
 * "nothing gets scheduled here" is not the same set as "no reschedule is
 * attempted". 'no-time-zone' does call `scheduleNextFor`, but that function
 * gates on `timeZone` and returns false without touching the row, so nothing is
 * scheduled there either. It is left to `maintain` like the others, and it
 * is silent like 'no-player' — the expected state of hundreds of copied rows,
 * which is why only 'bad-time-zone' logs. See the log ladder on
 * `scheduleNextFor` for that whole rule.
 *
 * ORDERING WITHIN THE HANDLER DOES NOT PROTECT THE CHAIN, so do not reorder it
 * hoping to. This is one transaction: `runAt` takes effect on commit, so if
 * anything throws, the reschedule is rolled back with everything else no matter
 * where it sat. A throw ends this player's chain until `maintain` repairs it,
 * and `maintain` is the only thing that protects against that.
 *
 * NO `teams` READ. The weekend rule is applied when the next occurrence is
 * computed, from the derived `playsWeekends` on the row — see
 * lib/reminders.ts's nextOccurrence for why asking `teams` here would cost more
 * than the sweep this replaces.
 */
export const deliver = internalMutation({
  args: { playerId: v.id('players'), dueAt: v.number() },
  handler: async (ctx, { playerId, dueAt }) => {
    const player = await ctx.db.get(playerId)
    if (!player) return { delivered: false, reason: 'no-player' as const }

    // EXACT, NOT A TOLERANCE. Both sides come from `instantForLocal`, so they
    // agree to the millisecond or this job belongs to a schedule the row has
    // already replaced. An absent `nextReminderAt` is a mismatch too, which is
    // what retires a job whose row has no pending schedule at all.
    if (player.nextReminderAt !== dueAt) {
      return { delivered: false, reason: 'superseded' as const }
    }

    const now = Date.now()
    // THE SKIP PATH. Every eligibility outcome below returns through here, so
    // that none of them can silently end the chain — but "every return below
    // this point" would be false, and the two exceptions are the ones a
    // maintainer adding a branch most needs to know about:
    //
    //  - 'bad-time-zone' returns bare, on purpose: there is no zone to compute
    //    an occurrence in, so calling this would only log a second time. The
    //    doc comment above has the whole rule.
    //  - the delivered path reschedules through its own call at the end,
    //    because it is not a skip.
    //
    // NAMED FOR BOTH HALVES, because it reads like a value constructor and is
    // not one: it performs a `runAt` and a `patch` (inside `scheduleNextFor`)
    // at each of its seven call sites, which the earlier name
    // `withReschedule` left to be discovered.
    const skipAndReschedule = async <R extends string>(reason: R) => {
      await scheduleNextFor(ctx, playerId, now)
      return { delivered: false, reason }
    }

    if (process.env.REMINDERS_ENABLED !== 'true') {
      return await skipAndReschedule('disabled' as const)
    }

    const timeZone = player.timeZone
    if (!timeZone) return await skipAndReschedule('no-time-zone' as const)

    if (!hasKnownMethod(player.reminderDeliveryMethods)) {
      return await skipAndReschedule('no-method' as const)
    }

    // Both gates delegate to lib/reminders.ts — see `allowlistFrom`'s own doc
    // comment there for why the trim/fold/drop-empties rules are not written
    // out a second time here. They were duplicated in the deleted `sweep`'s
    // Gate 2 first, which is how they came to live in one place.
    if (!allowsAddress(allowlistFrom(process.env.REMINDERS_ALLOWLIST), player.email)) {
      return await skipAndReschedule('not-allowlisted' as const)
    }

    // RESOLVED BEFORE `alreadyRemindedToday`, WHICH ALSO CALLS `localParts`.
    // The protection is the EARLY RETURN, not the try block: this is the only
    // resolution inside the catch, and the zone is resolved AT LEAST ONCE MORE
    // afterwards — conditionally by `alreadyRemindedToday`, which calls
    // `localParts` only when a stamp exists, and again inside
    // `scheduleNextFor` on every skip path. All of those are outside this
    // catch. What keeps them safe is that an ICU-rejected zone has already
    // returned here before any of them can be reached. (Two earlier versions
    // of this comment got the structure wrong: first claiming the ordering
    // "puts both resolutions inside one catch", then that there were exactly
    // two.) `schema.ts`
    // types timeZone as unvalidated `v.optional(v.string())` and a row copied
    // from Supabase never passed through `updateTimeZoneFor`, so an
    // ICU-rejected zone is reachable here — see lib/reminders.ts's localParts
    // precondition for which values throw.
    let local
    try {
      local = localParts(timeZone, new Date(now))
    } catch (error) {
      console.error('[reminders] unresolvable timeZone on a player', { playerId, timeZone }, error)
      return { delivered: false, reason: 'bad-time-zone' as const }
    }

    if (alreadyRemindedToday(player.lastBoardEntryReminder, timeZone, local.day)) {
      return await skipAndReschedule('already-reminded' as const)
    }

    // TWO INDEX LOOKUPS, NOT AN ELEVEN-DAY COLLECT. The sweep read the whole
    // trailing eleven days — its one range query ran `gte(addDays(localDay,
    // -10))` through `lte(localDay)`, both bounds inclusive, which is the same
    // window `activityFloor` now names — and inspected the list; these ask the
    // index the two questions directly and stop at the first row, so the cost
    // is at most two documents instead of up to eleven. ("Up to", not "six to
    // eleven": the window is 11 days, but the rows returned are the boards
    // actually entered in it, so the count is 0..11 and its distribution was
    // never measured.)
    // With the players scan gone, this was the dominant remaining read.
    const enteredToday = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q.eq('playerId', playerId).eq('puzzleDay', local.day),
      )
      .first()
    if (enteredToday) return await skipAndReschedule('already-entered' as const)

    // BOTH BOUNDS, BECAUSE THIS IS A PORT. An open-ended `gte` would also
    // count a board dated AFTER the player's current local day, which the
    // sweep's `[floor, localDay]` range excluded. That is reachable — a
    // timeZone moved backwards after a board was entered puts a row in the
    // player's future — and it errs toward reminding, so the widening would be
    // harmless. It is still a behaviour change the rest of this comment would
    // have been claiming parity over, so the window matches the sweep's exactly
    // and both edges are pinned by tests: a board on `activityFloor(local.day)`
    // counts, a board after `local.day` does not.
    const recent = await ctx.db
      .query('dailyScores')
      .withIndex('by_player_and_puzzleDay', (q) =>
        q
          .eq('playerId', playerId)
          .gte('puzzleDay', activityFloor(local.day))
          .lte('puzzleDay', local.day),
      )
      .first()
    if (!recent) return await skipAndReschedule('inactive' as const)

    // SITE_URL is read only once a player is genuinely about to be mailed, and
    // throwing here rolls the whole transaction back — no claim, no reschedule —
    // so `maintain` restores the chain once the deployment is fixed. It also
    // gates push, which does not itself need the value; that is an accepted,
    // live consequence, unchanged from the sweep.
    const siteUrl = process.env.SITE_URL
    if (!siteUrl) throw new Error('[reminders] SITE_URL is not set on this deployment')

    // CLAIM BEFORE DELIVERING, UNCONDITIONALLY. The sweep needed this because
    // its hour window's inclusive bounds made double-matching the normal case.
    // Exact scheduling removes that, but a duplicate job can still exist — a
    // repair racing a settings change — so the guard keeps its original job.
    // CONDITION IT ON WHAT DELIVERY REPORTS and that race becomes a double
    // email: `sendEmail` returns null, not a throw, when every recipient is
    // filtered out. Simply MOVING it below the two delivery blocks is a subtler
    // matter — both writes commit in this one transaction, so no test in this
    // repo can tell the difference (measured) — which is exactly why it is
    // written in the order the rule is stated rather than left to luck.
    await ctx.db.patch(playerId, { lastBoardEntryReminder: now })

    if (player.reminderDeliveryMethods.includes(EMAIL_METHOD)) {
      const { subject, html, text } = boardEntryReminderEmail({
        firstName: player.firstName,
        siteUrl,
      })
      await sendEmail(ctx, {
        from: 'Wordle Teams <reminders@wordleteams.com>',
        to: player.email,
        subject,
        html,
        text,
      })
    }

    if (player.reminderDeliveryMethods.includes(PUSH_METHOD)) {
      await ctx.scheduler.runAfter(0, internal.pushSend.deliverTo, { playerId, attempt: 0 })
    }

    await scheduleNextFor(ctx, playerId, now)
    return { delivered: true, reason: 'sent' as const }
  },
})

/**
 * The number of reschedules one maintenance run will attempt.
 *
 * BELOW A PLATFORM LIMIT, not a tuning knob. Convex caps the functions one
 * transaction may schedule; `convex-test` 0.0.54 models that cap at 1000, as
 * the `functionsScheduled` entry of `DEFAULT_TRANSACTION_LIMITS` in
 * `convex-test/dist/transactionMetrics.js`, and 1000 is the figure this is
 * designed against.
 *
 * 800 IS A 20% MARGIN AGAINST ANYTHING ELSE THE TRANSACTION MIGHT SCHEDULE,
 * which today is nothing — `deliver` is the only thing this pass enqueues. It
 * is NOT headroom for the pass's own reads and writes, as an earlier draft of
 * this said: those count against entirely different limits (`documentsRead`,
 * `bytesWritten`) and cannot consume `functionsScheduled` at all.
 *
 * THE BUDGET NEVER THROWS — IT DEFERS, and that is the point. A table with more
 * players needing a reschedule than the budget makes progress across successive
 * runs rather than throwing and repairing nobody. The throw it exists to stay
 * below is the PLATFORM's. convex-test's is merely the only one this repo's
 * tests can reach, and only when asked for explicitly — see reminders.test.ts's
 * "a throw on one player is logged and the batch carries on", which carries the
 * whole harness story, because that test is the only place a reader needs it.
 *
 * 800 ALSO COVERS A ONE-SHOT BOOTSTRAP of the ~393 players the Convex table
 * holds after the copy's `isNamed` filter, so deferral is a safety net rather
 * than the expected case. `deferred` in the return value and the summary line
 * this pass logs when it moves are what make a multi-day bootstrap visible
 * rather than mysterious.
 */
const MAINTAIN_SCHEDULE_BUDGET = 800

/**
 * The safety net for per-player scheduling, and the only thing standing between
 * a broken chain and a player who is silently never reminded again.
 *
 * WHY THIS IS LOAD-BEARING RATHER THAN A NICE-TO-HAVE. A sweep is self-healing:
 * it recomputes from scratch every run, so a lost job fixes itself. A chain has
 * no such property. Scheduled mutations are exactly-once and auto-retried on
 * TRANSIENT errors, so flakiness is not the risk — a PERMANENT throw is. The
 * old sweep caught an unresolvable timeZone per player precisely because one bad
 * row must not take a batch down; in a chain, that same row rolls back the whole
 * transaction INCLUDING the reschedule, and that player is gone with nothing
 * logged and nobody looking. This pass is what finds them.
 *
 * DAILY, NOT HOURLY, and the cadence is the whole economy of this design. It
 * collects the entire `players` table, which is exactly the read the hourly
 * sweep was killed for: at 720 runs a month that was ~283,000 player reads and
 * about 82 MB, on the same 393-rows x ~291-bytes figures `deliver` above uses.
 * At 30 runs it is ~11,800 of those, under 4 MB, and it buys back the
 * self-healing property for 1/24th of the cost. Putting this back on an hourly
 * cron would restore the original bug in full. Those figures are the `players`
 * collect ONLY; this pass also collects `teams` every run, which schema.ts's
 * note on the `teams` table — the one explaining why there is no index for
 * "teams containing player X" — puts at 171 rows in production, so roughly
 * 5,100 reads a month on top.
 *
 * FOUR JOBS IN ONE PASS, deliberately, because they all need the same scan:
 *
 *  1. DERIVE playsWeekends. `teams` is collected once — Convex cannot index
 *     array membership — and the flag is written only where it actually differs,
 *     so steady state is reads-only.
 *  2. REPAIR a chain whose job never fired (nextReminderAt at or before now),
 *     OR whose derived weekend flag just changed. The second half is a
 *     correctness requirement, not a refinement — see THE FLAG IS AN INPUT
 *     below.
 *  3. BOOTSTRAP a player who never had one (nextReminderAt absent). This is the
 *     SAME CASE as 2 from here, which is why the existing rows need no
 *     migration mutation and no manual cutover step — and that matters beyond
 *     convenience, because a manual step would have to be run against prod, and
 *     `convex run --prod` silently hits the local deployment on at least one
 *     machine.
 *  4. STAY BOUNDED. See MAINTAIN_SCHEDULE_BUDGET.
 *
 * THE FLAG IS AN INPUT TO THE SCHEDULE, SO A FLIP INVALIDATES THE PENDING JOB
 * exactly the way a settings change does — and settings.ts's writes already go
 * through `reschedulePlayerReminderFor` for precisely that reason. Repairing
 * only PAST-DUE chains leaves a hole that running this pass more often cannot
 * close, because the pass cannot see it: a non-weekend player's Friday delivery
 * points `nextReminderAt` at MONDAY, because `nextOccurrence` skipped the
 * weekend; they join a weekend-playing team on Saturday; the flag flips, but
 * Monday is still in the future, so the chain reads healthy and they miss
 * Saturday AND Sunday. The other direction is milder and the same defect: a flag
 * going true -> false leaves a Saturday job that still matches the row, so
 * `deliver`'s staleness guard passes it and the weekend rule — which lives in
 * `nextOccurrence`, not in the delivery job — never gets a say. One extra send.
 * Rescheduling on the flip closes both, and tightens the staleness bound this
 * field carries to at most one missed or one extra day.
 *
 * COMPARED AGAINST THE COERCED VALUE, `player.playsWeekends ?? false`, AND THAT
 * IS WHAT KEEPS THE ABOVE FROM BEING A WHOLE-TABLE BURST. Absent and false are
 * the same state to every reader of this field — `scheduleNextFor` coerces the
 * same way — so treating them as equal is the correct equality for this domain,
 * not a shortcut. Comparing the raw field would make `undefined !== false` true
 * for every player not on a weekend-playing team, patching a few hundred rows
 * on the first run after cutover, rescheduling every one of them, and making the
 * reads-only claim above false on its face. A non-weekend player therefore stays
 * absent forever; only a weekend player gets an explicit `true`, and only a
 * player who LEAVES a weekend team gets an explicit `false`.
 *
 * NOT GATED ON REMINDERS_ENABLED, and that is intentional. The gate lives at
 * delivery so that flipping it costs nothing; gating the schedule too would mean
 * the flag had to cancel and recreate every pending job, which is the coupling
 * the whole arrangement avoids.
 *
 * A PLAYER WITH NO timeZone IS SKIPPED AND COSTS NOTHING. They cannot be
 * scheduled — there is no zone to compute an occurrence in — and on beta they
 * are numerous, because scripts/lib/copy-reminder-policy.mjs WITHHOLDS timeZone
 * on every copy but the cutover one. (An earlier draft blamed the 151 nameless
 * production rows; those never reach Convex, since copy-filters.mjs drops them
 * with players.filter(isNamed).) They are retried every run at no extra cost,
 * because this pass is already reading every row, and they never consume the
 * schedule budget. They ARE counted, in `zoneless`: before that counter existed
 * a table that had lost every zone returned byte-identically to a perfectly
 * healthy one, which for the pass whose whole purpose is finding silent
 * failures made the largest silent population the one thing it could not
 * report. Their weekend flag is still derived — the patch sits above the zone
 * check on purpose, since `updateTimeZoneFor` will one day schedule them and
 * `scheduleNextFor` reads this flag when it does.
 *
 * AN UNRESOLVABLE ZONE IS A DIFFERENT CASE AND IT IS NOT FREE, so do not carry
 * the paragraph above across to it. A row whose `timeZone` is SET but rejected
 * by ICU — `'GMT+5'` off a copied row — passes the check below, reaches
 * `reschedulePlayerReminderFor`, logs, changes nothing, and still consumes a
 * budget slot, because `scheduled` counts attempts (see the increment). It does
 * that on every pass, forever. Harmless while the table is far below the budget,
 * and the log is what gets such a row fixed — but a cost, not the absence of one.
 */
export const maintain = internalMutation({
  // `budget` exists for the tests, the same way `sweep`'s `now` did, and for the
  // same reason it must NOT be passed from crons.ts: a cron's args are
  // serialised when that module is EVALUATED, not when the job fires.
  args: { budget: v.optional(v.number()) },
  handler: async (ctx, { budget }) => {
    const limit = budget ?? MAINTAIN_SCHEDULE_BUDGET
    const now = Date.now()

    // BOTH COLLECTS SIT OUTSIDE THE PER-PLAYER GUARD BELOW, and structurally
    // so: that guard lives INSIDE the loop, which is the only place it belongs.
    // A failure reading either table is not a per-row problem and has no
    // per-row fallback, so it must abort the whole pass and let Convex retry
    // the mutation.
    const teams = await ctx.db.query('teams').collect()
    const weekendPlayerIds = weekendPlayerIdsFrom(teams)

    const players = await ctx.db.query('players').collect()

    let weekendFlagsChanged = 0
    let scheduled = 0
    let deferred = 0
    let zoneless = 0
    let failed = 0

    for (const player of players) {
      // ONE GUARD PER PLAYER, AROUND THE PER-PLAYER WORK ONLY. This pass's "one
      // bad row must not abort the batch" property is the same one the old
      // sweep had explicitly, and for the same measured reason: a row copied
      // from Supabase never passed through `updateTimeZoneFor`, so one bad row
      // exists. Do NOT delete this on the grounds that `scheduleNextFor`
      // catches everything internally — relying on a called function never
      // throwing is the wrong shape for a batch loop, and that assumption was
      // already false once (the wall-clock probe originally sat outside the try
      // that wraps `nextOccurrence`, so a throw there would have rolled back
      // this whole pass including every flag patch already made in it).
      //
      // DO NOT BROADEN IT. The distinction that matters is a per-row failure
      // (log, continue, retried by tomorrow's run) against a failure of the
      // pass itself, and an OCC write conflict is the second kind: Convex
      // resolves one by re-running the whole handler, which has committed
      // nothing (see `deliver`'s doc comment), and that is the correct outcome.
      // No `instanceof` clause is needed to let one through, because a conflict
      // is not reported as an exception from a `ctx.db.patch` inside the
      // handler. That last clause is a property of how Convex reports
      // conflicts rather than anything this file enforces, so it is the part to
      // re-check if this guard ever has to widen.
      try {
        const playsWeekends = weekendPlayerIds.has(player._id)
        // `?? false`, NOT the raw field. See COMPARED AGAINST THE COERCED VALUE
        // on this function's doc comment — this one coercion is what stops the
        // first run after cutover patching and rescheduling a few hundred rows.
        const flipped = (player.playsWeekends ?? false) !== playsWeekends

        // THE ROW ONLY, NEVER `_scheduled_functions`, and this is the place a
        // reader asks why. The predicate deliberately does not check that
        // `reminderJobId` still names a live job: the row is the source of
        // truth by design (schema.ts's note on `nextReminderAt`), a job that
        // outlives its row retires itself on `deliver`'s staleness guard, and
        // a `ctx.db.system.get` per player would put a read back on the
        // per-row path this whole change exists to remove. The cost of not
        // checking is bounded at one day: a job lost or cancelled WITHOUT the
        // row being patched reads as healthy until its instant passes, and the
        // next run repairs it. `reschedulePlayerReminderFor` is careful never
        // to create that state on purpose — see its SCHEDULE FIRST, CANCEL
        // ONLY ON SUCCESS paragraph.
        //
        // TypeScript requires the `!== undefined` narrowing before the
        // comparison, so it is not a redundant clause: `undefined > now` is a
        // type error, not a `false`.
        const healthy = player.nextReminderAt !== undefined && player.nextReminderAt > now
        // A zone is the one thing `scheduleNextFor` gates on, so checking it
        // here is what keeps an unschedulable row from consuming the budget.
        // Counted rather than merely skipped — see `zoneless` in the returned
        // shape below for what was invisible without it.
        const schedulable = Boolean(player.timeZone)
        if (!schedulable) zoneless += 1
        const needsSchedule = schedulable && (!healthy || flipped)

        // DEFER THE WHOLE ROW, FLAG INCLUDED, and that ordering is load-bearing.
        // Patching the flag first and then deferring would leave the next run
        // seeing a flag that already agrees and a chain that still reads
        // healthy — so nothing would ever reschedule it, losing the
        // reschedule-on-flip fix for exactly the rows a bootstrap is too busy to
        // reach. Leaving the flag stale is CHEAP, NOT FREE, and the difference
        // is a real path: `maintain` declined to schedule, but settings.ts's
        // write paths reach `scheduleNextFor` independently, and that is where
        // `playsWeekends` is read. So if this row's owner changes their reminder
        // time before the next pass, their next occurrence is computed from the
        // stale flag — one possibly-wrong weekend day, self-healing on the next
        // run.
        if (needsSchedule && scheduled >= limit) {
          deferred += 1
          continue
        }

        if (flipped) {
          await ctx.db.patch(player._id, { playsWeekends })
          weekendFlagsChanged += 1
        }

        if (!needsSchedule) continue

        // COUNTS ATTEMPTS, NOT SUCCESSES, because
        // `reschedulePlayerReminderFor` returns void — an unresolvable zone
        // logs, leaves the row alone and still lands here. That is the figure
        // the budget needs to bound anyway: work done, not jobs created.
        await reschedulePlayerReminderFor(ctx, player._id, now)
        scheduled += 1
      } catch (error) {
        failed += 1
        console.error(
          '[reminders] maintenance failed for one player; it will be retried tomorrow',
          { playerId: player._id },
          error,
        )
      }
    }

    // ONE LINE PER RUN, AND ONLY WHEN THIS PASS DID NOT FINISH ITS JOB. Without
    // it, every counter here exists only in the return value, and after Task 7
    // the sole caller is a cron — whether Convex surfaces a cron mutation's
    // return value anywhere a human looks is not something this repo has
    // verified, so the budget's claim that `deferred` makes a multi-day
    // bootstrap "visible" would have been an assertion rather than a fact. This
    // is what makes it true, and it puts bootstrap progress where the per-row
    // errors already land.
    //
    // `zoneless` IS IN THE PAYLOAD BUT NOT THE TRIGGER, deliberately. On beta
    // it is the normal state of most rows, so triggering on it would log every
    // single run to report the expected — which is the same "~393 lines a day
    // saying as expected" that `scheduleNextFor`'s log ladder refuses. Steady
    // state stays silent, and the count is there whenever the line does fire.
    if (deferred > 0 || failed > 0) {
      console.log('[reminders] maintenance pass did not finish', {
        players: players.length,
        teams: teams.length,
        weekendFlagsChanged,
        scheduled,
        deferred,
        zoneless,
        failed,
      })
    }

    // THE RETURNED SHAPE, spelled out because Task 8 asserts against these
    // names and one of them does not mean what it says:
    //
    //   players, teams       the two collects' sizes — this pass's whole read
    //                        cost, and the only two fields that are not counts
    //                        of something that happened
    //   weekendFlagsChanged  rows whose derived flag differed and was patched
    //   scheduled            reschedule ATTEMPTS, NOT JOBS CREATED. A row with
    //                        an unresolvable zone logs, changes nothing, and
    //                        still counts here (see the increment above). It is
    //                        the figure the budget bounds, so attempts is the
    //                        right thing to count — but the name reads as jobs,
    //                        and a reader of Task 8's assertion deserves to
    //                        know the difference.
    //   deferred             rows that needed a reschedule and hit the budget
    //   zoneless             rows with no `timeZone` at all, which can never be
    //                        scheduled. Separates "nobody needed scheduling"
    //                        from "nobody could be" — two states whose returns
    //                        were byte-identical before this counter.
    //   failed               rows whose per-player work threw and was caught
    return {
      players: players.length,
      teams: teams.length,
      weekendFlagsChanged,
      scheduled,
      deferred,
      zoneless,
      failed,
    }
  },
})
