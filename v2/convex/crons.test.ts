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
  test('schedules all three sweeps hourly, on different minutes, with no captured `now`', () => {
    // THE WHOLE OBJECT, not a per-job lookup. `toEqual` on the map is what
    // makes a THIRD registration — or a deleted one — a failure here rather
    // than something nobody notices until a job silently stops running.
    expect(crons.crons).toEqual({
      'board entry reminders': {
        name: 'reminders:sweep',
        schedule: { type: 'hourly', minuteUTC: 0 },
        // NOT [{ now: <some number> }] — see the doc comment on crons.ts and
        // on sweep's `now` argument (reminders.ts) for why a captured value
        // here would freeze the clock at deploy time.
        args: [{}],
      },
      'chat notifications': {
        name: 'chatNotify:sweep',
        // MINUTE 30, ASSERTED RATHER THAN INCIDENTAL. Moving this to 0 would
        // put both sweeps' table walks and both bursts of push traffic on the
        // same minute — see crons.ts for why they are kept apart — and nothing
        // else in the suite would notice.
        schedule: { type: 'hourly', minuteUTC: 30 },
        args: [{}],
      },
      'team month aggregates': {
        name: 'teamStats:sweep',
        // MINUTE 45, for the same reason 30 is asserted above: this is the
        // heaviest of the three — it reads `teams` and every member's current
        // month — so it gets a lane of its own rather than contending with the
        // other two. See crons.ts, and note this sweep is a SAFETY NET: the
        // aggregate is kept correct by the board-write path (winners.ts), which
        // is what covers a backfilled month this cron never touches.
        args: [{}],
        schedule: { type: 'hourly', minuteUTC: 45 },
      },
    })
  })
})
