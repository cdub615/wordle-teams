#!/usr/bin/env node
/**
 * Backfills `teams.owner` from `teams.creator` — step 2 of the five-step
 * `creator` → `owner` rename (Phase 5).
 *
 *   CONVEX_URL=... CONVEX_MIGRATION_KEY=... \
 *     node --env-file=../.env.production.local scripts/backfill-team-owner.mjs
 *   ... same command with --execute to actually write.
 *
 * WHY A SEPARATE STEP. Convex validates the schema against every existing
 * document on push, so `creator` can only leave the schema once no document
 * carries it — and it can only be cleared from documents once no deployed code
 * reads it. Those two constraints point in opposite directions, which is why the
 * rename is a five-step deploy rather than one commit: add `owner` beside
 * `creator` (done), backfill it (this script), switch every reader, clear
 * `creator`, then drop it. Beta holds natively-created teams that a re-copy
 * could not restore, so it has to keep working at every step.
 *
 * SAFE TO RE-RUN. internal.migrate.backfillTeamOwner only touches teams that
 * have a creator and no owner yet, so a second run reports `updated 0`. It does
 * NOT clear `creator` — at the point this runs the deployed code still reads
 * that field, and blanking it here would leave every team on beta owner-less
 * until the next deploy landed.
 *
 * DRY RUN BY DEFAULT, which is the opposite of copy-from-supabase.mjs's opt-in
 * `--dry-run`. Deliberate: that script is the one everybody expects to write,
 * whereas this one exists to be run once against a live deployment, so the
 * harmless invocation should be the one you get by typing the short command.
 *
 * A ZERO IS ONLY MEANINGFUL IF THE DEPLOYMENT HOLDS TEAMS. `scanned 0, updated
 * 0` against an empty or wrong deployment looks exactly like a clean no-op
 * against a fully backfilled one. `scanned` is the team count, so check it is
 * the number you expect before reading anything into `updated`.
 *
 * PRINTS COUNTS, NEVER A TEAM NAME OR AN ADDRESS. This repository is public.
 *
 * DELETE THIS SCRIPT IN TASK 2c, along with the mutation it calls. Once
 * `creator` is gone from the schema there is nothing left for it to copy.
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)
const execute = has('--execute')

const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY
if (!CONVEX_URL || !CONVEX_MIGRATION_KEY) {
  console.error('Set CONVEX_URL and CONVEX_MIGRATION_KEY.')
  process.exit(1)
}

// Unlike copy-from-supabase.mjs's --dry-run, this one still calls the
// deployment: the count it reports is the count the real run would act on, and
// only the mutation can know that. So the key is required either way.
const convex = new ConvexHttpClient(CONVEX_URL)
convex.setAdminAuth(CONVEX_MIGRATION_KEY)

console.log(`Backfilling teams.owner from teams.creator (${execute ? 'EXECUTE' : 'dry run'})...`)
const { scanned, updated } = await convex.mutation(internal.migrate.backfillTeamOwner, {
  dryRun: !execute,
})

const row = (label, n) => console.log(`  ${label.padEnd(30)} ${n}`)
row('teams scanned', scanned)
row(execute ? 'owners written' : 'owners that would be written', updated)

if (scanned === 0) {
  console.log(
    '\nScanned 0 teams. That is not a clean run — it means this deployment holds no\n' +
      'teams at all. Check CONVEX_URL points where you think it does.',
  )
  process.exit(1)
}

if (!execute) {
  console.log('\nDry run: nothing written. Re-run with --execute to apply.')
  process.exit(0)
}

console.log(
  `\nDone. ${updated} team(s) gained an owner; creator was left in place on purpose —\n` +
    'the deployed code still reads it until the reader switch ships.',
)
process.exit(0)
