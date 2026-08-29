import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema.ts'
import { aPlayer, aTeam } from './fixtures.ts'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

// `sendEmail` is mocked rather than exercised end-to-end through the real
// Resend component: no test in this repo registers that component with
// convex-test (grep confirms it — teams.test.ts drives `invitePlayerFor`
// directly rather than the wrapped mutation for the same reason), and
// email.ts's `sendEmail` throws "API key is not set" the moment it is
// actually called without RESEND_API_KEY. Mocking the module is the same
// move pushSend.test.ts makes for `web-push`: what `sweep` decides — who
// gets claimed, who gets mailed, in what order — has nothing to do with
// real delivery, and mocking `sendEmail` is enough to observe all of it.
vi.mock('./email.ts', () => ({ sendEmail: vi.fn() }))

import { sendEmail } from './email.ts'

const sendEmailMock = vi.mocked(sendEmail)

// 2026-08-27T14:00:00Z is 09:00 in Chicago (CDT, UTC-5) — pinned the same
// way in lib/reminders.test.ts — so a 09:00:00 reminder is due (the upper
// bound of isDueThisHour's window).
const THURSDAY_2PM_UTC = new Date('2026-08-27T14:00:00Z').getTime()
// One hour later: still due, as the LOWER bound of the next tick's window —
// this is the "double match" isDueThisHour's doc comment describes.
const THURSDAY_3PM_UTC = new Date('2026-08-27T15:00:00Z').getTime()
// 2026-08-29T14:00:00Z is 09:00 Chicago on a Saturday.
const SATURDAY_2PM_UTC = new Date('2026-08-29T14:00:00Z').getTime()

const dueChicagoPlayer = (over: Record<string, unknown> = {}) =>
  aPlayer({
    timeZone: 'America/Chicago',
    reminderDeliveryTime: '09:00:00',
    reminderDeliveryMethods: ['email'],
    ...over,
  })

/** A score history that satisfies the ten-day activity gate. */
const recentScores = ['2026-08-24', '2026-08-25', '2026-08-26']

async function seed(
  t: ReturnType<typeof convexTest>,
  playerOver: Record<string, unknown>,
  days: Array<string>,
  teamOver: Record<string, unknown> = {},
): Promise<Id<'players'>> {
  return await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', dueChicagoPlayer(playerOver))
    for (const puzzleDay of days) {
      await ctx.db.insert('dailyScores', { playerId, puzzleDay, date: 0, guesses: ['xxxxx'] })
    }
    await ctx.db.insert('teams', aTeam({ playerIds: [playerId], ...teamOver }))
    return playerId
  })
}

async function lastReminderOf(t: ReturnType<typeof convexTest>, playerId: Id<'players'>) {
  // Reads the WHOLE document from `t.run`, then picks the field off it
  // outside that call, deliberately. `t.run`'s return value crosses the same
  // Convex-value wire boundary a query's return does, and Convex has no
  // `undefined` value — a bare `undefined` returned from `t.run` comes back
  // as `null`, even though the field is genuinely absent on the stored
  // document (confirmed against a raw `ctx.db.get` result). Returning the
  // whole doc sidesteps the coercion: only the field access happens in plain
  // JS, after the boundary, where an absent key really is `undefined`.
  const doc = await t.run(async (ctx) => ctx.db.get(playerId))
  return doc?.lastBoardEntryReminder
}

async function scheduledPushJobs(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    ctx.db.system
      .query('_scheduled_functions')
      .collect()
      .then((rows) => rows.filter((row) => row.name === 'pushSend:deliverTo')),
  )
}

beforeEach(() => {
  sendEmailMock.mockReset()
  sendEmailMock.mockResolvedValue('fake-email-id' as never)
  // The two kill switches default open in tests — REMINDERS_ENABLED true,
  // no allowlist restriction — so each eligibility test isolates the rule it
  // names. The gate-specific describe block below overrides these.
  vi.stubEnv('REMINDERS_ENABLED', 'true')
  vi.stubEnv('REMINDERS_ALLOWLIST', '')
  // vitest.config.ts already sets SITE_URL globally; restated here so the
  // gate tests' `vi.stubEnv('SITE_URL', '')` reads as an override, not a
  // dependency on that config default.
  vi.stubEnv('SITE_URL', 'https://example.com')
})
afterEach(() => vi.unstubAllEnvs())

describe('sweep: eligibility', () => {
  test('claims and enqueues a due player who has not entered today', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, recentScores)

    const result = await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(result).toEqual({ claimed: 1 })
    expect(await lastReminderOf(t, playerId)).toBe(THURSDAY_2PM_UTC)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        from: 'Wordle Teams <reminders@wordleteams.com>',
        to: 'member@example.com',
        // Pins the template wiring at reminders.ts's sendEmail call: the
        // right player's firstName (aPlayer()'s default is 'Ada', not
        // 'Lovelace') reaches boardEntryReminderEmail, and SITE_URL reaches
        // it too — the image URL is built from siteUrl, so this only passes
        // if the stubbed 'https://example.com' actually made it through.
        text: expect.stringContaining('Hello Ada,'),
        html: expect.stringContaining('https://example.com/wordle-teams-title.png'),
      }),
    )
  })

  test('skips a player who already entered today', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, [...recentScores, '2026-08-27'])

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('skips a player already reminded earlier in their local day', async () => {
    const t = convexTest(schema, modules)
    const earlierStamp = new Date('2026-08-27T13:00:00Z').getTime()
    const playerId = await seed(t, { lastBoardEntryReminder: earlierStamp }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBe(earlierStamp)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('skips a player dormant for more than ten days', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, ['2026-08-10'])

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBeUndefined()
  })

  test('on a Saturday, skips a player whose only team does not play weekends', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, ['2026-08-26', '2026-08-27'], { playWeekends: false })

    await t.mutation(internal.reminders.sweep, { now: SATURDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBeUndefined()
  })

  test('on a Saturday, reminds a player on a team that does play weekends', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, ['2026-08-26', '2026-08-27'], { playWeekends: true })

    await t.mutation(internal.reminders.sweep, { now: SATURDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBe(SATURDAY_2PM_UTC)
  })

  test('skips players with no timeZone, regardless of which zone the test host defaults to', async () => {
    // `Intl.DateTimeFormat` with `timeZone: undefined` does NOT throw — it
    // silently falls back to the HOST's own default zone, not the player's
    // (confirmed: `new Intl.DateTimeFormat('en-US', { timeZone: undefined,
    // ... }).formatToParts(new Date('2026-08-27T14:00:00Z'))` resolves to
    // 09:00 on a host defaulting to America/Chicago and to 14:00 on a host
    // defaulting to UTC). So a single seeded reminderDeliveryTime can only
    // ever prove the `!timeZone` guard matters on WHICHEVER zone the test
    // happens to run under — deleting the guard and running this file both
    // as `pnpm exec vitest run` (host TZ) and `TZ=UTC pnpm exec vitest run`
    // showed exactly that: a seed of '09:00:00' caught the guard's removal
    // on a Chicago host and missed it under TZ=UTC (CI's actual
    // environment), the opposite of what a regression test needs. Seeding
    // BOTH the Chicago-matching and the UTC-matching hour makes this test
    // fail under either host: on a Chicago host the first player would
    // wrongly become due, on a UTC host the second would.
    const t = convexTest(schema, modules)
    const chicagoHostId = await seed(
      t,
      { email: 'notz-chicago-host@example.com', timeZone: undefined, reminderDeliveryTime: '09:00:00' },
      recentScores,
    )
    const utcHostId = await seed(
      t,
      { email: 'notz-utc-host@example.com', timeZone: undefined, reminderDeliveryTime: '14:00:00' },
      recentScores,
    )

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, chicagoHostId)).toBeUndefined()
    expect(await lastReminderOf(t, utcHostId)).toBeUndefined()
  })

  test('skips a player with no delivery methods', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, { reminderDeliveryMethods: [] }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBeUndefined()
  })

  test('skips a player whose only delivery method is unknown, e.g. a copied "sms" row', async () => {
    // schema.ts types reminderDeliveryMethods v.array(v.string()) with no
    // membership check, and the Supabase copy passes the column straight
    // through (scripts/copy-from-supabase.mjs), so a row can carry a method
    // that never went through settings.ts's validation. The guard is "has at
    // least one KNOWN method", not "has at least one method" — a nonzero-length
    // array of only unknown methods must be skipped exactly like an empty one,
    // or this player is claimed and nothing is ever sent, silently burning
    // their reminder for the day and inflating `claimed` past the operator's
    // actual delivery count.
    const t = convexTest(schema, modules)
    const playerId = await seed(t, { reminderDeliveryMethods: ['sms'] }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('skips a player who is not due this hour', async () => {
    // Nothing in this file seeds a player whose reminderDeliveryTime simply
    // does not match the swept hour — every other case is either due or
    // filtered by an earlier, cheaper predicate. Deleting the
    // isDueThisHour check entirely (reminders.ts) leaves every eligible
    // player reminded at the first hourly tick of their local day instead of
    // their chosen time, and — because that only happens ONCE a day —
    // alreadyRemindedToday hides it from the double-send tests above
    // entirely. This is the case that actually exercises the check.
    const t = convexTest(schema, modules)
    const playerId = await seed(t, { reminderDeliveryTime: '17:00:00' }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('claims exactly the players who are actually due, one at a time', async () => {
    // No test up to here has asserted the RETURN VALUE of a successful
    // sweep, or claimed more than one player in a single call — so
    // `claimed += 1` silently becoming `claimed += 0`, or the loop stopping
    // after the first candidate, would leave every other assertion in this
    // file green.
    const t = convexTest(schema, modules)
    const firstId = await seed(t, { email: 'first@example.com' }, recentScores)
    const secondId = await seed(t, { email: 'second@example.com' }, recentScores)

    const result = await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(result).toEqual({ claimed: 2 })
    expect(await lastReminderOf(t, firstId)).toBe(THURSDAY_2PM_UTC)
    expect(await lastReminderOf(t, secondId)).toBe(THURSDAY_2PM_UTC)
  })
})

describe('sweep: the ten-day activity window boundary', () => {
  // THURSDAY_2PM_UTC's Chicago local day is 2026-08-27; ten days back is
  // 2026-08-17, inclusive. reminders.ts's `dailyScores` index range and
  // hasRecentActivity's own floor both use `addDays(localDay, -10)` — two
  // independent call sites that have to agree, and no earlier test in this
  // file seeds a score at either edge to prove they do.
  test('a score exactly ten days old still counts as recent activity', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, ['2026-08-17'])

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBe(THURSDAY_2PM_UTC)
  })

  test('a score eleven days old is too old to count', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, ['2026-08-16'])

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBeUndefined()
  })
})

describe('sweep: an unresolvable timeZone does not abort the batch', () => {
  test('a due player is still claimed even though another player has an unresolvable timeZone', async () => {
    // 'GMT+5', not '', deliberately — an empty string is caught earlier by
    // the `!timeZone` check (the "no timeZone" test above) and never reaches
    // localParts at all. 'GMT+5' is TRUTHY, so it passes that check and
    // actually exercises the try/catch: localParts's own doc comment
    // (lib/reminders.ts) names 'GMT+5' as one of the values Intl's
    // constructor rejects with a RangeError, which is exactly the shape a
    // row copied from Supabase — never validated by updateTimeZoneFor — can
    // carry. Without the try/catch, that RangeError propagates out of the
    // `flatMap` callback uncaught, `t.mutation` below rejects, and the good
    // player is never reached either — that failure mode is what this test
    // pins.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const t = convexTest(schema, modules)
    const goodId = await seed(t, {}, recentScores)
    const badId = await seed(t, { email: 'badzone@example.com', timeZone: 'GMT+5' }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, goodId)).toBe(THURSDAY_2PM_UTC)
    expect(await lastReminderOf(t, badId)).toBeUndefined()
    expect(spy).toHaveBeenCalledWith(
      '[reminders] unresolvable timeZone on a player',
      expect.objectContaining({ timeZone: 'GMT+5' }),
      expect.anything(),
    )

    spy.mockRestore()
  })
})

describe('sweep: claim ordering', () => {
  test('a player matching twice in one day — the normal case, not an edge case — is reminded only once', async () => {
    // isDueThisHour's bounds are both inclusive, and the cron ticks on the
    // hour, so a whole-hour-offset player like this one satisfies the upper
    // bound of one tick's window AND the lower bound of the next. Nothing
    // but the stamp `sweep` writes on the first match stops a second email
    // on the second.
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })
    await t.mutation(internal.reminders.sweep, { now: THURSDAY_3PM_UTC })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(await lastReminderOf(t, playerId)).toBe(THURSDAY_2PM_UTC)
  })

  test('claims a player even when sendEmail reports every recipient was suppressed', async () => {
    // sendEmail returns null (not a throw) when its recipient list ends up
    // empty after e2e filtering — a real, non-exceptional outcome. The claim
    // must not be conditioned on that result: it is written unconditionally,
    // before delivery is attempted, precisely so the double-match above
    // stays suppressed regardless of what delivery reports back.
    sendEmailMock.mockResolvedValue(null)
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBe(THURSDAY_2PM_UTC)
  })
})

describe('sweep: the cron clock default', () => {
  test('a sweep called with no `now` still claims a due player, using the current instant', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(THURSDAY_2PM_UTC))
    try {
      const t = convexTest(schema, modules)
      const playerId = await seed(t, {}, recentScores)

      await t.mutation(internal.reminders.sweep, {})

      expect(await lastReminderOf(t, playerId)).toBe(THURSDAY_2PM_UTC)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('sweep: push scheduling', () => {
  test('schedules a push delivery for a due player using push, with the right args', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, { reminderDeliveryMethods: ['push'] }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBe(THURSDAY_2PM_UTC)
    expect(sendEmailMock).not.toHaveBeenCalled()
    const jobs = await scheduledPushJobs(t)
    expect(jobs).toHaveLength(1)
    // The full args, not just the job count: deliverTo bounds its own
    // self-rescheduling retry on `attempt`, so a wrong value here (e.g. an
    // `attempt: 7` typo) would silently disable the one retry the design
    // relies on, and nothing checking only job COUNT would ever notice.
    expect(jobs[0]!.args).toEqual([{ playerId, attempt: 0 }])
  })

  test('schedules a push delivery for each of two push-eligible players, to the right player', async () => {
    // No earlier test seeds two push-eligible players, so nothing would
    // catch a bug that scheduled the wrong playerId, or collapsed two
    // players' jobs into one.
    const t = convexTest(schema, modules)
    const firstId = await seed(
      t,
      { email: 'push-first@example.com', reminderDeliveryMethods: ['push'] },
      recentScores,
    )
    const secondId = await seed(
      t,
      { email: 'push-second@example.com', reminderDeliveryMethods: ['push'] },
      recentScores,
    )

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    const jobs = await scheduledPushJobs(t)
    expect(jobs).toHaveLength(2)
    const scheduledFor = jobs.map((job) => job.args[0] as { playerId: string; attempt: number })
    expect(scheduledFor).toEqual(
      expect.arrayContaining([
        { playerId: firstId, attempt: 0 },
        { playerId: secondId, attempt: 0 },
      ]),
    )
  })

  test('schedules no push delivery for an email-only player', async () => {
    const t = convexTest(schema, modules)
    await seed(t, { reminderDeliveryMethods: ['email'] }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    const jobs = await scheduledPushJobs(t)
    expect(jobs).toHaveLength(0)
  })
})

describe('sweep: the two kill switches', () => {
  test('claims nobody when REMINDERS_ENABLED is unset', async () => {
    // `undefined`, not `''` — this stubs the variable ABSENT, matching every
    // real deployment that has never set it (vi.stubEnv deletes the key when
    // given `undefined`). An empty string is a different, also-off state,
    // covered separately below.
    vi.stubEnv('REMINDERS_ENABLED', undefined)
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, recentScores)

    const result = await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(result).toEqual({ claimed: 0, gated: 'disabled' })
    expect(await lastReminderOf(t, playerId)).toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('claims nobody when REMINDERS_ENABLED is a truthy value that is not exactly \'true\'', async () => {
    // The gate is `!== 'true'`, not a general truthiness check — '1' is the
    // config slip most likely in a hurry (treating the var like a boolean
    // flag), and nothing else pins that the comparison is this strict.
    vi.stubEnv('REMINDERS_ENABLED', '1')
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, recentScores)

    const result = await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(result).toEqual({ claimed: 0, gated: 'disabled' })
    expect(await lastReminderOf(t, playerId)).toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('an unrestricted allowlist (the production default) reminds a due player', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    expect(await lastReminderOf(t, playerId)).toBe(THURSDAY_2PM_UTC)
  })

  test('an allowlisted sweep claims and mails only the listed player, not their due teammate', async () => {
    // Addresses are RFC-reserved example.com throwaways, never a real
    // person's — this repository is public.
    vi.stubEnv('REMINDERS_ALLOWLIST', ' Listed@Example.com , ')
    const t = convexTest(schema, modules)
    const listedId = await seed(t, { email: 'listed@example.com' }, recentScores)
    const unlistedId = await seed(t, { email: 'unlisted@example.com' }, recentScores)

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    // A non-allowlisted player must not be claimed at all — claiming without
    // delivering would burn that player's one reminder for the day silently.
    expect(await lastReminderOf(t, listedId)).toBe(THURSDAY_2PM_UTC)
    expect(await lastReminderOf(t, unlistedId)).toBeUndefined()
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.anything(),
      // The listed player's own mail, not a generic call — the deeper
      // template-wiring pin (firstName, siteUrl) lives on the eligibility
      // test above; this just confirms it is THIS player's content.
      expect.objectContaining({ to: 'listed@example.com', text: expect.stringContaining('Hello Ada,') }),
    )
  })

  test('the allowlist gates push scheduling exactly like it gates email', async () => {
    vi.stubEnv('REMINDERS_ALLOWLIST', 'listed@example.com')
    const t = convexTest(schema, modules)
    await seed(
      t,
      { email: 'unlisted@example.com', reminderDeliveryMethods: ['push'] },
      recentScores,
    )

    await t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })

    const jobs = await scheduledPushJobs(t)
    expect(jobs).toHaveLength(0)
  })
})

describe('sweep: the SITE_URL guard', () => {
  test('a due player is not claimed when SITE_URL is unset', async () => {
    // `undefined`, not `''` — deletes the key, matching the real unset case.
    // vitest.config.ts's global SITE_URL default means this test is the only
    // place that value has to be actively removed rather than overridden.
    vi.stubEnv('SITE_URL', undefined)
    const t = convexTest(schema, modules)
    const playerId = await seed(t, {}, recentScores)

    await expect(t.mutation(internal.reminders.sweep, { now: THURSDAY_2PM_UTC })).rejects.toThrow(
      /SITE_URL/,
    )

    expect(await lastReminderOf(t, playerId)).toBeUndefined()
    expect(sendEmailMock).not.toHaveBeenCalled()
  })
})
