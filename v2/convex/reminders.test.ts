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
import { reschedulePlayerReminderFor, scheduleNextFor } from './reminders.ts'

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
afterEach(() => {
  vi.unstubAllEnvs()
  // The console spies below restore themselves on the happy path only, and
  // vitest.config.ts does not set `restoreMocks`. Without this, one failing
  // assertion leaks a stubbed `console` into every test after it in the file.
  vi.restoreAllMocks()
})

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

describe('scheduleNextFor', () => {
  test('schedules the next occurrence and records both the id and the instant', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: true })),
    )

    const from = new Date('2026-09-11T14:00:01Z').getTime() // just after 09:00 Chicago
    await t.run(async (ctx) => {
      await scheduleNextFor(ctx, playerId, from)
    })

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(new Date('2026-09-12T14:00:00Z').getTime())
    expect(player?.reminderJobId).toBeDefined()

    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe('reminders:deliver')
    // THE ARGS CARRY dueAt, AND IT MATCHES THE ROW. This is the whole staleness
    // mechanism; a job scheduled without it could never tell it was superseded.
    expect(jobs[0].args[0]).toEqual({ playerId, dueAt: player?.nextReminderAt })
    // AND IT ACTUALLY FIRES THEN, which is the one thing this whole epic is
    // about and the one thing every other assertion here misses. Mutate the
    // `runAt` instant alone and the row, the args and deliver's equality check
    // all still agree with each other — the reminder simply arrives at the
    // wrong time, silently. convex-test stores `scheduledTime` as
    // `tsInSecs * 1000` (dist/index.js:1085), so this is exact for the
    // whole-second instants REMINDER_TIMES can produce.
    expect(jobs[0].scheduledTime).toBe(player?.nextReminderAt)
  })

  test('does not schedule a player with no timeZone', async () => {
    // A copied row can have none, and there is no zone to compute an occurrence
    // in. updateTimeZoneFor schedules them the moment they get one.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ timeZone: undefined })),
    )

    await t.run((ctx) => scheduleNextFor(ctx, playerId, Date.now()))

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBeUndefined()
    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs).toHaveLength(0)
  })

  test('does not schedule a player whose timeZone is unresolvable', async () => {
    // updateTimeZoneFor rejects these, but a row copied from Supabase never
    // passed through it. One bad row must not take a batch down, so this is
    // swallowed and logged rather than thrown — the same rule the sweep had.
    const t = convexTest(schema, modules)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ timeZone: 'GMT+5' })),
    )

    await t.run((ctx) => scheduleNextFor(ctx, playerId, Date.now()))

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBeUndefined()
    // BOTH, or a version that schedules the job and then fails to patch the row
    // passes too — the sibling no-timeZone test above makes the same pair.
    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs).toHaveLength(0)
    // AND IT SAID SO. This is the only signal that a copied row carries a zone
    // ICU rejects, and `maintain` will hit it once a day per bad row forever.
    // Asserted rather than left to the spy, because the spy that keeps this
    // test quiet also hides the log's removal: measured, deleting the
    // console.error and keeping the early return left the whole suite green.
    expect(spy).toHaveBeenCalledWith(
      '[reminders] cannot compute a next occurrence for a player',
      expect.objectContaining({ playerId, timeZone: 'GMT+5' }),
      expect.anything(),
    )
  })

  test('treats an absent playsWeekends as false', async () => {
    // Absent means "not yet derived". False is the safe reading: it suppresses a
    // weekend reminder rather than sending one to a weekday-only team.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: undefined })),
    )

    // 2026-09-11 is a Friday; 14:00:01Z is just after 09:00 Chicago.
    await t.run((ctx) =>
      scheduleNextFor(ctx, playerId, new Date('2026-09-11T14:00:01Z').getTime()),
    )

    const player = await t.run((ctx) => ctx.db.get(playerId))
    // Monday, not Saturday.
    expect(player?.nextReminderAt).toBe(new Date('2026-09-14T14:00:00Z').getTime())
  })

  test('leaves the previous job alone rather than cancelling it', async () => {
    // THE MISSING CANCEL IS THE POINT, and this is the only thing that pins it.
    // `deliver` (Task 5) calls scheduleNextFor to schedule tomorrow, and at that
    // moment reminderJobId is the id of the job RUNNING RIGHT NOW — Convex
    // documents cancel as able to fail once a job has committed, so cancelling
    // yourself is pointless at best. Add a cancel here and every other test in
    // this file still passes; only this one notices.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: true })),
    )

    const from = new Date('2026-09-11T14:00:01Z').getTime()
    await t.run((ctx) => scheduleNextFor(ctx, playerId, from))
    const first = await t.run((ctx) => ctx.db.get(playerId))
    await t.run((ctx) => scheduleNextFor(ctx, playerId, from))
    const second = await t.run((ctx) => ctx.db.get(playerId))

    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    // BOTH HALVES, or this passes vacuously: the second call really did
    // schedule a second job (two jobs, a new id on the row) AND the first is
    // still pending rather than canceled. Assert only the second half and a
    // scheduleNextFor that had quietly become a no-op would satisfy it.
    expect(jobs).toHaveLength(2)
    expect(second?.reminderJobId).not.toBe(first?.reminderJobId)
    const byId = new Map(jobs.map((j) => [j._id, j]))
    expect(byId.get(first!.reminderJobId!)?.state.kind).toBe('pending')
    expect(byId.get(second!.reminderJobId!)?.state.kind).toBe('pending')
  })

  // THE OBSERVABILITY CHECK (added from Task 1's code-quality review; not in
  // the plan's text). instantForLocal returns its guess unverified after four
  // probe rounds, and for a wall clock a spring-forward erased there is no
  // correct answer — the round count's parity picks the instant just before
  // the gap, an hour early. That is accepted; what was missing was NOTICING.
  // These two tests are what stop the check being deleted as redundant.
  describe('the wall-clock resolve-back warning', () => {
    test('warns when the scheduled instant lands an hour early on an erased wall clock', async () => {
      // Pacific/Easter's spring-forward erases 22:00-22:59 local on
      // 2026-09-05, and '22:00:00' is one of the eighteen REMINDER_TIMES.
      // MEASURED: instantForLocal('Pacific/Easter', '2026-09-05', '22:00:00')
      // returns 2026-09-06T03:00:00Z, which resolves back to 21:00:00 local.
      const t = convexTest(schema, modules)
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const playerId = await t.run(async (ctx) =>
        ctx.db.insert(
          'players',
          // playsWeekends, because 2026-09-05 is a Saturday — without it the
          // probe would skip straight to Monday and there would be nothing to
          // notice.
          dueChicagoPlayer({
            timeZone: 'Pacific/Easter',
            reminderDeliveryTime: '22:00:00',
            playsWeekends: true,
          }),
        ),
      )

      // Just after 22:00 local on 2026-09-04, so the next occurrence is the
      // erased one.
      await t.run((ctx) =>
        scheduleNextFor(ctx, playerId, new Date('2026-09-05T04:00:01Z').getTime()),
      )

      const player = await t.run((ctx) => ctx.db.get(playerId))
      // STILL SCHEDULED. An hour early once a year beats no reminder that day,
      // which is what making this check throw or skip would cause.
      expect(player?.nextReminderAt).toBe(new Date('2026-09-06T03:00:00Z').getTime())
      expect(spy).toHaveBeenCalledWith(
        '[reminders] scheduled instant does not resolve back to the requested wall clock',
        expect.objectContaining({
          playerId,
          timeZone: 'Pacific/Easter',
          requested: '22:00:00',
          resolved: '21:00:00',
        }),
      )
      spy.mockRestore()
    })

    test('says nothing on an ordinary day', async () => {
      const t = convexTest(schema, modules)
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const playerId = await t.run(async (ctx) =>
        ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: true })),
      )

      await t.run((ctx) =>
        scheduleNextFor(ctx, playerId, new Date('2026-09-11T14:00:01Z').getTime()),
      )

      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})

describe('reschedulePlayerReminderFor', () => {
  test('schedules the new job and cancels the previous one on success', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: true })),
    )

    const from = new Date('2026-09-11T14:00:01Z').getTime()
    await t.run((ctx) => scheduleNextFor(ctx, playerId, from))
    const first = await t.run((ctx) => ctx.db.get(playerId))

    await t.run((ctx) => reschedulePlayerReminderFor(ctx, playerId, from))
    const second = await t.run((ctx) => ctx.db.get(playerId))

    expect(second?.reminderJobId).not.toBe(first?.reminderJobId)

    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    const byId = new Map(jobs.map((j) => [j._id, j]))
    expect(byId.get(first!.reminderJobId!)?.state.kind).toBe('canceled')
    expect(byId.get(second!.reminderJobId!)?.state.kind).toBe('pending')
  })

  test('leaves the old job and the row alone when it cannot reschedule', async () => {
    // CANCEL-THEN-BAIL WAS A REAL DEFECT, and this is what pins the fix. The
    // old shape cancelled first and then delegated, so when scheduleNextFor
    // returned without touching the row, reminderJobId named a CANCELED job
    // while nextReminderAt still held a future instant. Task 6's health
    // predicate is `nextReminderAt !== undefined && nextReminderAt > now`, so
    // maintain read that row as HEALTHY and skipped it until the stale instant
    // passed. The row lied, and the row being the source of truth is the
    // invariant the whole design rests on.
    const t = convexTest(schema, modules)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: true })),
    )
    const from = new Date('2026-09-11T14:00:01Z').getTime()
    await t.run((ctx) => scheduleNextFor(ctx, playerId, from))
    const before = await t.run((ctx) => ctx.db.get(playerId))

    // The zone becomes unusable AFTER a chain exists — the cutover copy
    // overwriting timeZone is the plausible route to this in production.
    await t.run((ctx) => ctx.db.patch(playerId, { timeZone: 'GMT+5' }))
    await t.run((ctx) => reschedulePlayerReminderFor(ctx, playerId, from))

    const after = await t.run((ctx) => ctx.db.get(playerId))
    // The row is untouched: same job id, same instant. It is not lying.
    expect(after?.reminderJobId).toBe(before?.reminderJobId)
    expect(after?.nextReminderAt).toBe(before?.nextReminderAt)

    // And the old job is still PENDING, so the existing chain keeps running and
    // self-repairs. Cancelling it would have left this player with no reminder
    // at all AND a row claiming one was pending.
    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs).toHaveLength(1)
    expect(jobs[0].state.kind).toBe('pending')
    expect(jobs[0]._id).toBe(before?.reminderJobId)

    // The bad zone is still reported, exactly as it is on the scheduleNextFor
    // path — bailing out quietly here would hide the one thing a human has to
    // look at.
    expect(spy).toHaveBeenCalledWith(
      '[reminders] cannot compute a next occurrence for a player',
      expect.objectContaining({ playerId, timeZone: 'GMT+5' }),
      expect.anything(),
    )
  })

  test('still schedules when cancel throws', async () => {
    // THIS IS UNREACHABLE THROUGH THE HARNESS. convex-test's cancel_job patches
    // state to 'canceled' unconditionally from any state and never throws
    // (node_modules/convex-test/dist/index.js:1166), while the real backend
    // documents cancel as able to fail once a job has committed. So the only way
    // to reach the catch is to inject a throwing scheduler — which is possible
    // ONLY because this rule lives in a ...For helper taking MutationCtx rather
    // than in a mutation body.
    const t = convexTest(schema, modules)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert('players', dueChicagoPlayer({ playsWeekends: true })),
    )
    const from = new Date('2026-09-11T14:00:01Z').getTime()
    await t.run((ctx) => scheduleNextFor(ctx, playerId, from))
    // Captured BEFORE the reschedule: this is the id the failed cancel was for,
    // and so the id the warning has to name.
    const stale = await t.run((ctx) => ctx.db.get(playerId))

    await t.run(async (ctx) => {
      const hostile = {
        ...ctx,
        db: ctx.db,
        scheduler: {
          runAt: ctx.scheduler.runAt.bind(ctx.scheduler),
          runAfter: ctx.scheduler.runAfter.bind(ctx.scheduler),
          cancel: () => Promise.reject(new Error('job already completed')),
        },
      } as unknown as Parameters<typeof reschedulePlayerReminderFor>[0]
      await reschedulePlayerReminderFor(hostile, playerId, from)
    })

    const player = await t.run((ctx) => ctx.db.get(playerId))
    // The new job exists despite the cancel failing. The old one is left
    // pending, and harmlessly so: it carries the old dueAt and will retire.
    expect(player?.nextReminderAt).toBe(new Date('2026-09-12T14:00:00Z').getTime())
    expect(player?.reminderJobId).toBeDefined()

    // AND IT SAID SO. This warning is the ONLY observable trace a cancel ever
    // failed in production — the job it could not cancel is left pending and
    // retires silently, so nothing else would ever reveal that the best-effort
    // cancel is failing. Asserted here rather than left to the spy above,
    // because a spy that swallows the call also hides its removal: measured,
    // replacing the console.warn with `void error` leaves every other test in
    // this file green.
    expect(spy).toHaveBeenCalledWith(
      '[reminders] could not cancel a pending reminder job; it will retire on its own',
      expect.objectContaining({ playerId, reminderJobId: stale!.reminderJobId }),
      expect.anything(),
    )
    spy.mockRestore()
  })
})

describe('deliver', () => {
  // 2026-09-11T14:00:00Z is 09:00 Chicago (CDT, UTC-5) on a Friday, so it is
  // the instant a 09:00:00 reminder is due for dueChicagoPlayer.
  const DUE = new Date('2026-09-11T14:00:00Z').getTime()
  // The same wall clock on the next Saturday and the next Monday.
  const SATURDAY = new Date('2026-09-12T14:00:00Z').getTime()
  const MONDAY = new Date('2026-09-14T14:00:00Z').getTime()

  // THE CLOCK IS PINNED, and this block cannot be made deterministic without
  // it. `deliver` takes no `now` argument the way `sweep` does — it reads
  // `Date.now()`, which in production is the instant the scheduler fired it —
  // and every assertion below depends on that instant: the local day the two
  // `dailyScores` lookups are asked about, and the `from` the reschedule
  // computes the next occurrence after. Pinned to DUE exactly, rather than a
  // moment after it, because that is nextOccurrence's strictly-after case: the
  // job runs at the instant it was due, so the occurrence it computes must be
  // the NEXT one and not the one it is currently serving.
  //
  // They also make it impossible for the job this handler schedules to run.
  // convex-test fires a scheduled function from `setTimeout(..., max(0, ts -
  // Date.now()))` (its `1.0/schedule` syscall), so the next reminder's ~24h
  // delay would not elapse mid-test under real timers either — but with the
  // clock frozen it cannot elapse at all, which is the difference between "did
  // not happen" and "cannot". Nothing here advances timers, and nothing here
  // calls `finishAllScheduledFunctions`: it pumps timers up to `maxIterations`
  // (100, convex-test 0.0.54) and then throws "too many iterations", so against
  // a self-rescheduling chain it fails rather than settles.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(DUE))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // MOST TESTS IN THIS BLOCK ARE THE ONLY KILLER OF WHAT THEY TEST, and Task 7
  // edits this same file to delete the sweep's suites. Removing or loosening
  // one of them unguards a property with nothing else noticing.
  //
  // MEASURED: of the twenty mutants run against `deliver` while it was built,
  // NINE had exactly one killing test — the exact `!==` versus a tolerance,
  // the unresolvable-zone log COUNT (one `toHaveBeenCalledTimes(1)` line), a
  // late-fire instant, each of the two activity-window edges, the
  // 'true'-not-truthy comparison, the player's local day versus UTC's, a
  // yesterday stamp, and both delivery methods at once. Two more had two
  // killers each, one of which was the structural guard below.
  //
  // An earlier version of this note said three, and then ten. Both were wrong,
  // and a hand-kept list is the wrong instrument regardless — it goes stale the
  // moment a test is added, which is the failure mode this whole change keeps
  // running into. So: each test's OWN comment is authoritative about what only
  // it catches, and the structural guard at the end of this block covers,
  // automatically, the subset of those properties that maps to a distinct
  // `reason`.
  //
  // None of this is a coverage gap. Each is the single input shape its property
  // is visible in.

  // NOT `recentScores`. That constant is anchored to the sweep's late-August
  // `now`; activityFloor('2026-09-11') is '2026-09-01', so all three of its
  // days fall outside the window DUE is in. MEASURED: seeding `recentScores`
  // here puts the happy-path player on the `inactive` branch instead.
  const scoresBeforeDue = ['2026-09-08', '2026-09-09', '2026-09-10']

  // EVERY OUTCOME `deliver` CAN RETURN, DECLARED ONCE. The last test in this
  // block asserts that the tests between here and it observed all eleven, and
  // it is the structural half of the Task 7 warning above: a comment cannot
  // survive an edit by someone who does not read it, but this fails the build.
  // It catches BOTH directions — a test deleted (which is what Task 7 does to
  // this file) and a branch added without one. At the time it was written,
  // three of the eleven had no test at all: 'no-player', 'no-time-zone' and
  // 'no-method', and the handler's doc comment made specific claims about two
  // of them that were therefore unmeasured.
  const REASONS = [
    'no-player',
    'superseded',
    'disabled',
    'no-time-zone',
    'no-method',
    'not-allowlisted',
    'bad-time-zone',
    'already-reminded',
    'already-entered',
    'inactive',
    'sent',
  ] as const
  const observed = new Set<string>()

  /**
   * Call `deliver` and record which outcome it reported.
   *
   * Every call in this block goes through here rather than `t.mutation`
   * directly, so that the coverage assertion cannot be satisfied by a test
   * that stopped exercising the branch it is named for.
   */
  async function deliverFor(
    t: ReturnType<typeof convexTest>,
    args: { playerId: Id<'players'>; dueAt: number },
  ) {
    const result = await t.mutation(internal.reminders.deliver, args)
    observed.add(result.reason)
    return result
  }

  /** Puts a player on the schedule with `nextReminderAt === DUE`. */
  async function scheduled(
    t: ReturnType<typeof convexTest>,
    over: Record<string, unknown> = {},
    days: Array<string> = scoresBeforeDue,
  ) {
    const playerId = await seed(t, { playsWeekends: true, ...over }, days)
    await t.run((ctx) => ctx.db.patch(playerId, { nextReminderAt: DUE }))
    return playerId
  }

  test('delivers to a player whose job matches the row, and reschedules', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.delivered).toBe(true)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBe(DUE)
    // Rescheduled to Saturday: this player plays weekends.
    expect(player?.nextReminderAt).toBe(SATURDAY)
    // AND A JOB ACTUALLY EXISTS FOR IT, at that instant, carrying that instant
    // in its args — the row agreeing with itself is not enough, because the
    // whole chain is the job.
    const jobs = await t.run((ctx) =>
      ctx.db.system
        .query('_scheduled_functions')
        .collect()
        .then((rows) => rows.filter((row) => row.name === 'reminders:deliver')),
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0].scheduledTime).toBe(SATURDAY)
    expect(jobs[0].args[0]).toEqual({ playerId, dueAt: SATURDAY })
  })

  test('a job that fires late stamps the instant it ran, not the one it was due', async () => {
    // THE ONLY TEST THAT SEPARATES `Date.now()` FROM `dueAt`. Every other case
    // in this block pins the clock to DUE exactly, which makes the two equal —
    // so a `const now = dueAt` mutant survived all of them (measured), and that
    // one substitution unpins the local day both `dailyScores` lookups ask
    // about, the `from` the reschedule computes, and this stamp at once.
    //
    // Three hours, chosen to stay inside the player's local day: DUE is 09:00
    // Chicago, so this runs at 12:00 the same Friday. The lag that crosses
    // local midnight is a different question, and a deliberately open one —
    // wordle-teams-2og8.11 owns the decision about resolving the day from
    // `dueAt` instead, and pinning it here would prejudge it.
    const LATE = DUE + 3 * 60 * 60 * 1000
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)
    vi.setSystemTime(new Date(LATE))

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.delivered).toBe(true)
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBe(LATE)
    // Still Saturday: the next occurrence is computed from the later instant,
    // and 12:00 Friday is still before it.
    expect(player?.nextReminderAt).toBe(SATURDAY)
  })

  // THE STALENESS GUARD. This is the property that makes a failed cancel
  // harmless, so it is asserted from both directions.
  test('a superseded job delivers nothing and reschedules nothing', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)
    // The player moved their reminder after this job was created.
    const moved = DUE + 60 * 60 * 1000
    await t.run((ctx) => ctx.db.patch(playerId, { nextReminderAt: moved }))

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('superseded')
    expect(sendEmailMock).not.toHaveBeenCalled()

    const player = await t.run((ctx) => ctx.db.get(playerId))
    // Untouched: no claim stamp, and the newer schedule still stands.
    expect(player?.lastBoardEntryReminder).toBeUndefined()
    expect(player?.nextReminderAt).toBe(moved)
  })

  test('a job one second off the row is superseded, not close enough', async () => {
    // THE COMPARISON IS EXACT, and a tolerance would be indistinguishable from
    // it under the hour-sized move above. Not in the plan's list; added because
    // a `Math.abs(...) > 60_000` mutant survived every other test in this
    // block. Every instant on either side comes from instantForLocal, so the
    // two agree to the millisecond or the job is not this row's job.
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    const result = await deliverFor(t, { playerId, dueAt: DUE - 1000 })

    expect(result.reason).toBe('superseded')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(DUE)
  })

  test('a job for a player with no pending schedule at all is superseded', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t, { playsWeekends: true }, scoresBeforeDue)

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('superseded')
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  // RESCHEDULES EVEN WHEN IT DELIVERS NOTHING. Every one of these cases would
  // otherwise end that player's chain permanently.
  test('reschedules when the kill switch is off', async () => {
    // Keeping REMINDERS_ENABLED at DELIVERY rather than at scheduling is what
    // makes the launch-day env change free. But it means the flag being off
    // must not break the chain: if this did not reschedule, turning reminders
    // off would strand all 393 players and turning them back on would need a
    // full re-bootstrap.
    vi.stubEnv('REMINDERS_ENABLED', '')
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('disabled')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(SATURDAY)
    // NOT claimed: the stamp means "reminded today", and nobody was.
    expect(player?.lastBoardEntryReminder).toBeUndefined()
  })

  test('reschedules when today is already entered', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, {}, [...scoresBeforeDue, '2026-09-11'])

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('already-entered')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(SATURDAY)
  })

  test('reschedules when the player has not played in ten days', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, {}, ['2026-08-01'])

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('inactive')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(SATURDAY)
  })

  // BOTH EDGES OF THE ACTIVITY WINDOW, PINNED THROUGH `deliver`. The test above
  // seeds a board 41 days out, which any plausible off-by-one still calls
  // inactive; lib/reminders.test.ts pins activityFloor itself, but nothing
  // pinned the range this handler actually builds from it.
  test('a board exactly on the activity floor still counts as active', async () => {
    // activityFloor('2026-09-11') is '2026-09-01' — ten days back, inclusive of
    // the tenth, which is v1's rule. A `gte` -> `gt` on that bound makes this
    // player inactive.
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, {}, ['2026-09-01'])

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.delivered).toBe(true)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  test('a board dated after the local day does not count as activity', async () => {
    // THE UPPER BOUND IS NOT DECORATION. The sweep's range was
    // [floor, localDay]; dropping the `lte` here would have been a silent
    // widening, because a row dated in the player's future is reachable — a
    // timeZone moved backwards after a board was entered produces one — and
    // `.first()` on an open-ended range would find it and call this player
    // active with nothing inside the window at all.
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, {}, ['2026-09-20'])

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('inactive')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(SATURDAY)
  })

  test('reschedules when the player is not on the allowlist', async () => {
    vi.stubEnv('REMINDERS_ALLOWLIST', 'someone@else.test')
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('not-allowlisted')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(SATURDAY)
  })

  test('claims before delivering, so a duplicate job cannot double-send', async () => {
    // The sweep claimed unconditionally because both bounds of its hour window
    // were inclusive, which made double-matching the NORMAL case. Exact
    // scheduling removes that — but a duplicate job can still exist (a repair
    // racing a settings change), so the guard keeps its original job.
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    await deliverFor(t, { playerId, dueAt: DUE })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)

    // Replay the same job against the same instant.
    await t.run((ctx) => ctx.db.patch(playerId, { nextReminderAt: DUE }))
    const replay = await deliverFor(t, { playerId, dueAt: DUE })

    expect(replay.reason).toBe('already-reminded')
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    // And the replay still put the chain back, as every non-superseded path
    // must.
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(SATURDAY)
  })

  test('claims even when sendEmail reports every recipient was suppressed', async () => {
    // sendEmail returns null (not a throw) when its recipient list ends up
    // empty after e2e filtering. Not in the plan's list; added because the
    // claim's own comment says conditioning it on the send result reopens the
    // double-send, and this is the only test here that puts an email player
    // through a send reporting nothing delivered. (The mutant actually run also
    // tripped the push test, because conditioning the claim moved it inside the
    // email branch; a conditional that left the claim above the branches would
    // have had only this test to answer to.) The sibling sweep test
    // 'claims a player even when sendEmail reports every recipient was
    // suppressed' pins the same rule for the code this replaces.
    sendEmailMock.mockResolvedValue(null)
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    await deliverFor(t, { playerId, dueAt: DUE })

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBe(DUE)
  })

  test('enqueues a push when push is a chosen method', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, { reminderDeliveryMethods: ['push'] })

    await deliverFor(t, { playerId, dueAt: DUE })

    expect(sendEmailMock).not.toHaveBeenCalled()
    const jobs = await scheduledPushJobs(t)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].args[0]).toEqual({ playerId, attempt: 0 })
    // A push-only player is claimed too — the claim sits above both delivery
    // branches, not inside the email one.
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBe(DUE)
  })

  test('throws when SITE_URL is missing, so nobody is claimed', async () => {
    // Throwing rolls the whole transaction back — no claim, no reschedule — and
    // `maintain` puts the chain back once the deployment is fixed.
    //
    // `undefined`, not `''` — vi.stubEnv deletes the key, which is the real
    // unset case, and vitest.config.ts's global SITE_URL default makes this the
    // only place the value has to be actively removed rather than overridden.
    // Matched to the sweep's own SITE_URL test on purpose: after Task 7 deletes
    // that one, nothing else exercises the absent shape.
    vi.stubEnv('SITE_URL', undefined)
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)

    // Not routed through `deliverFor`: it throws, so there is no reason to
    // record. That is why 'sent' is observed by the happy path rather than
    // here.
    await expect(
      t.mutation(internal.reminders.deliver, { playerId, dueAt: DUE }),
    ).rejects.toThrow(/SITE_URL/)

    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBeUndefined()
    // The reschedule went back with it: the row still expects the instant this
    // job was for, which is what leaves the chain to `maintain` rather than to
    // a half-applied transaction.
    expect(player?.nextReminderAt).toBe(DUE)
  })

  test('does not schedule a weekend reminder for a weekday-only player', async () => {
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, { playsWeekends: false })

    await deliverFor(t, { playerId, dueAt: DUE })

    const player = await t.run((ctx) => ctx.db.get(playerId))
    // Friday delivery, so the next is Monday.
    expect(player?.nextReminderAt).toBe(MONDAY)
  })

  test('an unresolvable timeZone retires the job without rescheduling, and says so', async () => {
    // NOT IN THE PLAN — added from wordle-teams-2og8.5's notes. 'GMT+5', not
    // '': an empty string is falsy and never reaches localParts, while 'GMT+5'
    // is truthy, passes that check, and is one of the values lib/reminders.ts's
    // documented precondition names as rejected by Intl's constructor. That is
    // the shape a row copied from Supabase carries.
    //
    // NOT RESCHEDULING IS THE CORRECT OUTCOME HERE, and the assertion on
    // nextReminderAt is what stops a future edit turning it into a loop:
    // nextOccurrence resolves the same zone, so scheduleNextFor could only log
    // a second time and return false. The chain ends and the daily maintenance
    // pass retries this row every day — self-limiting and visible, which is the
    // right failure for a row nobody can schedule.
    const t = convexTest(schema, modules)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const playerId = await scheduled(t, { timeZone: 'GMT+5' })

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('bad-time-zone')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBeUndefined()
    expect(player?.nextReminderAt).toBe(DUE)
    // Asserted rather than left to the spy, for the reason the sibling
    // scheduleNextFor test gives: the spy that keeps this test quiet would also
    // hide the log's removal.
    expect(spy).toHaveBeenCalledWith(
      '[reminders] unresolvable timeZone on a player',
      expect.objectContaining({ playerId, timeZone: 'GMT+5' }),
      expect.anything(),
    )
    // EXACTLY ONCE, which is the only thing that can tell this branch from one
    // that reschedules. A `skipAndReschedule('bad-time-zone')` mutant leaves
    // nextReminderAt at DUE anyway — scheduleNextFor resolves the same bad zone
    // and returns false without touching the row — so the assertion above it
    // cannot see the difference. The second log line can (measured).
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // THE THREE GATE BEHAVIOURS THE SWEEP PINS AND `deliver` DID NOT. Task 7
  // deletes the sweep suites from this file on the premise that these are
  // re-asserted here; they were not, so they are now. Each has a live cutover
  // consequence, which is why they are not merely symmetry.
  describe('the two kill switches, ported', () => {
    test('an allowlist with whitespace and mixed case still reaches the listed player', async () => {
      // THE POSITIVE CASE, which the non-match test cannot cover: a mutant that
      // drops the `allowsAddress` check — rejecting EVERYONE whenever a list is
      // set — satisfies the negative test perfectly. So do mutants dropping
      // `.trim()` or `.toLowerCase()`, because this is the shape an operator
      // actually types into a dashboard field. The failure mode is not an
      // error: it is every reminder silently not being sent, and beta runs with
      // exactly one address on this list today.
      //
      // Addresses are RFC-reserved example.com throwaways, never a real
      // person's — this repository is public.
      vi.stubEnv('REMINDERS_ALLOWLIST', ' Listed@Example.com , ')
      const t = convexTest(schema, modules)
      const playerId = await scheduled(t, { email: 'listed@example.com' })

      const result = await deliverFor(t, { playerId, dueAt: DUE })

      expect(result.delivered).toBe(true)
      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ to: 'listed@example.com' }),
      )
    })

    test("REMINDERS_ENABLED is compared to 'true' exactly, not for truthiness", async () => {
      // '1' is the config slip most likely in a hurry — treating the variable
      // like a boolean flag. The kill-switch test above stubs '', which a plain
      // truthiness mutant also rejects, so nothing there pins the strictness of
      // the comparison. This gate is what stands between a config slip and
      // mailing real people on beta.
      vi.stubEnv('REMINDERS_ENABLED', '1')
      const t = convexTest(schema, modules)
      const playerId = await scheduled(t)

      const result = await deliverFor(t, { playerId, dueAt: DUE })

      expect(result.reason).toBe('disabled')
      expect(sendEmailMock).not.toHaveBeenCalled()
      // Still rescheduled: an operator setting the flag wrongly must not also
      // end every chain.
      const player = await t.run((ctx) => ctx.db.get(playerId))
      expect(player?.nextReminderAt).toBe(SATURDAY)
    })
  })

  test('a player whose only delivery method is unknown is skipped, e.g. a copied "sms" row', async () => {
    // `reminderDeliveryMethods` is an unvalidated `v.array(v.string())` and a
    // copied Supabase row never passed through the settings validator. Claiming
    // this player and then matching no delivery branch would burn their one
    // reminder for the day in silence. The rule itself is tested in
    // lib/reminders.test.ts's hasKnownMethod; this pins that `deliver` applies
    // it, and reschedules anyway.
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, { reminderDeliveryMethods: ['sms'] })

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('no-method')
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(await scheduledPushJobs(t)).toHaveLength(0)
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(SATURDAY)
  })

  test('a job for a deleted player retires quietly', async () => {
    // The normal outcome of a delete racing a pending job. Nothing is wrong, so
    // nothing is logged — see the log ladder on scheduleNextFor — and there is
    // no row to reschedule for either.
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)
    await t.run((ctx) => ctx.db.delete(playerId))

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('no-player')
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  test('a player with no timeZone is skipped, and the skip schedules nothing', async () => {
    // THE DOC COMMENT'S CLAIM, MEASURED. This path does call
    // skipAndReschedule, but scheduleNextFor gates on timeZone and returns
    // false without touching the row — so "it reschedules on every eligibility
    // path" is true of the call and not of the effect, and this is the only
    // test that shows the difference. The chain is left to `maintain`.
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, { timeZone: undefined })

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('no-time-zone')
    expect(sendEmailMock).not.toHaveBeenCalled()
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(DUE)
    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
    expect(jobs).toHaveLength(0)
  })

  test("the local day is the player's, not UTC's", async () => {
    // THE FIXTURE BLIND SPOT. Every other test in this block runs an
    // America/Chicago player at an hour where their local day and the UTC day
    // are the same string, so `local.day` — which feeds `eq('puzzleDay',
    // local.day)` and `activityFloor(local.day)` — was never distinguished from
    // a UTC-derived day, and a mutant resolving it in UTC survived all
    // seventeen (measured). Same class as `const now = dueAt`.
    //
    // 05:00 Tokyo on Saturday 2026-09-12 is 20:00 UTC on FRIDAY 2026-09-11, so
    // the two days differ. The board is seeded on the LOCAL day, and a
    // '2026-09-10' board is seeded too so that the UTC reading does not merely
    // report a different skip: it finds no board for '2026-09-11', finds the
    // 10th inside its activity window, and DELIVERS.
    const DUE_TOKYO = new Date('2026-09-11T20:00:00Z').getTime()
    const t = convexTest(schema, modules)
    const playerId = await scheduled(
      t,
      { timeZone: 'Asia/Tokyo', reminderDeliveryTime: '05:00:00' },
      ['2026-09-10', '2026-09-12'],
    )
    await t.run((ctx) => ctx.db.patch(playerId, { nextReminderAt: DUE_TOKYO }))
    vi.setSystemTime(new Date(DUE_TOKYO))

    const result = await deliverFor(t, { playerId, dueAt: DUE_TOKYO })

    expect(result.reason).toBe('already-entered')
    expect(sendEmailMock).not.toHaveBeenCalled()
    // And the reschedule resolved the local day too: 05:00 Tokyo on Sunday the
    // 13th, which is 20:00 UTC on Saturday the 12th.
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.nextReminderAt).toBe(new Date('2026-09-12T20:00:00Z').getTime())
  })

  test('a player reminded yesterday is reminded again today', async () => {
    // THE PRODUCTION STEADY STATE, and nothing else covered it: every other
    // test here has an absent or same-day stamp, while in production every
    // delivery after a player's FIRST carries yesterday's. Measured: replacing
    // alreadyRemindedToday(...) with `lastBoardEntryReminder !== undefined`
    // passes the rest of this block, and its live behaviour is "each player
    // receives exactly one reminder, ever".
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t)
    // 09:00 Chicago on 2026-09-10 — a real instant on the previous local day,
    // not an arbitrary number, because the comparison resolves it in the
    // player's zone.
    const yesterday = new Date('2026-09-10T14:00:00Z').getTime()
    await t.run((ctx) => ctx.db.patch(playerId, { lastBoardEntryReminder: yesterday }))

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.delivered).toBe(true)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBe(DUE)
  })

  test('a player who chose both methods gets both', async () => {
    // The two delivery blocks are independent `if`s, not a chain: no other test
    // drives both methods at once, so an `if` -> `else if` between them
    // survives (measured) and email-plus-push players silently lose their push.
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, { reminderDeliveryMethods: ['email', 'push'] })

    await deliverFor(t, { playerId, dueAt: DUE })

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const jobs = await scheduledPushJobs(t)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].args[0]).toEqual({ playerId, attempt: 0 })
  })

  // THE STRUCTURAL GUARD. Deliberately a test rather than an `afterAll`: an
  // afterAll runs on ANY subset of this file, so `pnpm test:once -t '<one
  // test>'` would fail it spuriously, whereas a filtered run simply does not
  // select this one. It still runs last on a full run, because Vitest executes
  // a file's tests in declaration order and this config sets no `shuffle`.
  test('every outcome `deliver` can return is exercised by a test above', () => {
    expect([...observed].sort()).toEqual([...REASONS].sort())
  })
})
