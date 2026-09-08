import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

/**
 * Phase 6's replacement for v1's board-entry reminders (two Next.js API
 * routes plus Novu and QStash): one hourly Convex cron.
 *
 * NO VALUE FOR `now` IS PASSED — the trailing `{}` is an empty args object,
 * required because TypeScript's `OptionalRestArgs` only lets the whole args
 * parameter itself be omitted when a function's args type is exactly empty;
 * `sweep`'s (`{ now?: number }`) has a property, even though that property
 * is optional, so the object has to be supplied, just with nothing in it.
 * See the doc comment on `sweep`'s `now` argument (convex/reminders.ts) for
 * why it must stay empty: a cron's args are serialised to JSON when THIS
 * MODULE is evaluated, not when the job fires, so `{ now: Date.now() }` here
 * would freeze `now` at deploy time forever. `sweep` defaults to
 * `Date.now()` internally instead, which — read inside the mutation — is the
 * transaction timestamp at the moment each hourly run actually executes.
 */
const crons = cronJobs()

crons.hourly('board entry reminders', { minuteUTC: 0 }, internal.reminders.sweep, {})

/**
 * Team chat's batched push sweep (Phase 7.5, design §5).
 *
 * AT HALF PAST, NOT ON THE HOUR, AND THAT IS THE DECISION RATHER THAN A
 * DEFAULT. Both sweeps are mutations that walk a table and schedule
 * `pushSend.deliverTo` jobs, so stacking them on the same minute means one
 * deployment-wide burst of push traffic every hour and two table walks
 * contending for the scheduler at once. They also share a writer: the chat
 * sweep patches `chatReads`, which the reminder sweep does not touch, but both
 * read `players` and both enqueue into `_scheduled_functions`. Separating them
 * by thirty minutes costs nothing — chat notifications are already an hour
 * coarse by design — and it keeps a slow run of one from being tangled up with
 * the other when something needs diagnosing.
 *
 * `{}` AND NOTHING ELSE, for the same reason spelled out above: a cron's args
 * are serialised to JSON when THIS MODULE is evaluated, not when the job fires.
 * `sweep` takes no arguments at all, so there is nothing here that COULD be
 * frozen today — but the empty object is still the only correct value, and the
 * reason it stays empty is worth knowing before somebody adds a `now` to make
 * this testable the way reminders.sweep's is.
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
 */
crons.hourly('team month aggregates', { minuteUTC: 45 }, internal.teamStats.sweep, {})

export default crons
