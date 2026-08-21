#!/usr/bin/env node
/**
 * Runs migrate:deleteNamelessPlayers against a deployment. Step 2 of the Phase 4
 * schema sequence — see the design's "Prerequisite" section.
 *
 * Dry run by default. Pass --commit to actually write.
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

console.log(`target   : ${new URL(CONVEX_URL).host}`)
console.log(`mode     : ${commit ? 'COMMIT (writes)' : 'dry run'}`)

const report = await client.mutation(internal.migrate.deleteNamelessPlayers, {
  dryRun: !commit,
})

console.log(report)
if (!commit && report.namelessPlayers > 0) {
  console.log('\nRe-run with --commit to apply.')
}
