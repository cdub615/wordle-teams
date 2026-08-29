import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, requirePlayer } from './access'
import { METHODS, REMINDER_TIMES } from './lib/reminders.ts'
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
 * the reminder sweep cannot proceed without.
 *
 * A FIFTH REMINDER FIELD IS DELIBERATELY NOT HERE: players.lastBoardEntryReminder.
 * That one is the sweep's own bookkeeping — the stamp alreadyRemindedToday reads
 * to avoid reminding someone twice in a day — and never something the player
 * sets, so it has no place in a settings surface. The sweep owns writing it.
 *
 * EVERY RULE IS IN A `...For` HELPER, never in the wrapper below it.
 * convex-test cannot stand up a Better Auth session (wordle-teams-obw), so a
 * rule written into a mutation body is a rule no test can reach.
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
}

export async function updateReminderTimeFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  time: string,
): Promise<void> {
  // MEMBERSHIP, NOT SHAPE. A shape-only check ('HH:MM:SS' in range) accepts
  // '23:30:00', which lib/reminders.ts's isDueThisHour can never match, because
  // the cron ticks on the hour — the row stores fine, the UI looks right, and
  // that player is silently never reminded, forever, with nothing logged. See
  // REMINDER_TIMES's doc comment.
  if (!REMINDER_TIMES.includes(time)) throw accessError('INVALID_REMINDER_TIME')
  await ctx.db.patch(playerId, { reminderDeliveryTime: time })
}

export async function updateTimeZoneFor(
  ctx: MutationCtx,
  playerId: Id<'players'>,
  timeZone: string,
): Promise<void> {
  // Validated by asking Intl, which is the same thing the sweep will ask every
  // hour. An unresolvable zone stored here does not fail now — it throws inside
  // sweep at 06:00 on a future morning and takes the whole batch with it.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
  } catch {
    throw accessError('INVALID_TIME_ZONE')
  }
  await ctx.db.patch(playerId, { timeZone })
}

/**
 * SET-ONLY. Nothing ever clears hasPwa, so a player who uninstalls the PWA
 * keeps it `true` and the sweep will go on believing push is deliverable to
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

export const updateReminderMethods = mutation({
  args: { methods: v.array(v.string()) },
  handler: async (ctx, { methods }) => {
    const player = await requirePlayer(ctx)
    await updateReminderMethodsFor(ctx, player._id, methods)
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
