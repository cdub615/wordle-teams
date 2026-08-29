import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import {
  alreadyRemindedToday,
  enteredOn,
  hasRecentActivity,
  isDueThisHour,
  localParts,
  METHODS,
  needsWeekendOptIn,
} from './lib/reminders.ts'
import { addDays } from './lib/puzzleDay.ts'
import { boardEntryReminderEmail } from './reminderEmails.ts'
import { sendEmail } from './email.ts'

const HOUR_MS = 60 * 60 * 1000

// Derived from METHODS (lib/reminders.ts) rather than re-typed as string
// literals, so the two `.includes()` checks below and settings.ts's
// membership guard cannot drift out of sync the way REMINDER_TIMES's own doc
// comment warns isDueThisHour and the settings picker could.
const [EMAIL_METHOD, PUSH_METHOD] = METHODS

/**
 * The hourly board-entry reminder sweep. Scheduled by crons.ts with no
 * arguments; `now` exists so tests can choose the instant instead of racing
 * the real clock — see the note on `now` below.
 *
 * WHY A MUTATION, NOT AN ACTION: eligibility has to be decided against one
 * consistent snapshot, the claim (`lastBoardEntryReminder`) has to commit in
 * the same transaction as that decision, and `sendEmail` enqueues into the
 * Resend component's own tables via `ctx.runMutation` — which only works
 * inside a mutation or another action, and here needs to be transactional
 * with the claim. Doing this as an action calling out to mutations would
 * split "decide" from "claim" across two non-atomic steps, and a partial
 * failure between them is exactly the double-send this design avoids. A
 * single mutation means an OCC retry (a write conflict, not an app-level
 * failure) simply re-runs the whole handler from scratch, having committed
 * nothing on the failed attempt — so the retry is clean by construction.
 *
 * TWO KILL SWITCHES, both checked before any player is claimed (owner
 * decision, 2026-08-28). Beta holds copied production rows — real people who
 * do not know this beta exists and who already get real reminders from v1. A
 * second reminder from an app they've never heard of is not something an
 * apology fixes, so this ships off by default:
 *
 *  - REMINDERS_ENABLED must be exactly 'true'. Unset (the default on every
 *    deployment, including beta) means no player is ever claimed. Nothing
 *    else in this codebase — not a copy, not a schema change, not a
 *    settings-UI bug — can turn reminders on; only an operator flipping this
 *    var can.
 *  - REMINDERS_ALLOWLIST, a comma-separated list of addresses, restricts
 *    delivery to exactly those players while beta is live alongside real
 *    users. Empty (the default) means unrestricted, which is what production
 *    wants at cutover. `players.email` is always stored lowercase, so the
 *    list is lowercased on read rather than trusting every future caller to
 *    compare case-insensitively.
 *
 * This env gate is the ONLY protection here — not a second layer on top of
 * "the data is empty anyway". The Supabase copy script does carry
 * reminderDeliveryMethods and timeZone for every copied player
 * (scripts/copy-from-supabase.mjs), and E2E_TEST_MODE is not set on beta, so
 * sendEmail's throwaway-address suppression does not apply there either.
 */
export const sweep = internalMutation({
  // OPTIONAL, NOT A BUG TO "FIX" BACK TO REQUIRED. Convex's Crons.schedule
  // serialises a cron's args to JSON when the module defining the cron is
  // evaluated (convex/server/cron.js: `args: [convexToJson(cronArgs)]`,
  // called from `crons.hourly(...)` at module scope) — NOT when the job
  // fires. Passing `{ now: Date.now() }` from crons.ts would freeze `now` at
  // deploy time forever, exactly reproducing v1's email-subject bug (a Zod
  // default evaluated once at module load, stamping every reminder with the
  // date the server happened to boot). So crons.ts passes no args at all,
  // and the handler defaults to `Date.now()` — which, read here inside a
  // mutation, is the transaction timestamp, not a frozen value. Tests keep
  // passing `now` explicitly so they can choose the instant.
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now: nowArg }) => {
    // GATE 1.
    if (process.env.REMINDERS_ENABLED !== 'true') {
      return { claimed: 0, gated: 'disabled' as const }
    }

    // Read once, before anyone is claimed, rather than per-player after the
    // claim (the plan's original shape, which would have patched
    // `lastBoardEntryReminder` on every eligible player and then silently
    // skipped every send). Throwing rolls the whole transaction back —
    // nobody is claimed, and every eligible player matches again on the next
    // tick once the deployment is fixed.
    //
    // ALSO GATES PUSH, which does not itself need SITE_URL — pushSend.deliverTo's
    // payload is a relative `url: '/'`. SITE_URL must be set for `convex
    // deploy` to succeed (auth.ts:16-17 throws at module scope) but NOT to
    // keep running: an operator can remove it from a live deployment
    // afterward, and reminders.ts never imports auth.ts, so nothing forces
    // the var to still be present when the cron fires. This branch is
    // reachable, and a push-only player losing delivery because of it is an
    // accepted, live consequence of hoisting the check here.
    const siteUrl = process.env.SITE_URL
    if (!siteUrl) {
      throw new Error('[reminders] SITE_URL is not set on this deployment')
    }

    // GATE 2.
    const allowlist = new Set(
      (process.env.REMINDERS_ALLOWLIST ?? '')
        .split(',')
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address.length > 0),
    )

    const now = nowArg ?? Date.now()
    const at = new Date(now)
    const anHourAgo = new Date(now - HOUR_MS)

    // No index narrows "every player who might be due this hour" ahead of
    // the per-player checks below, and production holds only 533 rows, so a
    // bounded collect is the right shape here on its own terms — unlike the
    // `teams` collect further down, this one has nothing to do with array
    // membership.
    const players = await ctx.db.query('players').collect()

    // Cheapest predicates first (a field check, a known-method check, a Set
    // lookup) so that a player who cannot possibly be due — no timeZone, no
    // KNOWN delivery method (a copied row can carry an unvalidated string
    // like 'sms' — see METHODS above), not on the allowlist — never reaches
    // localParts at all. Everyone else still runs it below regardless of
    // this ordering: isDueThisHour needs BOTH bounds resolved in the
    // player's own zone before it can say anything, so no cheaper predicate
    // could gate the timezone math itself, and reordering these three checks
    // to run AFTER localParts would not change which players reach the
    // `dailyScores` query later in the loop — only which players pay for a
    // localParts call first. THAT is what this ordering actually saves:
    // `sweep` makes two or three localParts calls per player (`local`,
    // `hourAgo`, and a third inside alreadyRemindedToday when a stamp
    // already exists) — each one Intl call — which is cheap either way at
    // 533 players. The `dailyScores` query is gated by isDueThisHour and
    // alreadyRemindedToday, not by this ordering: those two are what actually
    // shrink the candidate set, to one of eighteen reminder hours in a
    // half-hour-offset zone, or two in a whole-hour-offset one
    // (isDueThisHour's inclusive bounds — see its own doc comment on the
    // double-match property).
    const candidates = players.flatMap((player) => {
      const timeZone = player.timeZone
      if (!timeZone) return []
      if (!player.reminderDeliveryMethods.some((m) => (METHODS as ReadonlyArray<string>).includes(m)))
        return []
      if (allowlist.size > 0 && !allowlist.has(player.email)) return []

      let local, hourAgo
      try {
        local = localParts(timeZone, at)
        hourAgo = localParts(timeZone, anHourAgo)
      } catch (error) {
        // updateTimeZoneFor rejects an unresolvable zone, but a row copied
        // from Supabase never passed through it. One bad row must not take
        // the batch down with it.
        console.error(
          '[reminders] unresolvable timeZone on a player',
          { playerId: player._id, timeZone },
          error,
        )
        return []
      }

      if (!isDueThisHour(player.reminderDeliveryTime, local.time, hourAgo.time)) return []
      if (alreadyRemindedToday(player.lastBoardEntryReminder, timeZone, local.day)) return []
      return [{ player, localDay: local.day }]
    })

    if (candidates.length === 0) return { claimed: 0 }

    // Collected once, and only when somebody's LOCAL day is a weekend — five
    // days a week this read never happens. Convex cannot index array
    // membership, so this is the sanctioned shape (see schema.ts's note on
    // the `teams` table).
    const anyWeekendCandidate = candidates.some((c) => needsWeekendOptIn(c.localDay))
    const teams = anyWeekendCandidate ? await ctx.db.query('teams').collect() : []

    let claimed = 0
    for (const { player, localDay } of candidates) {
      // ONE range query answers both remaining questions: has today's board
      // already been entered, and has this player played recently enough to
      // still be worth reminding.
      const scores = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) =>
          q
            .eq('playerId', player._id)
            .gte('puzzleDay', addDays(localDay, -10))
            .lte('puzzleDay', localDay),
        )
        .collect()
      const days = scores.map((score) => score.puzzleDay)

      if (enteredOn(days, localDay)) continue
      if (!hasRecentActivity(days, localDay)) continue

      if (needsWeekendOptIn(localDay)) {
        const playsWeekends = teams.some(
          (team) => team.playWeekends && team.playerIds.includes(player._id),
        )
        if (!playsWeekends) continue
      }

      // CLAIM BEFORE DELIVERING, UNCONDITIONALLY — not behind an `if` on
      // whatever sendEmail/scheduling below returns or does. isDueThisHour's
      // doc comment measures that most players (any whole-hour-offset zone)
      // match TWICE a day: once as the upper bound of one hourly tick, once
      // as the lower bound of the next. Nobody is ever missed, but the only
      // thing standing between that and two emails a day is
      // alreadyRemindedToday reading a stamp that was already written. Move
      // this write after a successful send, or condition it on one, and the
      // common case — not an edge case — starts double-sending.
      await ctx.db.patch(player._id, { lastBoardEntryReminder: now })
      claimed += 1

      if (player.reminderDeliveryMethods.includes(EMAIL_METHOD)) {
        const { subject, html, text } = boardEntryReminderEmail({
          firstName: player.firstName,
          siteUrl,
        })
        await sendEmail(ctx, {
          from: 'Wordle Teams <reminders@wordleteams.com>',
          to: player.email,
          subject,
          html,
          text,
        })
      }

      if (player.reminderDeliveryMethods.includes(PUSH_METHOD)) {
        await ctx.scheduler.runAfter(0, internal.pushSend.deliverTo, {
          playerId: player._id,
          attempt: 0,
        })
      }
    }

    return { claimed }
  },
})
