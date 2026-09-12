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
// move pushSend.test.ts makes for `web-push`: what `deliver` decides — who
// gets claimed, who gets mailed, whether a push is enqueued — has nothing to
// do with real delivery, and mocking `sendEmail` is enough to observe all of
// it.
vi.mock('./email.ts', () => ({ sendEmail: vi.fn() }))

import { sendEmail } from './email.ts'
import { reschedulePlayerReminderFor, scheduleNextFor } from './reminders.ts'

const sendEmailMock = vi.mocked(sendEmail)

const dueChicagoPlayer = (over: Record<string, unknown> = {}) =>
  aPlayer({
    timeZone: 'America/Chicago',
    reminderDeliveryTime: '09:00:00',
    reminderDeliveryMethods: ['email'],
    ...over,
  })

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
  // SITE_URL test's `vi.stubEnv('SITE_URL', undefined)` reads as an override,
  // not a dependency on that config default.
  vi.stubEnv('SITE_URL', 'https://example.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
  // The console spies below restore themselves on the happy path only, and
  // vitest.config.ts does not set `restoreMocks`. Without this, one failing
  // assertion leaks a stubbed `console` into every test after it in the file.
  vi.restoreAllMocks()
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
  // it. `deliver` takes no `now` argument the way the deleted `sweep` did — it
  // reads `Date.now()`, which in production is the instant the scheduler fired
  // it —
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
  // has now deleted the sweep's suites from this same file, so this block is
  // what is left. Removing or loosening one of these unguards a property with
  // nothing else noticing.
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

  // ANCHORED TO `DUE`, AND THAT IS NOT INTERCHANGEABLE WITH ANY OTHER SCORE
  // FIXTURE IN THIS FILE. activityFloor('2026-09-11') is '2026-09-01', so days
  // chosen for a different `now` fall outside the window `DUE` is in. MEASURED
  // against the sweep's late-August fixture, deleted with it at Task 7: seeding
  // those three days here put the happy-path player on the `inactive` branch
  // instead.
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
  //
  // WHAT IT CANNOT SEE: SIDE EFFECTS WITHIN A BRANCH. It protects the branch
  // SET — every `reason` is reached by some test — and nothing more. Two holes
  // of exactly that kind survived Task 7's deletion and all 2702 remaining
  // tests: the allowlist failing to gate PUSH (still `not-allowlisted`), and
  // pushing every delivered player (still 'sent'). Neither changes a `reason`,
  // so this guard was green through both. A deleted test whose property maps to
  // no distinct outcome has to be re-homed by reading, not by relying on this.
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
    // AND NO PUSH, because this fixture chose email only. MEASURED: without
    // this line `if (true || player.reminderDeliveryMethods.includes(
    // PUSH_METHOD))` — push every delivered player — passed all 2702 tests.
    // The 'sms' test's zero-push assertion cannot cover it: that player returns
    // at `hasKnownMethod`, ABOVE the push block, so it never reaches the branch.
    // This is the only test in the block that both delivers and chose one
    // method, which is what makes the assertion possible here and nowhere else.
    expect(await scheduledPushJobs(t)).toHaveLength(0)
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

  test('the allowlist gates push exactly as it gates email', async () => {
    // NOTHING ELSE IN THE REPO PUTS A PUSH PLAYER THROUGH A RESTRICTIVE
    // ALLOWLIST. The sibling test above uses the email-only fixture and never
    // looks at `_scheduled_functions`, so the gate's push half was unguarded.
    // MEASURED: two mutants passed all 2702 tests before this test existed and
    // each now dies here, with this as their ONLY killer — enqueueing the push
    // inside the `not-allowlisted` branch, and moving the push block above the
    // gate entirely. (A third, `if (true || ...)` on the push branch, also
    // survived 2702; its killer is the happy-path test's zero-push assertion,
    // not this one.) The deleted sweep pinned this as 'the allowlist gates push
    // scheduling exactly like it gates email' and `deliver` did not inherit
    // it.
    //
    // THE CUTOVER FAILURE MODE IS THE ONE THE GATE EXISTS FOR: a push reminder
    // delivered to a real person copied from production who has never heard of
    // beta. Beta runs with a single address on this list today, so every other
    // copied row depends on this branch.
    vi.stubEnv('REMINDERS_ALLOWLIST', 'someone@else.test')
    const t = convexTest(schema, modules)
    const playerId = await scheduled(t, { reminderDeliveryMethods: ['push'] })

    const result = await deliverFor(t, { playerId, dueAt: DUE })

    expect(result.reason).toBe('not-allowlisted')
    expect(await scheduledPushJobs(t)).toHaveLength(0)
    expect(sendEmailMock).not.toHaveBeenCalled()
    // Not claimed, and still rescheduled: being off the list must not burn the
    // day's reminder or end the chain.
    const player = await t.run((ctx) => ctx.db.get(playerId))
    expect(player?.lastBoardEntryReminder).toBeUndefined()
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
    // have had only this test to answer to.) It had a sibling in the sweep
    // suites — 'claims a player even when sendEmail reports every recipient was
    // suppressed' — which Task 7 deleted with them, so this is now the only
    // test in the repo covering the suppressed-send shape of the rule.
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
    // Matched to the sweep's own SITE_URL test on purpose, and now that Task 7
    // has deleted that one, nothing else exercises the absent shape.
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

  // THE THREE GATE BEHAVIOURS THE SWEEP PINNED AND `deliver` DID NOT. Task 7
  // deleted the sweep suites from this file on the premise that these were
  // re-asserted here; they were not, so they were re-homed here first, and each
  // was confirmed present before anything was cut. Each has a live cutover
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

describe('maintain', () => {
  // NEITHER KILL SWITCH IS STUBBED HERE, and that is not an omission. The
  // file-level `beforeEach` sets REMINDERS_ENABLED and SITE_URL already, and
  // `maintain` reads neither: the gate lives at delivery so that flipping it
  // costs nothing (see its doc comment). Restubbing them in this block would
  // read as a dependency this function does not have.

  // WHAT THESE FIXTURES DELIBERATELY VARY, AND WHY THAT IS WRITTEN DOWN. Three
  // consecutive tasks in this change lost a mutant to a fixture-level constant
  // rather than to a missing test: every `deliver` test at the same instant,
  // then every local day equal to UTC's, then — here — every player's
  // `reminderJobId` absent, which hid a dropped `cancel` through 2741 passing
  // tests and four green gates. Each test below was individually non-vacuous in
  // all three cases; what was missing was an input shape no fixture produced.
  //
  // So, on purpose: not every player has a zone, and one has a zone ICU
  // REJECTS; not every player is on exactly one team; a chain is variously
  // healthy, absent, long past due, and due at this exact instant; `players`
  // and `teams` differ in size in at least one run; one run has something to
  // defer; one run throws on a player that is NOT the last; and one player
  // carries a real pending job.
  //
  // WHAT THESE FIXTURES STILL HOLD CONSTANT, handed over rather than left to be
  // rediscovered. None of these is known to hide a mutant — but that was true of
  // the three above until somebody looked:
  //
  //   - every schedulable player is `America/Chicago` at `09:00:00`, so every
  //     local day here equals the UTC day. That is the SECOND of the three
  //     losses this paragraph records, recreated in this very block.
  //   - at most five players and three teams in a run, so nothing here
  //     exercises a scan at production scale.
  //   - only `players` and `teams` are ever written; no `dailyScores`, and so
  //     nothing downstream of the chain this pass repairs.
  //
  // IF YOU ADD A TEST HERE, ask what your fixture holds still that every other
  // fixture also holds still — that is where the next survivor will be.

  const CHICAGO = 'America/Chicago'

  /** A player who CAN be scheduled: a resolvable zone and a 09:00 wall clock. */
  const zoned = (over: Record<string, unknown> = {}) =>
    aPlayer({ timeZone: CHICAGO, reminderDeliveryTime: '09:00:00', ...over })

  // 2026-09-11T14:00:00Z is 09:00 Chicago on a FRIDAY — pinned the same way in
  // the `deliver` block above — so these are the Saturday and Monday that
  // follow it, each at 09:00 Chicago (CDT, UTC-5).
  const SATURDAY_9AM = new Date('2026-09-12T14:00:00Z').getTime()
  const MONDAY_9AM = new Date('2026-09-14T14:00:00Z').getTime()
  // Saturday 07:00 Chicago, BEFORE that day's 09:00. That is what makes the
  // flag-flip tests able to recover Saturday ITSELF rather than only Sunday,
  // which is the whole point of the scenario they encode.
  const SATURDAY_7AM = new Date('2026-09-12T12:00:00Z').getTime()

  /**
   * Run `body` with the clock frozen at `at`.
   *
   * A HELPER RATHER THAN A NESTED `describe` WITH fake timers in its
   * `beforeEach`, on purpose: the structural guard at the end of this block has
   * to run LAST, and a flat list of tests makes that a property of declaration
   * order alone rather than of how Vitest interleaves a suite's own tests with
   * its child suites'.
   *
   * The `finally` matters: this file's `afterEach` calls `vi.restoreAllMocks()`
   * but never `vi.useRealTimers()`, so a test that pinned the clock and threw
   * would leak frozen time into every test after it.
   */
  async function atInstant<T>(at: number, body: () => Promise<T>): Promise<T> {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(at))
    try {
      return await body()
    } finally {
      vi.useRealTimers()
    }
  }

  /**
   * Reads the WHOLE player document out of `t.run`, then picks fields off it
   * outside that call, deliberately. `t.run`'s return value crosses the same
   * Convex-value wire boundary a query's return does, and Convex has no
   * `undefined` value — a bare `undefined` returned from `t.run` comes back as
   * `null`, even though the field is genuinely absent on the stored document
   * (confirmed against a raw `ctx.db.get` result). Returning the whole doc
   * sidesteps the coercion: only the field access happens in plain JS, after the
   * boundary, where an absent key really is `undefined`. Several assertions
   * below turn on `playsWeekends` being genuinely ABSENT rather than `false`.
   *
   * A file-scope `lastReminderOf` helper carried this same explanation. Its only
   * callers were the sweep suites, so it went with them at Task 7 and the
   * reasoning lives here now.
   */
  const playerDoc = (t: ReturnType<typeof convexTest>, playerId: Id<'players'>) =>
    t.run((ctx) => ctx.db.get(playerId))

  const deliverJobs = (t: ReturnType<typeof convexTest>) =>
    t.run((ctx) =>
      ctx.db.system
        .query('_scheduled_functions')
        .collect()
        .then((rows) => rows.filter((row) => row.name === 'reminders:deliver')),
    )

  // THE STRUCTURAL GUARD'S BOOKKEEPING, the same idea as the `deliver` block's
  // REASONS set and for the same reason: `maintain` reports what it did in four
  // counters, and a counter no test ever drives above zero is a path with no
  // test. Task 7 edited this file and Task 8 adds metered assertions against
  // this function, so "a test was deleted" needs to fail the build rather than
  // rely on somebody reading a comment.
  const COUNTERS = ['weekendFlagsChanged', 'scheduled', 'deferred', 'zoneless', 'failed'] as const
  const drivenAboveZero = new Set<string>()
  // SEPARATE FROM THE COUNTERS, because what needs guarding here is not a
  // non-zero value but an UNEQUAL pair. `players` and `teams` were transposable
  // in the return object without a single test noticing, because every fixture
  // that asserted the scan sizes had them equal — 2 and 2, then 0 and 0. Task 8
  // meters exactly these two fields, so the fixture that tells them apart has
  // to be impossible to delete quietly.
  //
  // WHAT IT PROVES IS WEAKER THAN AN ASSERTION, and worth being honest about:
  // it records that some test RAN against an unequal fixture, not that any test
  // asserted the values. The two-teams test does assert them; this is what
  // fails the build if that fixture is ever flattened.
  let sawUnequalScanSizes = false

  /**
   * Call `maintain` and record which of its counters this call moved.
   *
   * Every call in this block goes through here rather than `t.mutation`
   * directly, so the coverage assertion cannot be satisfied by a test that
   * stopped exercising the path it is named for.
   */
  async function maintainFor(
    t: ReturnType<typeof convexTest>,
    args: { budget?: number } = {},
  ) {
    const result = await t.mutation(internal.reminders.maintain, args)
    for (const counter of COUNTERS) if (result[counter] > 0) drivenAboveZero.add(counter)
    if (result.players !== result.teams) sawUnequalScanSizes = true
    return result
  }

  test('bootstraps a player who has never been scheduled', async () => {
    // THE ENTIRE BOOTSTRAP STORY. Existing players have no nextReminderAt, which
    // is the same state a broken chain leaves behind, so no migration mutation
    // and no manual cutover step is needed for the rows already in the table.
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) => ctx.db.insert('players', zoned()))

    const result = await maintainFor(t)

    expect(result.scheduled).toBe(1)
    const player = await playerDoc(t, playerId)
    expect(player?.nextReminderAt).toBeGreaterThan(Date.now())
    // AND A JOB ACTUALLY EXISTS FOR IT, carrying that instant — the row
    // agreeing with itself is not the chain; the job is.
    const jobs = await deliverJobs(t)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].args[0]).toEqual({ playerId, dueAt: player?.nextReminderAt })
  })

  test('repairs a chain whose job never fired', async () => {
    // The silent failure this pass exists for: a permanent throw inside deliver
    // rolls back its own reschedule, so the player simply stops being reminded
    // and nothing notices.
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', zoned({ nextReminderAt: Date.now() - 48 * 3600 * 1000 })),
    )

    const result = await maintainFor(t)

    expect(result.scheduled).toBe(1)
    const player = await playerDoc(t, playerId)
    expect(player?.nextReminderAt).toBeGreaterThan(Date.now())
  })

  test('leaves a healthy chain alone', async () => {
    // The assertion that this pass is nearly free in steady state: it must not
    // churn every row a day rescheduling jobs that are perfectly fine.
    const t = convexTest(schema, modules)
    const future = Date.now() + 6 * 3600 * 1000
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', zoned({ nextReminderAt: future })),
    )

    const result = await maintainFor(t)

    expect(result.scheduled).toBe(0)
    expect(result.weekendFlagsChanged).toBe(0)
    const player = await playerDoc(t, playerId)
    expect(player?.nextReminderAt).toBe(future)
    // Nothing was scheduled, not merely nothing recorded.
    expect(await deliverJobs(t)).toHaveLength(0)
  })

  test('a chain due at exactly this instant is repaired, not read as healthy', async () => {
    // THE HEALTH PREDICATE'S BOUNDARY, and the only test that separates
    // `nextReminderAt > now` from `>= now`. A job whose instant has arrived but
    // which has not run is indistinguishable from one that never will; the
    // predicate has to treat it as due, because `nextOccurrence` is strictly
    // after `from` and so cannot return this same instant and spin.
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', zoned({ nextReminderAt: SATURDAY_7AM })),
    )

    const result = await atInstant(SATURDAY_7AM, () => maintainFor(t))

    expect(result.scheduled).toBe(1)
    // Monday, not Saturday: this player is on no team at all, so the derived
    // flag is false and the weekend is skipped.
    expect((await playerDoc(t, playerId))?.nextReminderAt).toBe(MONDAY_9AM)
  })

  test('a chain due one millisecond from now is healthy', async () => {
    // The other side of the same boundary, so that the predicate cannot be
    // satisfied by "always repair".
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', zoned({ nextReminderAt: SATURDAY_7AM + 1 })),
    )

    const result = await atInstant(SATURDAY_7AM, () => maintainFor(t))

    expect(result.scheduled).toBe(0)
    expect((await playerDoc(t, playerId))?.nextReminderAt).toBe(SATURDAY_7AM + 1)
  })

  test('derives playsWeekends from weekend-playing teams', async () => {
    const t = convexTest(schema, modules)
    const { weekend, weekday } = await t.run(async (ctx) => {
      const weekend = await ctx.db.insert(
        'players',
        zoned({ email: 'weekend@example.com', playsWeekends: false }),
      )
      const weekday = await ctx.db.insert(
        'players',
        zoned({ email: 'weekday@example.com', playsWeekends: true }),
      )
      await ctx.db.insert('teams', aTeam({ legacyId: 1, playerIds: [weekend], playWeekends: true }))
      await ctx.db.insert('teams', aTeam({ legacyId: 2, playerIds: [weekday], playWeekends: false }))
      return { weekend, weekday }
    })

    // SEEDED WITH THE WRONG FLAG ON PURPOSE, both directions at once. Seeding
    // them absent would let a mutant that simply never writes `false` pass the
    // `weekday` half, because absent reads as false to every reader of this
    // field.
    const result = await maintainFor(t)

    expect((await playerDoc(t, weekend))?.playsWeekends).toBe(true)
    expect((await playerDoc(t, weekday))?.playsWeekends).toBe(false)
    expect(result.weekendFlagsChanged).toBe(2)
    // The return value reports the scan it actually did, which is what Task 8
    // meters.
    expect(result.players).toBe(2)
    expect(result.teams).toBe(2)
  })

  test('a player on two teams plays weekends if either of them does', async () => {
    // A FIXTURE BLIND SPOT, NOT AN EDGE CASE. Every other test in this block
    // puts each player on at most one team, so without this one the whole
    // suite would still pass if the derivation read only the FIRST team a
    // player appears on.
    const t = convexTest(schema, modules)
    const { mixed, neither } = await t.run(async (ctx) => {
      const mixed = await ctx.db.insert('players', zoned({ email: 'mixed@example.com' }))
      const neither = await ctx.db.insert('players', zoned({ email: 'neither@example.com' }))
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 1, playerIds: [mixed, neither], playWeekends: false }),
      )
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 2, playerIds: [mixed, neither], playWeekends: false }),
      )
      await ctx.db.insert('teams', aTeam({ legacyId: 3, playerIds: [mixed], playWeekends: true }))
      return { mixed, neither }
    })

    const result = await maintainFor(t)

    expect((await playerDoc(t, mixed))?.playsWeekends).toBe(true)
    // Two non-weekend teams is still not a weekend team.
    expect((await playerDoc(t, neither))?.playsWeekends).toBeUndefined()

    // THE ONLY UNEQUAL SCAN SIZES IN THIS BLOCK, and the only thing that tells
    // `players` from `teams` in the return. MEASURED: transposing those two
    // fields in the return object passed all 2741 tests in this repo, because
    // every other fixture asserting them has them equal — 2 and 2, then 0 and
    // 0. Task 8 meters exactly these two, so do not flatten this fixture to
    // three players on three teams for tidiness.
    expect(result.players).toBe(2)
    expect(result.teams).toBe(3)
  })

  test('clears playsWeekends when the player leaves the weekend team', async () => {
    const t = convexTest(schema, modules)
    const { playerId, teamId } = await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', zoned({ playsWeekends: true }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [playerId], playWeekends: true }),
      )
      return { playerId, teamId }
    })

    await t.run((ctx) => ctx.db.patch(teamId, { playerIds: [] }))
    await maintainFor(t)

    // EXPLICITLY false, not absent. A player who LEAVES a weekend team is the
    // only way this field is ever written false — see the coerced-comparison
    // test below for why a player who was never on one stays absent forever.
    expect((await playerDoc(t, playerId))?.playsWeekends).toBe(false)
  })

  test('does not patch playsWeekends when it already agrees', async () => {
    // Writes cost bandwidth too. In steady state this pass must be reads only.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => {
      const id = await ctx.db.insert(
        'players',
        zoned({ playsWeekends: true, nextReminderAt: Date.now() + 6 * 3600 * 1000 }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [id], playWeekends: true }))
      return id
    })

    const result = await maintainFor(t)

    expect(result.weekendFlagsChanged).toBe(0)
    expect(result.scheduled).toBe(0)
    expect(playerId).toBeDefined()
  })

  test('leaves an absent playsWeekends absent rather than writing false onto it', async () => {
    // THE COERCED COMPARISON. Four tests in this block kill the raw-comparison
    // mutant, so this is not its only killer. TWO of the four assert the
    // ABSENCE directly — this one and the two-teams test, which checks
    // `neither`'s flag the same way; the other two notice it through a knock-on
    // count. (An earlier version of this line claimed to be the only test that
    // asserts the absence, which was the same uniqueness overclaim this file
    // has now produced twice.) Absent and
    // false are the SAME STATE to every reader of this field — scheduleNextFor
    // coerces with `?? false` — so a player on no weekend-playing team must
    // read as "unchanged", not as a flip from `undefined` to `false`.
    //
    // WITH THE RAW COMPARISON THIS TEST FAILS THREE TIMES OVER, which is what
    // makes it worth its length. `undefined !== false` is true, so the first
    // run after cutover would (a) patch `false` onto every player not on a
    // weekend team, (b) report them all in weekendFlagsChanged, and (c) —
    // because a flipped flag now also reschedules — reschedule every one of
    // them, turning the steady-state claim in this function's doc comment and
    // Task 8's metered assertion into something the first run violates.
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', zoned({ nextReminderAt: Date.now() + 6 * 3600 * 1000 })),
    )

    const result = await maintainFor(t)

    expect(result.weekendFlagsChanged).toBe(0)
    expect(result.scheduled).toBe(0)
    expect((await playerDoc(t, playerId))?.playsWeekends).toBeUndefined()
  })

  test('reschedules a healthy chain when the weekend flag flips on', async () => {
    // THE MISSED-WEEKEND BUG, encoded exactly as it happens. Friday's delivery
    // reschedules a non-weekend player, so nextOccurrence skips Saturday and
    // Sunday and nextReminderAt points at MONDAY. On Saturday morning they join
    // a team that plays weekends. Monday is still in the FUTURE, so a pass that
    // repaired only broken chains would flip the flag, read the chain as
    // healthy, and leave them to miss Saturday AND Sunday — and running this
    // pass more often could not help, because it cannot see the problem at all.
    //
    // THE ONLY TEST IN THIS BLOCK THAT SEEDS A REAL reminderJobId, and so the
    // only one that can observe the CANCEL half of the chain. This is the right
    // place for it because it is the one path where a live FUTURE job provably
    // exists and must be retired — a repair or a bootstrap has nothing pending
    // to cancel. MEASURED, and the reason it is here at all: with every fixture
    // leaving the job side absent, replacing `reschedulePlayerReminderFor` with
    // `scheduleNextFor` inside `maintain` — dropping the cancel outright —
    // passed all 2741 tests in this repo and all four gates, leaving the
    // superseded Monday job pending in `_scheduled_functions` forever.
    const t = convexTest(schema, modules)

    // SEEDED INSIDE THE PINNED WINDOW, unlike the other tests in this block,
    // and that is what keeps the Monday job from firing. convex-test schedules
    // from `setTimeout(..., max(0, ts - Date.now()))`, so with the clock frozen
    // the delay cannot elapse AT ALL rather than merely being long. Seeded
    // against the real clock instead, this fixture would arm itself as a time
    // bomb the day the real date passed 2026-09-14.
    const { playerId, staleJobId, result } = await atInstant(SATURDAY_7AM, async () => {
      const seeded = await t.run(async (ctx) => {
        const id = await ctx.db.insert('players', zoned({ nextReminderAt: MONDAY_9AM }))
        await ctx.db.insert('teams', aTeam({ playerIds: [id], playWeekends: true }))
        // Exactly the state a Friday delivery leaves behind: a job pending at
        // the instant the row names, carrying that instant in its args.
        const jobId = await ctx.scheduler.runAt(MONDAY_9AM, internal.reminders.deliver, {
          playerId: id,
          dueAt: MONDAY_9AM,
        })
        await ctx.db.patch(id, { reminderJobId: jobId })
        return { playerId: id, staleJobId: jobId }
      })
      return { ...seeded, result: await maintainFor(t) }
    })

    expect(result.weekendFlagsChanged).toBe(1)
    expect(result.scheduled).toBe(1)
    const player = await playerDoc(t, playerId)
    expect(player?.playsWeekends).toBe(true)
    // Saturday, TODAY, not Monday and not Sunday.
    expect(player?.nextReminderAt).toBe(SATURDAY_9AM)

    // THE CANCEL HALF. The superseded Monday job is retired, and exactly one
    // job is left pending — at Saturday, carrying Saturday, and named by the
    // row. Delivery would still be correct without the cancel, because
    // `deliver`'s staleness guard retires a job whose `dueAt` no longer matches
    // the row; what the cancel buys is that `_scheduled_functions` does not
    // accumulate jobs that will only ever no-op. See
    // `reschedulePlayerReminderFor` for why that is tidiness rather than
    // correctness — and note that tidiness with nothing asserting it is how
    // this mutant survived.
    const jobs = await deliverJobs(t)
    expect(jobs).toHaveLength(2)
    const byId = new Map(jobs.map((job) => [job._id, job]))
    expect(byId.get(staleJobId)?.state.kind).toBe('canceled')
    const pending = jobs.filter((job) => job.state.kind === 'pending')
    expect(pending).toHaveLength(1)
    expect(pending[0]._id).toBe(player?.reminderJobId)
    expect(pending[0].scheduledTime).toBe(SATURDAY_9AM)
    expect(pending[0].args[0]).toEqual({ playerId, dueAt: SATURDAY_9AM })
  })

  test('reschedules a healthy chain when the weekend flag flips off', async () => {
    // THE OTHER DIRECTION, milder but the same defect. A Saturday job already
    // exists and passes deliver's staleness guard, and the weekend rule lives
    // in nextOccurrence rather than in the delivery job, so it would deliver —
    // one extra send. Rescheduling on the flip moves it to Monday instead.
    const t = convexTest(schema, modules)
    const playerId = await t.run((ctx) =>
      ctx.db.insert('players', zoned({ playsWeekends: true, nextReminderAt: SATURDAY_9AM })),
    )

    const result = await atInstant(SATURDAY_7AM, () => maintainFor(t))

    expect(result.weekendFlagsChanged).toBe(1)
    expect(result.scheduled).toBe(1)
    const player = await playerDoc(t, playerId)
    expect(player?.playsWeekends).toBe(false)
    expect(player?.nextReminderAt).toBe(MONDAY_9AM)
  })

  test('skips a player with no time zone without wedging on them', async () => {
    // These can never be scheduled, and on beta there are MANY. Not for the
    // reason an earlier draft gave: it said "151 of production's 533 rows are
    // nameless leftovers", which conflates two populations — the nameless rows
    // never reach Convex at all, because the copy filters them out
    // (scripts/lib/copy-filters.mjs, players.filter(isNamed)).
    //
    // The real sources are three: copy-reminder-policy WITHHOLDS timeZone on
    // every copy except the cutover one, so most copied beta rows have none; a
    // Supabase row may have had no time_zone to begin with (the copy writes
    // opt(p.time_zone)); and a natively-signed-up player has none until their
    // first authenticated load writes it. They must not consume the schedule
    // budget or stop the pass reaching anyone else.
    const t = convexTest(schema, modules)
    const { zoneless, schedulable } = await t.run(async (ctx) => ({
      zoneless: await ctx.db.insert('players', aPlayer({ email: 'z@example.com' })),
      schedulable: await ctx.db.insert('players', zoned({ email: 's@example.com' })),
    }))

    const result = await maintainFor(t)

    expect(result.scheduled).toBe(1)
    expect((await playerDoc(t, zoneless))?.nextReminderAt).toBeUndefined()
    expect((await playerDoc(t, schedulable))?.nextReminderAt).toBeDefined()
  })

  test('derives the weekend flag for a zoneless player, who cannot be scheduled', async () => {
    // THE FLAG PATCH SITS ABOVE THE ZONE CHECK, and that order is correct
    // rather than incidental. A zoneless player can still be on a weekend team,
    // and when updateTimeZoneFor later schedules them, scheduleNextFor reads
    // this flag — so deriving it now is what stops their first scheduled
    // reminder being computed from a stale one. It costs nothing, because the
    // coerced comparison above means a zoneless NON-weekend player is never
    // written at all.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('players', aPlayer({ email: 'z@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [id], playWeekends: true }))
      return id
    })

    const result = await maintainFor(t)

    expect(result.weekendFlagsChanged).toBe(1)
    expect(result.scheduled).toBe(0)
    const player = await playerDoc(t, playerId)
    expect(player?.playsWeekends).toBe(true)
    expect(player?.nextReminderAt).toBeUndefined()
  })

  test('an unresolvable time zone is logged and does not abort the batch', async () => {
    // THE BAD ROW THIS WHOLE PASS IS TOLERANT FOR. schema.ts types timeZone as
    // unvalidated v.optional(v.string()) and a row copied from Supabase never
    // passed through updateTimeZoneFor, so one of these exists.
    //
    // IT IS SWALLOWED INSIDE scheduleNextFor, NOT BY THIS PASS'S OWN GUARD,
    // which is why `failed` stays 0 here and the test below has to force a
    // throw a different way. `scheduled` counts it all the same: the counter is
    // reschedule ATTEMPTS, which is what the budget bounds.
    const t = convexTest(schema, modules)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { bad, good } = await t.run(async (ctx) => ({
      bad: await ctx.db.insert('players', zoned({ email: 'bad@example.com', timeZone: 'GMT+5' })),
      good: await ctx.db.insert('players', zoned({ email: 'good@example.com' })),
    }))

    const result = await maintainFor(t)

    expect(result.failed).toBe(0)
    expect(result.scheduled).toBe(2)
    expect((await playerDoc(t, bad))?.nextReminderAt).toBeUndefined()
    expect((await playerDoc(t, good))?.nextReminderAt).toBeGreaterThan(Date.now())
    expect(spy).toHaveBeenCalledWith(
      '[reminders] cannot compute a next occurrence for a player',
      expect.objectContaining({ playerId: bad, timeZone: 'GMT+5' }),
      expect.anything(),
    )
  })

  test('a throw on one player is logged and the batch carries on', async () => {
    // THE PER-PLAYER GUARD, and the only test that reaches it. Every throw
    // scheduleNextFor can currently produce is caught inside it, so this forces
    // one from the layer BELOW: convex-test enforces its transaction limits
    // when `transactionLimits` is passed to convexTest, and a functionsScheduled
    // cap of 1 makes the SECOND ctx.scheduler.runAt of the pass throw. That
    // call sits outside every try in scheduleNextFor.
    //
    // WITHOUT THE GUARD THIS TEST DOES NOT MERELY REPORT A DIFFERENT COUNT — the
    // mutation rejects, and every playsWeekends patch the pass had already made
    // is rolled back with it. That is the property the guard exists for, and it
    // is why the assertion on `first`'s flag below is not decoration.
    //
    // THREE PLAYERS, NOT TWO, AND THE THIRD IS THE WHOLE POINT. With the throw
    // on `second` as the LAST row, nothing observed the loop CONTINUING — so
    // the test named "and the batch carries on" could not see the thing it is
    // named for. MEASURED: adding `break` after the `console.error` in the
    // catch passed all 2741 tests in this repo and all four gates. `third`
    // re-trips the same limit (convex-test increments `functionsScheduled`
    // before checking it, so every later `runAt` throws too), which is what
    // makes the guard's continue observable at all.
    const t = convexTest({ schema, modules, transactionLimits: { functionsScheduled: 1 } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { first, second, third } = await t.run(async (ctx) => {
      const first = await ctx.db.insert('players', zoned({ email: 'first@example.com' }))
      const second = await ctx.db.insert('players', zoned({ email: 'second@example.com' }))
      const third = await ctx.db.insert('players', zoned({ email: 'third@example.com' }))
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [first, second, third], playWeekends: true }),
      )
      return { first, second, third }
    })

    const result = await maintainFor(t)

    expect(result.scheduled).toBe(1)
    expect(result.failed).toBe(2)
    // ALL THREE flag patches committed, including the two made on rows that
    // then threw. Nothing was rolled back, and the loop reached the last row.
    expect(result.weekendFlagsChanged).toBe(3)
    expect((await playerDoc(t, first))?.playsWeekends).toBe(true)
    expect((await playerDoc(t, second))?.playsWeekends).toBe(true)
    expect((await playerDoc(t, third))?.playsWeekends).toBe(true)
    // The reachable player is scheduled; the unreachable ones are left for
    // tomorrow's run, which is the correct outcome for a row that failed once.
    expect((await playerDoc(t, first))?.nextReminderAt).toBeGreaterThan(Date.now())
    expect((await playerDoc(t, second))?.nextReminderAt).toBeUndefined()
    expect((await playerDoc(t, third))?.nextReminderAt).toBeUndefined()
    // THE CAUSE IS FORWARDED, not just the row id. A guard that logged only
    // "something failed" would make this pass's own failures as invisible as
    // the ones it exists to find.
    expect(spy).toHaveBeenCalledWith(
      '[reminders] maintenance failed for one player; it will be retried tomorrow',
      expect.objectContaining({ playerId: second }),
      expect.objectContaining({ message: expect.stringContaining('Scheduled too many functions') }),
    )
    // AND IT REACHED `third`. This is the assertion that kills `break`: the
    // count above would survive a guard that stopped, if `failed` were the only
    // thing checked and the fixture ended at the failing row.
    expect(spy).toHaveBeenCalledWith(
      '[reminders] maintenance failed for one player; it will be retried tomorrow',
      expect.objectContaining({ playerId: third }),
      expect.anything(),
    )
    expect(spy).toHaveBeenCalledTimes(2)
    logSpy.mockRestore()
  })

  test('stops at the schedule budget and reports that it did', async () => {
    // A bootstrap over a table larger than the budget must make progress across
    // runs rather than throwing. See MAINTAIN_SCHEDULE_BUDGET for where the
    // figure comes from.
    const t = convexTest(schema, modules)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert('players', zoned({ email: `p${i}@example.com` }))
      }
    })

    const result = await maintainFor(t, { budget: 3 })

    expect(result.scheduled).toBe(3)
    expect(result.deferred).toBe(2)

    // AND IT SAID SO OUT LOUD. Every counter this pass reports otherwise exists
    // only in the return value, and after Task 7 the sole caller is a cron — so
    // "a bootstrap that needs several days is visible rather than mysterious"
    // is a claim about a log line, not about a returned object nobody reads.
    // This is the only test that pins the line's existence.
    expect(logSpy).toHaveBeenCalledWith(
      '[reminders] maintenance pass did not finish',
      expect.objectContaining({ deferred: 2, scheduled: 3, failed: 0 }),
    )

    // The next run finishes the job — and says nothing, because there is
    // nothing left to report.
    logSpy.mockClear()
    const second = await maintainFor(t, { budget: 3 })
    expect(second.scheduled).toBe(2)
    expect(second.deferred).toBe(0)
    expect(logSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
  })

  test('a player with no time zone does not consume the schedule budget', async () => {
    // The zoneless population is large and permanent, so if it drew from the
    // budget a bootstrap could stall behind rows that can never be scheduled.
    const t = convexTest(schema, modules)
    // Deferral trips the summary line; asserted in the budget test above.
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'z@example.com' }))
      await ctx.db.insert('players', zoned({ email: 'a@example.com' }))
      await ctx.db.insert('players', zoned({ email: 'b@example.com' }))
    })

    const result = await maintainFor(t, { budget: 1 })

    expect(result.scheduled).toBe(1)
    // Two schedulable players, one of them deferred. Three would mean the
    // zoneless row had been counted.
    expect(result.deferred).toBe(1)
  })

  test('a deferred player keeps their stale flag, so the next run still sees the flip', async () => {
    // THE BUDGET AND THE FLAG FLIP INTERACT, and getting the order wrong
    // reintroduces the missed-weekend bug in a narrower window. If the flag
    // were patched before the budget check, a flipped-but-deferred player would
    // come back on the next run with the flag already agreeing and a chain that
    // still reads healthy — so nothing would ever reschedule them, and the
    // reschedule-on-flip fix would be silently lost for exactly the rows a
    // bootstrap is too busy to reach.
    const t = convexTest(schema, modules)
    // Deferral trips the summary line; asserted in the budget test above.
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const playerId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('players', zoned({ nextReminderAt: MONDAY_9AM }))
      await ctx.db.insert('teams', aTeam({ playerIds: [id], playWeekends: true }))
      return id
    })

    const first = await atInstant(SATURDAY_7AM, () => maintainFor(t, { budget: 0 }))

    expect(first.deferred).toBe(1)
    expect(first.weekendFlagsChanged).toBe(0)
    const deferredPlayer = await playerDoc(t, playerId)
    expect(deferredPlayer?.playsWeekends).toBeUndefined()
    expect(deferredPlayer?.nextReminderAt).toBe(MONDAY_9AM)

    const second = await atInstant(SATURDAY_7AM, () => maintainFor(t, { budget: 1 }))

    expect(second.weekendFlagsChanged).toBe(1)
    expect(second.scheduled).toBe(1)
    const repaired = await playerDoc(t, playerId)
    expect(repaired?.playsWeekends).toBe(true)
    expect(repaired?.nextReminderAt).toBe(SATURDAY_9AM)
  })

  test('a table that has lost every time zone is distinguishable from a healthy one', async () => {
    // THE LARGEST SILENT POPULATION, and until `zoneless` existed it was the
    // one thing this pass could not report. MEASURED on the code before that
    // counter: a table where every row has lost its timeZone returned
    // weekendFlagsChanged 0, scheduled 0, deferred 0, failed 0 —
    // BYTE-IDENTICAL to healthy steady state, and equally acceptable to Task
    // 8's "writes and schedules nothing when every chain is healthy"
    // assertion. For the one pass whose entire purpose is finding silent
    // failures, that was the wrong thing to be blind to; the cutover copy
    // overwriting timeZone is the plausible route to it.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert('players', aPlayer({ email: `z${i}@example.com` }))
      }
    })

    const result = await maintainFor(t)

    expect(result.zoneless).toBe(3)
    expect(result.scheduled).toBe(0)
    expect(result.deferred).toBe(0)
    expect(result.failed).toBe(0)

    // AND A HEALTHY TABLE REPORTS ZERO OF THEM, which is the half that makes
    // the counter worth having — a count that were always non-zero would
    // distinguish nothing.
    const healthy = convexTest(schema, modules)
    await healthy.run((ctx) =>
      ctx.db.insert('players', zoned({ nextReminderAt: Date.now() + 6 * 3600 * 1000 })),
    )
    const fine = await maintainFor(healthy)
    expect(fine.zoneless).toBe(0)
    expect(fine.scheduled).toBe(0)
  })

  test('an empty table is a no-op rather than an error', async () => {
    const t = convexTest(schema, modules)

    const result = await maintainFor(t)

    expect(result).toEqual({
      players: 0,
      teams: 0,
      weekendFlagsChanged: 0,
      scheduled: 0,
      deferred: 0,
      zoneless: 0,
      failed: 0,
    })
  })

  // THE STRUCTURAL GUARD. A test rather than an `afterAll`, for the reason the
  // `deliver` block's own guard gives: an afterAll runs on ANY subset of this
  // file, so a filtered single-test run would fail it spuriously.
  test('every counter `maintain` reports is driven above zero by a test above', () => {
    expect([...drivenAboveZero].sort()).toEqual([...COUNTERS].sort())
  })

  test('some fixture above reports unequal `players` and `teams`', () => {
    expect(sawUnequalScanSizes).toBe(true)
  })
})
