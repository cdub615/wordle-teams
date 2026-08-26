#!/usr/bin/env node
/**
 * Clears `teams.creator` — step 4 of the five-step `creator` → `owner` rename
 * (Phase 5). Run this only after step 3 (the reader switch) is deployed.
 *
 *   CONVEX_URL=... CONVEX_MIGRATION_KEY=... node scripts/clear-team-creator.mjs
 *   ... same command with --execute to actually write.
 *
 * NO `--env-file`, deliberately, unlike copy-from-supabase.mjs and
 * verify-parity.mjs. Those two load ../.env.production.local because they read
 * Supabase and need its URL and service-role key. This script never touches
 * Supabase; it needs exactly the two CONVEX_* values above, and that file holds
 * 58 Vercel-generated secrets and none of them (measured 2026-08-26: zero keys
 * matching CONVEX). Sourcing it here would push production Postgres, Sentry and
 * QStash credentials into a process that has no use for them — and this is a
 * line someone copy-pastes at deploy time.
 *
 * WHY A SCRIPT AND NOT `npx convex run`. `npx convex run` requires a key with
 * deployment:data:view, which no key in this repository carries. The migration
 * key carries deployment:functions:runInternalMutations, which is what
 * ConvexHttpClient.setAdminAuth below uses. That is the whole reason this file
 * exists rather than a one-line command in the runbook.
 *
 * WHY A SEPARATE STEP FROM THE BACKFILL. Convex validates the schema against
 * every existing document on push, so `creator` can only leave the schema once
 * no document carries it — and it can only be cleared from documents once no
 * deployed code reads it. Those two constraints point in opposite directions,
 * which is why the rename is a five-step deploy rather than one commit: add
 * `owner` beside `creator`, backfill it, switch every reader (done), clear
 * `creator` (this script), then drop it. Had the backfill cleared `creator` in
 * the same pass, it would have blanked the field the then-deployed code was
 * still reading, and every team on beta would have been owner-less — no
 * settings, no invites, no deletion — until the reader switch landed.
 *
 * ORDER IS NOT OPTIONAL. If this runs before the reader switch is deployed, it
 * causes exactly that outage. Confirm the deployment is running step 3 code
 * before you run this with --execute.
 *
 * REFUSES A TEAM WITH A CREATOR AND NO OWNER. internal.migrate.clearTeamCreator
 * throws on the first one it finds, and Convex rolls the whole transaction back,
 * so a refused run clears nothing rather than stopping half way. That is an
 * incomplete backfill surfacing one step before the schema drop makes it
 * irreversible: re-run scripts/backfill-team-owner.mjs --execute, then this.
 *
 * IT PRINTS THE OFFENDING teamId, which is the one exception to "counts only"
 * below and is not a PII leak — a Convex document id is an opaque key, not a
 * team name or an address. It survives to the operator's screen only because
 * the mutation throws a ConvexError with the id in `data`: a plain Error would
 * arrive redacted as "Server Error" from a production-vars deployment. See the
 * catch below, which reads `data` explicitly.
 *
 * SAFE TO RE-RUN. It only touches teams that still carry a creator, so a second
 * run reports `creator cleared 0`. Nothing can reintroduce one either —
 * createTeamFor writes `owner` as of step 3 — so unlike the backfill this
 * script has no "unless a team was created in between" caveat.
 *
 * DRY RUN BY DEFAULT, which is the opposite of copy-from-supabase.mjs's opt-in
 * `--dry-run`. Deliberate: that script is the one everybody expects to write,
 * whereas this one exists to be run once against a live deployment, so the
 * harmless invocation should be the one you get by typing the short command.
 *
 * A `creator cleared 0` IS ONLY MEANINGFUL IF THE DEPLOYMENT HOLDS TEAMS.
 * Against an empty or wrong deployment it means "there was nothing here to
 * clear"; against an already-cleared one it means "no team carries a creator any
 * more". Those two readings are what the count cannot distinguish — `scanned`
 * can, and does, which is why the guard below refuses a run that scanned
 * nothing. Check `scanned` is the number of teams you expect before reading
 * anything into `creator cleared`.
 *
 * PRINTS COUNTS, NEVER A TEAM NAME OR AN ADDRESS. This repository is public.
 *
 * DELETE THIS SCRIPT IN TASK 2c, along with the mutation it calls. Once
 * `creator` is gone from the schema there is nothing left for it to clear.
 */
import { ConvexHttpClient } from 'convex/browser'
import { ConvexError } from 'convex/values'
import { internal } from '../convex/_generated/api.js'

const args = process.argv.slice(2)
const has = (flag) => args.includes(flag)

// REFUSES ANYTHING IT DOES NOT RECOGNISE. Whether this script writes is decided
// by the presence of one flag, so a typo does not fail — it silently downgrades
// to a dry run, and `--exectue` would report the work as still pending after
// you believed you had done it. Note this is stricter than copy-from-supabase
// .mjs and verify-parity.mjs, which validate the VALUE of --scope= but ignore
// unknown flags entirely; the asymmetry is deliberate, not precedent.
const KNOWN = ['--execute']
const unknown = args.filter((a) => !KNOWN.includes(a))
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(' ')}. The only flag is --execute.`)
  process.exit(1)
}

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

console.log(`Clearing teams.creator (${execute ? 'EXECUTE' : 'dry run'})...`)

// UNWRAPS ConvexError.data RATHER THAN LETTING THE THROW REACH THE TOP. An
// unhandled rejection prints a stack whose message, on a production-vars
// deployment, is the redacted "Server Error" — the mutation goes to the trouble
// of putting the team id in `data` precisely so it survives that, and only an
// explicit read of `err.data` gets it onto the operator's screen. `data` is the
// only field guaranteed to cross the wire intact; `err.message` is not.
let result
try {
  result = await convex.mutation(internal.migrate.clearTeamCreator, { dryRun: !execute })
} catch (err) {
  if (err instanceof ConvexError && err.data?.code === 'CREATOR_WITHOUT_OWNER') {
    console.error('\nRefused: a team still carries a creator but has no owner.')
    console.error(`  teamId  ${err.data.teamId}`)
    console.error(
      '\nNothing was written — the mutation throws before its first patch and Convex\n' +
        'rolls the transaction back, so this is a clean stop, not a half-done run.\n' +
        'This means the backfill is incomplete. Fix it by re-running:\n' +
        '  CONVEX_URL=... CONVEX_MIGRATION_KEY=... node scripts/backfill-team-owner.mjs --execute\n' +
        'then run this script again.',
    )
    process.exit(1)
  }
  // Anything else is not this failure mode, and guessing at it would be worse
  // than showing the operator what actually came back.
  console.error(`\nThe mutation failed: ${err.message}`)
  if (err instanceof ConvexError) console.error(`  data: ${JSON.stringify(err.data)}`)
  process.exit(1)
}

const { scanned, cleared } = result

const row = (label, n) => console.log(`  ${label.padEnd(30)} ${n}`)
row('teams scanned', scanned)
row(execute ? 'creator cleared' : 'creator that would be cleared', cleared)

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
  `\nDone. ${cleared} team(s) had creator cleared; every one of them already carried an\n` +
    'owner, which the mutation verified before writing. The field can now be dropped\n' +
    'from the schema in step 5.',
)
process.exit(0)
