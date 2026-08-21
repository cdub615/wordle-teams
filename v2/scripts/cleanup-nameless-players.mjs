#!/usr/bin/env node
/**
 * Runs migrate:deleteNamelessPlayers against a deployment. Step 2 of the Phase 4
 * schema sequence — see the design's "Prerequisite" section.
 *
 * Dry run by default. Pass --commit to actually write; --commit then prompts for
 * the target host and needs a TTY to answer on.
 *
 *   node scripts/cleanup-nameless-players.mjs
 *   node scripts/cleanup-nameless-players.mjs --commit
 *
 * Required environment: CONVEX_URL, CONVEX_MIGRATION_KEY.
 *
 * NOTE: `.env.local` at the repo root holds TWO sets of these under the same
 * names — the prod set commented out and above, the dev set active below. Beta
 * runs on the PROD set, and the cloud dev deployment has no functions deployed
 * at all. Load the prod block with:
 *
 *   set -a; . <(sed -n 's/^#[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*=.*\)/\1/p' ../.env.local); set +a
 *
 * This deliberately does NOT use `npx convex run`, which demands
 * deployment:data:view — a permission no key in this repo carries. The admin
 * HTTP path needs only runInternalMutations, which CONVEX_MIGRATION_KEY has.
 *
 * PRINTS COUNTS, NEVER ADDRESSES. This repository is public.
 */
import { createInterface } from 'node:readline/promises'
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'

const commit = process.argv.includes('--commit')
const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY

if (!CONVEX_URL || !CONVEX_MIGRATION_KEY) {
  console.error('Set CONVEX_URL and CONVEX_MIGRATION_KEY (see the header note).')
  process.exit(1)
}

const client = new ConvexHttpClient(CONVEX_URL)
client.setAdminAuth(CONVEX_MIGRATION_KEY)

const host = new URL(CONVEX_URL).host
console.log(`target   : ${host}`)
console.log(`mode     : ${commit ? 'COMMIT (writes)' : 'dry run'}`)

// TYPING THE HOST, NOT y/n. The likely mistake here is not "meant to dry run and
// typed --commit", it is running against the wrong deployment: .env.local holds a
// prod set and a dev set of CONVEX_URL/CONVEX_MIGRATION_KEY under the SAME names
// (see the header), so sourcing the wrong block aims this somewhere else with no
// other symptom. A y/n confirms the intent that was already expressed on the
// command line and catches none of that; retyping the host confirms the target.
if (commit) {
  if (!process.stdin.isTTY) {
    console.error('\nRefusing to --commit without a TTY to confirm on. Nothing was written.')
    process.exit(1)
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(
    `\nThis DELETES every nameless player on ${host} and cascades away any team\n` +
      `left with no members, including its monthlyWinners and scoringSystems.\n` +
      `It cannot be undone. Type the host to confirm: `,
  )
  rl.close()
  if (answer.trim() !== host) {
    console.error('Host did not match. Nothing was written.')
    process.exit(1)
  }
}

let report
try {
  report = await client.mutation(internal.migrate.deleteNamelessPlayers, {
    dryRun: !commit,
  })
} catch (err) {
  // A REFUSAL IS AN EXPECTED OUTCOME, NOT A CRASH. The mutation throws when a
  // nameless player turns out to own a dailyScore or a monthlyWinners row, and
  // that aborts the whole transaction — so this path means nothing was written,
  // which is worth saying out loud rather than leaving as an unhandled rejection
  // stack that reads like the script broke.
  console.error(`\nREFUSED — nothing was written.\n  ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}

console.log(report)
if (!commit && report.namelessPlayers > 0) {
  console.log('\nRe-run with --commit to apply.')
}
