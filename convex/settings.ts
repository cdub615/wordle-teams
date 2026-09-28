import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, requirePlayer } from './access'
import { METHODS, REMINDER_TIMES } from './lib/reminders.ts'
import { reschedulePlayerReminderFor } from './reminders.ts'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import type { DataModel } from './_generated/dataModel'
import type { GenericDatabaseReader } from 'convex/server'

/**
 * The signed-in player's own notification settings.
 *
 * v2 had none of this. Four fields — timeZone, reminderDeliveryTime,
 * reminderDeliveryMethods, hasPwa — are in the schema and populated by the
 * Supabase copy, and until now nothing in v2 read or wrote one of them. A
 * player who signed up in v2 therefore had no timeZone, which is the one field
 * per-player reminder scheduling cannot proceed without: `scheduleNextFor`
 * (convex/reminders.ts) returns without scheduling anyone who has none.
 *
 * A FIFTH REMINDER FIELD IS DELIBERATELY NOT HERE: players.lastBoardEntryReminder.
 * That one is the reminder mechanism's own bookkeeping — the stamp
 * alreadyRemindedToday reads to avoid reminding someone twice in a day — and
 * never something the player sets, so it has no place in a settings surface.
 * `deliver` owns writing it.
 *
 * EVERY RULE IS IN A `...For` HELPER, never in the wrapper below it.
 * convex-test cannot stand up a Better Auth session (wordle-teams-obw), so a
 * rule written into a mutation body is a rule no test can reach.
 *
 * EVERY WRITE HERE RESCHEDULES, AND THE CALL GOES AFTER THE PATCH.
 * `timeZone` and `reminderDeliveryTime` are genuine inputs to `nextOccurrence`
 * (lib/reminders.ts) — a write to either that did not reschedule would leave
 * the player's pending job pointing at their old settings, so the reminder
 * would keep arriving at the time they just changed away from, with nothing
 * logged. `reminderDeliveryMethods` is NOT an input to the schedule — nothing
 * in `nextOccurrence` reads it — but `updateReminderMethodsFor` reschedules
 * anyway so that "every write reschedules" holds with no exception a reader
 * has to re-derive. See `reschedulePlayerReminderFor`'s doc comment in
 * convex/reminders.ts for why (it is NOT a bootstrap trigger — an earlier
 * version of this paragraph said that, and it is false the same way in both
 * files), and for the accepted cost of hooking a non-input field.
 *
 * THE ORDER IS LOAD-BEARING BECAUSE THE RESCHEDULE READS THE ROW IT RUNS
 * AGAINST — not, as this comment claimed twice before, because it protects
 * the refused-change case. A throw anywhere in a Convex mutation rolls the
 * WHOLE transaction back, patch and scheduled job together, regardless of
 * where the reschedule call sits, so a rejected change schedules nothing
 * either way; no test can tell the two orders apart on that axis. What the
 * order actually protects is the ACCEPTED case: `reschedulePlayerReminderFor`
 * does a fresh `ctx.db.get`, so placed above the patch it reads and schedules
 * against the value the player is changing FROM, not the one they just set —
 * a live, silent bug, confirmed by mutation testing and pinned by
 * settings.test.ts's 'changing the reminder time reschedules' and 'changing
 * the time zone reschedules', which assert the scheduled instant against the
 * value just written, not merely that it changed.
 *
 * setReminderMethodFor is NOT hooked separately, deliberately — it delegates to
 * updateReminderMethodsFor, so hooking the one place they meet is what stops
 * the two from drifting.
 *
 * updateTimeZoneFor IS THE ONLY AUTOMATIC TRIGGER FOR A PLAYER WHO HAS NEVER
 * HAD A ZONE: use-local-capture writes timeZone only when it is ABSENT
 * (src/lib/use-local-capture.ts:88), and that is what puts a natively-signed-up
 * player onto the schedule at all, with no per-sign-in churn since that write
 * only ever fires the one time. It is not the player's ONLY trigger overall,
 * though: the settings UI's time-zone `<Select>` opens at
 * notifications-tab.tsx:321, and its `onValueChange` at :322 calls the same
 * mutation (`updateTimeZone`, invoked at :214) on every manual change — so in
 * practice updateTimeZoneFor fires as often as a player changes zone.
 */

export async function updateReminderMethodsFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  methods: Array<string>,
): Promise<void> {
  // The schema types this v.array(v.string()) and cannot do better: narrowing it
  // to a union would be validated against every copied row on the next push, and
  // schema.ts:44-66 records what that cost when firstName was narrowed. So this
  // is the only place the constraint exists.
  //
  // Both branches below throw the SAME code for two different reasons — an
  // unrecognised method, and a recognised one repeated — which is exactly why
  // the copy behind INVALID_REMINDER_METHOD (src/lib/convex-error.ts) is worded
  // to be true of either: see NOT_TEAM_OWNER's comment there for what a copy
  // that is only true of ONE branch costs, silently, forever.
  const hasUnknown = methods.some((m) => !(METHODS as ReadonlyArray<string>).includes(m))
  if (hasUnknown) throw accessError('INVALID_REMINDER_METHOD')
  if (new Set(methods).size !== methods.length) throw accessError('INVALID_REMINDER_METHOD')
  await ctx.db.patch(playerId, { reminderDeliveryMethods: methods })
  await reschedulePlayerReminderFor(ctx, playerId)
}

/**
 * Turn ONE delivery method on or off, composed against the row as it is now.
 *
 * WHY THIS EXISTS AND `updateReminderMethodsFor` IS NO LONGER CALLED FROM THE
 * UI (`wordle-teams-069`). The settings tab used to compute the whole array
 * from the render it was showing and send that. Between the render and the
 * write sits the browser's push permission prompt, which is MODAL and can stay
 * open for minutes — so if the player toggled Email in another tab during that
 * window, the push write carried a stale view of Email and silently resurrected
 * or dropped it. A lost update, pre-existing, one boolean wide.
 *
 * The read and the write are in the SAME transaction here, so what is stored is
 * composed from the current row and the client sends only its own intent. This
 * is the shape `markCelebrationSeen` uses for `hasSeenCelebration`, and for the
 * same reason.
 *
 * IT ALSO RETIRES A HAZARD THE CALLERS WERE GUARDING BY HAND. Both toggles
 * carried a comment about never building the array from scratch, because doing
 * so would drop a player's push method the first time they touched the Email
 * switch — subscription still stored, switch still on, nothing ever sent. That
 * mistake is now unrepresentable: there is no array to build.
 *
 * VALIDATED ON THE METHOD, not only on the result. Disabling an unknown method
 * yields an array that is itself valid — the filter matches nothing — so
 * delegating to `updateReminderMethodsFor` alone would accept a typo in exactly
 * one direction and answer with a silent no-op.
 */
export async function setReminderMethodFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  method: string,
  enabled: boolean,
): Promise<void> {
  if (!(METHODS as ReadonlyArray<string>).includes(method)) {
    throw accessError('INVALID_REMINDER_METHOD')
  }
  const player = await ctx.db.get(playerId)
  if (!player) throw accessError('NO_PLAYER')

  const current = player.reminderDeliveryMethods
  const next = enabled
    ? current.includes(method)
      ? current
      : [...current, method]
    : current.filter((m) => m !== method)

  // Still through the array helper rather than patching directly, so the
  // unknown-method and duplicate rules stay in ONE place and cannot drift.
  await updateReminderMethodsFor(ctx, playerId, next)
}

export async function updateReminderTimeFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  time: string,
): Promise<void> {
  // MEMBERSHIP, NOT SHAPE. v1 enforced nothing server-side, and a shape-only
  // check ('HH:MM:SS' in range) accepts any string the picker never offered.
  // This is the only place the eighteen offered times are actually required.
  // See REMINDER_TIMES's doc comment for what this used to protect against
  // under the hourly sweep, and why widening the list is now safe.
  if (!REMINDER_TIMES.includes(time)) throw accessError('INVALID_REMINDER_TIME')
  await ctx.db.patch(playerId, { reminderDeliveryTime: time })
  await reschedulePlayerReminderFor(ctx, playerId)
}

export async function updateTimeZoneFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  timeZone: string,
): Promise<void> {
  // Validated by asking Intl, which is the same thing `nextOccurrence` asks
  // every time this player is scheduled. An unresolvable zone stored here does
  // not fail now; it fails later and QUIETLY, which is why it is refused at the
  // door. `deliver` retires that player's job as 'bad-time-zone' without
  // rescheduling, so their chain ends, and `maintain` re-logs the row on every
  // daily pass without ever being able to fix it. (The deleted hourly sweep
  // caught the same bad row per-player, for the reason a batch loop always
  // must: one bad row cannot be allowed to abort the rest.)
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
    throw accessError('INVALID_TIME_ZONE')
  }
  await ctx.db.patch(playerId, { timeZone })
  await reschedulePlayerReminderFor(ctx, playerId)
}

/**
 * SET-ONLY. Nothing ever clears hasPwa, so a player who uninstalls the PWA
 * keeps it `true` and `deliver` will go on believing push is deliverable to
 * them. That is v1's behaviour too (there is no uninstall hook to clear it
 * from either), and it is stated here rather than left implicit.
 */
export async function markPwaInstalledFor(ctx: MutationCtx, playerId: Id<'players'>): Promise<void> {
  await ctx.db.patch(playerId, { hasPwa: true })
}

type ReaderCtx = { db: GenericDatabaseReader<DataModel> }

/**
 * The settings shape the UI reads. Extracted from the `mySettings` wrapper so
 * the `timeZone ?? null` mapping and the four fields chosen are a rule a test
 * can drive directly, matching every other rule in this file.
 */
export async function mySettingsFor(ctx: ReaderCtx, playerId: Id<'players'>) {
  const player = (await ctx.db.get(playerId))!
  return {
    timeZone: player.timeZone ?? null,
    reminderDeliveryTime: player.reminderDeliveryTime,
    reminderDeliveryMethods: player.reminderDeliveryMethods,
    hasPwa: player.hasPwa,
  }
}

export const mySettings = query({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    return await mySettingsFor(ctx, player._id)
  },
})

export const setReminderMethod = mutation({
  args: { method: v.string(), enabled: v.boolean() },
  handler: async (ctx, { method, enabled }) => {
    const player = await requirePlayer(ctx)
    await setReminderMethodFor(ctx, player._id, method, enabled)
  },
})

export const updateReminderTime = mutation({
  args: { time: v.string() },
  handler: async (ctx, { time }) => {
    const player = await requirePlayer(ctx)
    await updateReminderTimeFor(ctx, player._id, time)
  },
})

export const updateTimeZone = mutation({
  args: { timeZone: v.string() },
  handler: async (ctx, { timeZone }) => {
    const player = await requirePlayer(ctx)
    await updateTimeZoneFor(ctx, player._id, timeZone)
  },
})

export const markPwaInstalled = mutation({
  args: {},
  handler: async (ctx) => {
    const player = await requirePlayer(ctx)
    await markPwaInstalledFor(ctx, player._id)
  },
})
