/**
 * WHETHER THE BACKGROUND SWEEPS RUN ON THIS DEPLOYMENT (wordle-teams-qjh3.1).
 *
 * Two crons in convex/crons.ts walk a table on a schedule whether or not anybody
 * is using the app: `chatNotify.sweep` hourly at :30 and `teamStats.sweep` daily
 * at 00:45. Their cost is O(data) x runs-per-month, so it grows with the data
 * rather than with the traffic — wordle-teams-yhii measured 460.26 MB of a 1 GB
 * free-tier database-I/O allowance consumed in 30 days with essentially NO user
 * traffic, and ~90% of it was these crons. This is the switch that stops them.
 *
 * THE CRON ENTRY STAYS. Each sweep returns immediately instead of being
 * unscheduled, so the cost falls to a no-op mutation against the 1M/month
 * function-call meter, which has enormous headroom, and the database I/O goes to
 * zero. Deleting the cron entry instead would need a DEPLOY to put back, and the
 * property that makes this worth building is that it flips with none — the same
 * reason wrangler.jsonc's MAINTENANCE var is a var.
 *
 * IT IS A PRODUCTION BRAKE, NOT A DEV ECONOMY, and reading it as the latter
 * undersells it. The free-tier meters are TEAM-scoped, not per deployment —
 * wordle-teams-yhii says so in its own words — so a second deployment draws on
 * the same pool. But the case this was really built for is the one
 * wordle-teams-dcu describes and has no answer to: the quota nearly exhausted
 * during launch week, with the failure mode being that MUTATIONS START FAILING
 * and players cannot save boards. Thirty seconds in the Convex dashboard stops
 * every byte of background I/O, without a deploy, during the incident.
 *
 * IT FAILS TOWARDS ON, AND THAT IS A DENY-LIST RATHER THAN AN ALLOW-LIST. This
 * is the same argument src/lib/sentry-config.ts and src/lib/robots-policy.ts each
 * make in their own headers, about their own values, for the same reason — the
 * two mistakes are not equals:
 *
 *   - Sweeps running where they were meant to be off costs a little database I/O.
 *     Visible on the dashboard, recoverable, and fixed by setting one variable.
 *   - Sweeps STOPPED where they were meant to run is silent. Team aggregates rot,
 *     the month-boundary net that teamStats.sweep exists to be is simply gone,
 *     and nothing in the app looks wrong while it happens.
 *
 * So ONLY the exact string 'false' disables them. Unset, empty, 'False', ' false'
 * and '0' all leave them running. Writing this as a truthiness check on the
 * variable, or as `!== 'true'`, reads as more careful and puts the invisible
 * failure one typo away.
 *
 * reminders.maintain IS DELIBERATELY NOT GATED ON THIS, and the omission is a
 * decision rather than an oversight — see the note beside its entry in
 * convex/crons.ts before "finishing the job".
 *
 * TAKES THE VALUE AS A PARAMETER rather than reading process.env itself, which
 * is what keeps the host's shell out of the assertions in sweeps.test.ts and
 * makes every call site say out loud which variable it consults. The same
 * argument src/lib/convex-url.ts makes for resolveConvexUrl's parameter.
 */

/** The one value that turns the sweeps off. Exported so no caller spells it. */
export const SWEEPS_DISABLED = 'false'

export function sweepsEnabled(value: string | undefined): boolean {
  return value !== SWEEPS_DISABLED
}
