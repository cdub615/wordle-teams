import { describe, expect, test } from 'vitest'
import crons from './crons.ts'

/**
 * `Crons` (convex/server) exposes `crons: Record<string, CronJob>` publicly,
 * so this needs no convex-test harness — the module-scope calls to
 * `crons.hourly(...)` and `crons.daily(...)` have already built the object by
 * the time this file imports it.
 *
 * WHY THIS FILE EXISTS: crons.ts had no test at all. It was written while the
 * reminder job was the hourly `internal.reminders.sweep`, which took an
 * optional `now`: changing the scheduling call to
 * `internal.reminders.sweep, { now: Date.now() }` — the exact mistake crons.ts's
 * own doc comment warns against — kept typecheck, lint and every other test in
 * this repo green while silently freezing `now` at deploy time forever. Worse
 * than a wrong hour: once one sweep had run, alreadyRemindedToday would compare
 * every later stamp against that frozen instant's local day, so after the first
 * send every player would be suppressed permanently.
 *
 * THE HAZARD OUTLIVED THAT FUNCTION, which is why this file still inspects the
 * ACTUAL args baked into each schedule rather than only that some function got
 * wired up: `reminders.maintain` takes an optional `budget` for the same reason
 * `sweep` took `now` — its tests need it — and a value passed from crons.ts
 * would be frozen at deploy time exactly the same way.
 */
describe('crons', () => {
  test('schedules exactly three jobs, each in its own lane, with no captured args', () => {
    // THE WHOLE OBJECT, not a per-job lookup. `toEqual` on the map is what
    // makes a THIRD registration — or a deleted one — a failure here rather
    // than something nobody notices until a job silently stops running.
    expect(crons.crons).toEqual({
      'reminder maintenance': {
        name: 'reminders:maintain',
        // DAILY, AND THE CADENCE IS THE ASSERTION (wordle-teams-spcu). This pass
        // collects the whole players table, which is exactly the read the hourly
        // reminder sweep was deleted for: at 720 runs a month that was ~283,000
        // document reads, about 82 MB, roughly 8% of a 1 GB free-tier cap whose
        // failure mode is mutations FAILING rather than a bill. At 30 runs it is
        // ~11,800 reads. Putting this back to hourly would restore the original
        // bug in full and nothing else in the suite would notice.
        //
        // 01:15 KEEPS ITS OWN LANE, for the reason the other two do: all of these
        // are mutations that walk a table, and stacking them on one minute means
        // the whole deployment's table walks contend for the scheduler at once.
        // :30 is the chat sweep's and 00:45 is teamStats'.
        schedule: { type: 'daily', hourUTC: 1, minuteUTC: 15 },
        // NOT [{ budget: 800 }] — a cron's args are serialised when crons.ts is
        // EVALUATED, not when the job fires, so anything here is frozen at
        // deploy time forever. `maintain` defaults internally instead.
        args: [{}],
      },
      'chat notifications': {
        name: 'chatNotify:sweep',
        // MINUTE 30, ASSERTED RATHER THAN INCIDENTAL — but NOT for the reason
        // this comment used to give. It said moving this to 0 would put "both
        // sweeps' table walks and both bursts of push traffic" on one minute;
        // the hourly reminder sweep that held :00 is deleted, so this is now
        // the only hourly cron. Reminder push is STILL bursty — eighteen
        // `HH:00:00` local times, so same-zone players sharing a delivery time
        // land in the same millisecond; see crons.ts — it is just no longer
        // pinned to a cron minute, which is what makes this lane hold by
        // construction now. What the assertion protects is that lane: :30 never
        // coincides with `reminder maintenance` at 01:15 or `team month
        // aggregates` at 00:45, and nothing else in the suite would notice it
        // moving.
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
        // than up to a day after it. Minute 45 keeps its lane clear of the chat
        // sweep at :30 and of `reminder maintenance` at 01:15; :00, which the
        // deleted reminder sweep held, is free now.
        args: [{}],
        schedule: { type: 'daily', hourUTC: 0, minuteUTC: 45 },
      },
    })
  })
})
