import { describe, expect, test } from 'vitest'
import crons from './crons.ts'

/**
 * `Crons` (convex/server) exposes `crons: Record<string, CronJob>` publicly,
 * so this needs no convex-test harness — the module-scope call to
 * `crons.hourly(...)` has already built the object by the time this file
 * imports it.
 *
 * WHY THIS FILE EXISTS: crons.ts had no test at all. Changing its one
 * scheduling call to `internal.reminders.sweep, { now: Date.now() }` — the
 * exact mistake its own doc comment warns against — keeps typecheck, lint
 * and every other test in this repo green, while silently freezing `now` at
 * deploy time forever. Worse than a wrong hour: once one sweep runs,
 * alreadyRemindedToday would compare every later stamp against that frozen
 * instant's local day, so after the first send every player would be
 * suppressed permanently. Only a test that inspects the ACTUAL args baked
 * into the schedule — not just that some function got wired up — catches
 * that.
 */
describe('crons', () => {
  test('schedules sweep hourly, on the hour, with no captured `now`', () => {
    expect(crons.crons).toEqual({
      'board entry reminders': {
        name: 'reminders:sweep',
        schedule: { type: 'hourly', minuteUTC: 0 },
        // NOT [{ now: <some number> }] — see the doc comment on crons.ts and
        // on sweep's `now` argument (reminders.ts) for why a captured value
        // here would freeze the clock at deploy time.
        args: [{}],
      },
    })
  })
})
