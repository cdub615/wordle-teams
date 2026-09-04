#!/usr/bin/env node
/**
 * Measures what the copy actually left on this deployment's reminder fields, and
 * exits non-zero if a copied player could receive a reminder.
 *
 *   CONVEX_URL=... CONVEX_MIGRATION_KEY=... node scripts/verify-reminder-policy.mjs
 *
 * WHY THIS EXISTS. wt-ksh.7.32's code half shipped on 2026-09-02
 * (scripts/lib/copy-reminder-policy.mjs withholds the two fields that decide
 * eligibility; ten tests, nine mutations killed) but the issue stays open on one
 * clause: "verified by MEASURING beta after a run". A correct write path is an
 * INFERENCE about stored state. This is the measurement.
 *
 * IT IS NOT A SUBSTITUTE FOR THE UNIT TESTS AND DOES NOT DUPLICATE THEM. They
 * pin what reminderFieldsFor emits; this reads what is actually on the
 * deployment, including anything an EARLIER copy wrote before that policy
 * existed — which is the only thing a test of the current write path structurally
 * cannot see.
 *
 * PRINTS COUNTS, NEVER ROWS. This repo is public and these are real people.
 * convex/migrate.ts's reminderProbe returns counts only, by construction.
 *
 * WHY THE PASS CONDITION IS NOT "EVERY NUMBER IS ZERO". copy-reminder-policy.mjs
 * sends reminderDeliveryMethods EXPLICITLY EMPTY, so a re-run clears it — but it
 * OMITS timeZone rather than sending undefined, and says so: "anything an earlier
 * copy already wrote has to be measured and cleared deliberately, not assumed
 * away here." So a non-zero withTimeZone on copied rows is EXPECTED and is not a
 * failure, because eligibility needs both halves. What must be zero is
 * sweepEligible, and — for the acceptance criterion's literal wording —
 * withAnyMethod.
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'

const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY
if (!CONVEX_URL || !CONVEX_MIGRATION_KEY) {
  console.error('Set CONVEX_URL and CONVEX_MIGRATION_KEY.')
  process.exit(1)
}

// THE DEPLOYMENT IS NAMED BACK, LOUDLY. `convex run --prod` has silently fallen
// back to 127.0.0.1 in this project before and a measurement was reported
// against the wrong backend for a day (wt-ksh.7.32's own description). This
// client talks to whatever CONVEX_URL says and nothing else, so printing it is
// what makes the result attributable.
console.log(`Reading reminder state from: ${CONVEX_URL}`)

const convex = new ConvexHttpClient(CONVEX_URL)
convex.setAdminAuth(CONVEX_MIGRATION_KEY)
const probe = await convex.query(internal.migrate.reminderProbe, {})

const show = (label, t) => {
  console.log(`\n${label}  (${t.total} players)`)
  console.log(`  non-empty reminderDeliveryMethods   ${t.withAnyMethod}`)
  console.log(`  ...of those, a method the sweep acts on   ${t.withKnownMethod}`)
  console.log(`  timeZone present                    ${t.withTimeZone}`)
  console.log(`  BOTH halves — could be swept        ${t.sweepEligible}`)
}

show('COPIED from production (legacyId present)', probe.copied)
show('BORN IN v2 (no legacyId)', probe.v2Born)

// Only the copied bucket is judged. A v2-born player who set their own
// preferences through the UI is not the copy's doing, and counting them would
// fail this check for the one reason it must never fail (wt-ksh.7.32: "the
// answer will be ambiguous in exactly the direction that matters").
const failures = []
if (probe.copied.sweepEligible > 0) {
  failures.push(
    `${probe.copied.sweepEligible} copied player(s) hold BOTH a timeZone and a known delivery method`,
  )
}
if (probe.copied.withAnyMethod > 0) {
  failures.push(
    `${probe.copied.withAnyMethod} copied player(s) hold a non-empty reminderDeliveryMethods`,
  )
}

console.log('')
if (failures.length > 0) {
  for (const f of failures) console.log(`FAIL  ${f}`)
  console.log('\nThe withholding policy did not hold on this deployment.')
  console.log('REMINDERS_ENABLED gates the sweep, so this is not sending mail today —')
  console.log('but it means that env switch is again the only thing protecting.')
  process.exit(1)
}

console.log('PASS  no copied player can be swept.')
if (probe.copied.withTimeZone > 0) {
  console.log('')
  console.log(`NOTE  ${probe.copied.withTimeZone} copied player(s) still carry a timeZone from an`)
  console.log('      earlier copy. Expected: the policy omits the field rather than clearing it.')
  console.log('      Inert on its own — eligibility needs a delivery method too — but it is the')
  console.log('      "measured and cleared deliberately" that copy-reminder-policy.mjs defers.')
}
