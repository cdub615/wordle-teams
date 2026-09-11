import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

/**
 * Phase 6's board-entry reminders. NO LONGER THE MECHANISM — it is the net.
 *
 * WHAT THIS REPLACED, AND WHY (wordle-teams-spcu). This was
 * `crons.hourly('board entry reminders', { minuteUTC: 0 }, internal.reminders.sweep, {})`,
 * and that sweep opened with a full `players` collect on every one of its 720
 * monthly runs: ~283,000 document reads, about 82 MB, roughly 8% of a 1 GB
 * free-tier database-I/O cap whose failure mode is mutations FAILING rather
 * than generating a bill (wordle-teams-dcu). THAT COST WAS NOT A FUTURE ONE.
 * The plan's text for this comment said the scan cost nothing while
 * REMINDERS_ENABLED was empty, deferring the whole bill to whoever set that
 * variable on cutover day; Task 5 had already measured the flag as 'true' on
 * beta and the collect as sitting above the allowlist filter, so the scan had
 * been running there all along. See the "IT IS NOT A FUTURE COST" paragraph on
 * `internal.reminders.deliver`, which is the one authoritative statement of it
 * and says so.
 *
 * HOURLY WAS NOT THE WASTE, which is worth knowing before "optimising" the
 * cadence again. Reminder times are local, and with 57 distinct player timezones
 * somebody is due in nearly every UTC hour — measured: America/Chicago alone
 * covers 18 of the 24, and Europe/London covers exactly the six it misses. So a
 * sweep that only ran in hours where somebody was due would still run 24 times a
 * day. The waste was reading all 393 players to find the handful owed.
 *
 * THE MECHANISM IS NOW ONE SCHEDULED JOB PER PLAYER, each rescheduling the next
 * as its last act (internal.reminders.deliver). What remains here derives
 * `playsWeekends`, repairs a chain whose job never fired, and bootstraps a player
 * who never had one — see the doc comment on `maintain` for why that is
 * load-bearing rather than optional, and why it must stay DAILY.
 *
 * 01:15 KEEPS ITS OWN LANE. The chat sweep holds :30 hourly and teamStats holds
 * 00:45 daily; all three walk a table, and stacking them on one minute means the
 * whole deployment's table walks contend at once.
 *
 * `{}` AND NOTHING ELSE, for the reason the other two say: a cron's args are
 * serialised to JSON when THIS MODULE is evaluated, not when the job fires.
 * `maintain` takes an optional `budget` for its tests, and passing one here
 * would freeze it at deploy time — harmless for a constant, but the habit is
 * what froze v1's email subject at server-boot time.
 *
 * THE EMPTY OBJECT ITSELF IS NOT OPTIONAL, which is the other half of what the
 * deleted `sweep`'s entry said here and is unchanged for `maintain`.
 * TypeScript's `OptionalRestArgs` only lets the whole args parameter be omitted
 * when a function's args type is exactly empty; `{ budget?: number }` has a
 * property, even though that property is optional, so the object has to be
 * supplied, just with nothing in it. MEASURED: dropping the `{}` fails
 * typecheck with "Expected 4 arguments, but got 3".
 */
crons.daily('reminder maintenance', { hourUTC: 1, minuteUTC: 15 }, internal.reminders.maintain, {})

/**
 * Team chat's batched push sweep (Phase 7.5, design §5).
 *
 * AT HALF PAST, NOT ON THE HOUR, AND THAT IS THE DECISION RATHER THAN A
 * DEFAULT — though WHAT it is kept apart from has changed. It was written
 * against the hourly board-entry reminder sweep at :00: both were mutations
 * that walked a table and scheduled `pushSend.deliverTo` jobs, so sharing a
 * minute meant one deployment-wide burst of push traffic every hour and two
 * table walks contending for the scheduler at once. That sweep is gone, and
 * this is now the only hourly cron in the deployment; the two it stays clear
 * of are `reminder maintenance` at 01:15 and `team month aggregates` at 00:45.
 * Reminder push traffic is no longer bursty at all — `reminders.deliver` fires
 * one job per player at that player's own local time. Half past still costs
 * nothing — chat notifications are already an hour coarse by design — and it
 * keeps a slow run of one cron from being tangled up with another when
 * something needs diagnosing.
 *
 * `{}` AND NOTHING ELSE, for the same reason spelled out above: a cron's args
 * are serialised to JSON when THIS MODULE is evaluated, not when the job fires.
 * `sweep` takes no arguments at all (`args: {}`), so there is nothing here that
 * COULD be frozen today — but the empty object is still the only correct value,
 * and the reason it stays empty is worth knowing before somebody adds an
 * argument to make this testable the way `reminders.maintain`'s `budget` makes
 * that pass testable.
 */
crons.hourly('chat notifications', { minuteUTC: 30 }, internal.chatNotify.sweep, {})

/**
 * Layer 3's per-team-per-month aggregate (wordle-teams-s7q2).
 *
 * AT QUARTER TO, for the reason the chat sweep is at half past: all three are
 * mutations that walk a table, and stacking them on one minute means the whole
 * deployment's table walks contend for the scheduler at once. This one reads
 * `teams` and every member's boards for the current month, so it is the heaviest
 * of the three and has the most to gain from a lane of its own.
 *
 * IT IS A SAFETY NET RATHER THAN THE MECHANISM, and reading it as the mechanism
 * would be the misunderstanding worth preventing: the aggregate is kept correct
 * by winners.ts's recomputeTeamMonth, which runs on every board write for that
 * board's own month — including a backfilled month from last year, which this
 * cron deliberately never touches. What this catches is a month boundary passing
 * with nobody playing, and any future write path that forgets. See
 * convex/teamStats.ts for the full statement of the two triggers.
 *
 * DAILY, NOT HOURLY, AND THAT CHANGE PAID FOR ITSELF (wordle-teams-yhii).
 * MEASURED 2026-09-10: the Convex deployment was using 460.26 MB of its 1 GB
 * free-tier database I/O in 30 days — 45% — while Cloudflare recorded 8,910
 * Worker invocations and 0 req/sec over the same window. Almost nobody was
 * visiting, so almost none of that was users: modelling the user half from the
 * reads pinned in dashboardBandwidth.test.ts gives roughly 33 MB. The rest was
 * these three crons, and this one is the heavy one.
 *
 * THE COST WAS O(data) x 720 A MONTH. Every board written made all 720 of the
 * next month's sweeps heavier, so the bill grew with the DATA rather than with
 * the traffic — and the free-tier cap is HARD: mutations start failing rather
 * than generating an invoice (wordle-teams-dcu). Hitting it means players cannot
 * save boards, and the launch email is aimed at reactivating 322 dormant
 * accounts, so the data was about to grow at exactly the wrong moment.
 *
 * 24x FEWER RUNS, AND THE PROPERTY IS UNCHANGED. What the sweep exists for is a
 * month boundary passing unobserved; that happens twelve times a year, not 8,760.
 * The exposure it adds is bounded and small: a team whose aggregate is stale can
 * stay stale for up to a day rather than up to an hour — and only when NOBODY on
 * that team writes a board, because any write repairs it through the real
 * mechanism.
 *
 * HOUR 0 IS DELIBERATE. toPuzzleDay uses local date methods and the Convex
 * runtime is UTC, so the month rolls over at 00:00 UTC. Running at 00:45 puts
 * the one run that matters 45 minutes after the boundary it exists to catch,
 * rather than up to 24 hours after it. Minute 45 is kept for the original
 * reason: the other two sweeps hold :00 and :30, and this one keeps its lane.
 */
crons.daily('team month aggregates', { hourUTC: 0, minuteUTC: 45 }, internal.teamStats.sweep, {})

export default crons
