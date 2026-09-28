/**
 * Empties the six migrated data tables on a Convex deployment, looped.
 *
 * WHAT IT ACTUALLY DELETES, because the mutation's name misleads and that
 * misreading IS wordle-teams-z8wz: `internal.migrate.purgeCopiedData` does NOT
 * filter on `legacyId`. It deletes EVERY row in dailyScores, monthlyWinners,
 * webhookEvents, playerMembership, teams and players — copied rows and v2-born
 * rows alike. "Copied" in its name describes the data the deployment is expected
 * to hold, not a filter it applies.
 *
 * That is exactly why it is the cutover's purge step. The final copy upserts on
 * `byLegacyId`, so it can never remove a v2-born row; only this can. Run it
 * immediately BEFORE the final copy and the deployment ends up holding exactly
 * v1's contents, which is what makes §4.5's verify-parity able to come back
 * clean.
 *
 * IT DOES NOT SIGN ANYONE OUT. Better Auth's component tables are untouched, and
 * `players` is resolved by EMAIL (`players.by_email`, via playerForEmail), not by
 * document id — so a re-copied player row re-links to the same account.
 *
 * Usage — same env shape as copy-from-supabase.mjs:
 *
 *   cd v2 && node --env-file=../.env.production.local --env-file=<convex env> \
 *     scripts/purge-copied-data.mjs --confirm-deployment=$CONVEX_URL
 *
 * The --confirm-deployment value must equal CONVEX_URL exactly. That is
 * deliberate friction: this is unrecoverable against the wrong deployment, and
 * pasting the URL is the one action that forces you to read which one it is.
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'
import { purgeLoop } from './lib/purge-loop.mjs'

const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const confirmed = arg('confirm-deployment')

if (!CONVEX_URL || !CONVEX_MIGRATION_KEY) {
  console.error('Set CONVEX_URL and CONVEX_MIGRATION_KEY (see the runbook §4.2).')
  process.exit(1)
}
if (confirmed !== CONVEX_URL) {
  console.error(
    confirmed === undefined
      ? `Refusing to run. Pass --confirm-deployment=${CONVEX_URL}`
      : `Refusing to run: --confirm-deployment did not match CONVEX_URL.\n` +
          `  --confirm-deployment=${confirmed}\n  CONVEX_URL=${CONVEX_URL}`,
  )
  process.exit(1)
}

console.log('')
console.log('  DELETING EVERY ROW in dailyScores, monthlyWinners, webhookEvents,')
console.log('  playerMembership, teams and players — copied AND v2-born — on:')
console.log(`      ${CONVEX_URL}`)
console.log('')

const convex = new ConvexHttpClient(CONVEX_URL)
convex.setAdminAuth(CONVEX_MIGRATION_KEY)

const started = Date.now()
const { totals, calls } = await purgeLoop(() =>
  convex.mutation(internal.migrate.purgeCopiedData, {
    confirm: 'yes-delete-all-copied-data',
  }),
)

const rows = Object.values(totals).reduce((a, b) => a + b, 0)
for (const [table, n] of Object.entries(totals).sort()) {
  console.log(`  ${table.padEnd(18)} ${String(n).padStart(6)}`)
}
console.log('')
console.log(`  ${rows} rows in ${calls} call${calls === 1 ? '' : 's'}, ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log('')
console.log('  NEXT: run the final copy (§4.2). The deployment is empty until you do.')
