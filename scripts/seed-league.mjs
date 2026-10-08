#!/usr/bin/env node
/**
 * SEED A PUBLIC LEAGUE ON ONE DEPLOYMENT (wordle-teams-zic8.3).
 *
 * Calls internal.leagues.seedLeague({ slug }) ONCE with the migration key and
 * prints the league id. Nothing else is read or written. The mutation is
 * idempotent (seedLeagueFor matches by slug), so a re-run renames and reorders
 * but never duplicates.
 *
 *   CONVEX_URL=https://<deployment>.convex.cloud CONVEX_MIGRATION_KEY=... \
 *     node scripts/seed-league.mjs --confirm-host=<deployment>.convex.cloud [--slug=starting-words]
 *
 * WHY NOT `convex run leagues:seedLeague`. On this machine `convex run` silently
 * targets the LOCAL backend (even with --prod), and its key has no permission on
 * beta (bd memory convex-env-and-key-scopes). An admin-authed ConvexHttpClient
 * goes exactly where CONVEX_URL says, as scripts/measure-insights-pairs.mjs does.
 *
 * NO DEFAULTS FOR THE TARGET. CONVEX_URL and CONVEX_MIGRATION_KEY must both be
 * set explicitly; load them BY NAME, never the whole commented block of
 * .env.local. The target host is printed FIRST, and the script refuses to write
 * unless --confirm-host=<that exact host> is passed (the confirmation flag
 * redate-misdated-boards.mjs and rac-duplicate-scores.mjs use).
 *
 * SEED EARLY IN A MONTH: see seedLeague's docstring in convex/leagues.ts.
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'

const flag = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const url = process.env.CONVEX_URL
const key = process.env.CONVEX_MIGRATION_KEY
if (!url || !key) {
  console.error('CONVEX_URL and CONVEX_MIGRATION_KEY are both required; there are no defaults.')
  process.exit(1)
}

let host
try {
  host = new URL(url).hostname
} catch {
  console.error(`CONVEX_URL is not a URL: ${url}`)
  process.exit(1)
}
console.log(`TARGET HOST: ${host}`)

const confirmed = flag('confirm-host')
if (confirmed !== host) {
  console.error(`REFUSING TO WRITE. Re-run with --confirm-host=${host} to seed this deployment.`)
  process.exit(1)
}

const slug = flag('slug') ?? 'starting-words'
console.log(`SEEDING: ${slug}`)

const client = new ConvexHttpClient(url)
client.setAdminAuth(key)
const leagueId = await client.mutation(internal.leagues.seedLeague, { slug })
console.log(`LEAGUE ID: ${leagueId}`)
