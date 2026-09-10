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
  test('schedules the three sweeps on their own minutes, with no captured `now`', () => {
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
        // DAILY, NOT HOURLY, AND THE CADENCE IS THE ASSERTION (wordle-teams-yhii).
        // This sweep is the heaviest of the three — a full `teams` scan plus
        // every member's current month — and at hourly it was the dominant
        // consumer of a 1 GB free-tier database-I/O allowance that was measured
        // 45% used while almost nobody was visiting. Its cost is O(data) x runs,
        // so putting it back to hourly would quietly multiply the bill by 24 and
        // nothing else in the suite would notice. The cap is hard: mutations
        // fail rather than bill.
        //
        // HOUR 0 IS PART OF THE PROPERTY, not a free choice. The sweep exists to
        // catch a month boundary passing with nobody playing, and the month rolls
        // at 00:00 UTC (toPuzzleDay uses local date methods; Convex runs UTC).
        // 00:45 puts the run that matters 45 minutes after the boundary rather
        // than up to a day after it. Minute 45 keeps its lane clear of the other
        // two sweeps at :00 and :30.
        args: [{}],
        schedule: { type: 'daily', hourUTC: 0, minuteUTC: 45 },
      },
    })
  })
})
