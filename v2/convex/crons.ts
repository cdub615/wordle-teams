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

export default crons
