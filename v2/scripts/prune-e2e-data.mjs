#!/usr/bin/env node
/**
 * Removes e2e test debris from a deployment. DRY RUN BY DEFAULT.
 *
 *   # look, change nothing
 *   CONVEX_ADMIN_KEY=... node scripts/prune-e2e-data.mjs --url=http://127.0.0.1:3210
 *
 *   # actually delete
 *   CONVEX_ADMIN_KEY=... node scripts/prune-e2e-data.mjs --url=http://127.0.0.1:3210 --execute
 *
 * WHY THIS EXISTS (wordle-teams-1cd). Every e2e run creates accounts, teams and
 * boards and nothing removed any of it — no globalTeardown, no afterAll. A
 * snapshot export of the local anonymous backend on 2026-08-26 held 2520
 * players, 1680 teams, 7915 dailyScores and 311 monthlyWinners, all of it e2e
 * debris. The rule for what counts as debris, and the argument for why it cannot
 * name a legitimate row, live in convex/e2ePrune.ts and convex/lib/e2e.ts.
 *
 * THE URL IS A REQUIRED FLAG AND IS NEVER READ FROM THE ENVIRONMENT. That is
 * deliberate and it is the single most important line in this file: `CONVEX_URL`
 * in v2/.env.local points at PRODUCTION, and any script here that fell back to
 * it would delete production the first time somebody ran it after sourcing that
 * file. There is no fallback. The admin key comes from CONVEX_ADMIN_KEY — a name
 * NOT used anywhere else in this repo, so it cannot be satisfied by the
 * CONVEX_MIGRATION_KEY that is paired with the production URL.
 *
 * The deeper guard is on the other side: convex/e2ePrune.pruneBatch is an
 * internalMutation that refuses unless E2E_TEST_MODE === 'true'. Production must
 * not carry that flag; lib/e2e.ts records that this is still a requirement
 * rather than a verified fact (wordle-teams-7az), which is why the belt above
 * exists alongside the braces.
 *
 * PRINTS COUNTS, NEVER AN ADDRESS AND NEVER A TEAM NAME. This repository is
 * public and these reports get pasted into it. The mutation returns nothing but
 * numbers, so there is nothing here to redact.
 *
 * REJECTS UNKNOWN FLAGS (wordle-teams-xs3 records that sibling scripts silently
 * ignore them — a typo'd `--dry-run` on a script whose default is already a dry
 * run is harmless, but a typo'd `--exceute` that is ignored is a script that
 * deletes nothing while reporting success, and `--execute` misspelt the other
 * way round is worse).
 */
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'

const KNOWN_FLAGS = ['--url=', '--page-size=', '--execute', '--allow-mixed']

const fail = (message) => {
  console.error(`\n${message}\n`)
  process.exit(1)
}

// --- argv ---------------------------------------------------------------------

const argv = process.argv.slice(2)
let url
let pageSize
let execute = false
let allowMixed = false

for (const arg of argv) {
  if (arg.startsWith('--url=')) url = arg.slice('--url='.length)
  else if (arg.startsWith('--page-size=')) pageSize = Number(arg.slice('--page-size='.length))
  else if (arg === '--execute') execute = true
  else if (arg === '--allow-mixed') allowMixed = true
  else fail(`Unknown argument ${JSON.stringify(arg)}. Accepted: ${KNOWN_FLAGS.join(' ')}`)
}

if (!url) {
  fail(
    'Pass --url=<deployment url> explicitly. It is never read from the environment: CONVEX_URL\n' +
      'in v2/.env.local is PRODUCTION, and a fallback to it would make this script delete production.',
  )
}
if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1)) {
  fail(`--page-size must be a positive integer; got ${JSON.stringify(pageSize)}.`)
}

const adminKey = process.env.CONVEX_ADMIN_KEY
if (!adminKey) {
  fail(
    'Set CONVEX_ADMIN_KEY to the admin/deploy key for THAT deployment.\n' +
      'For the local anonymous backend it is the `adminKey` in v2/.convex/local/default/config.json.',
  )
}

// --- the pass -----------------------------------------------------------------

const convex = new ConvexHttpClient(url)
convex.setAdminAuth(adminKey)

// A HAND-MAINTAINED DUPLICATE OF PruneBatchReport's NUMERIC FIELDS, and that is
// exactly the shape of bug this repo has already shipped twice inside
// e2ePrune.ts itself (see its module comment). This copy drifted for real:
// pushSubscriptionsDeleted was added to the mutation without being added here,
// which means a real prune run would have deleted rows from a table this
// script's own dry-run table and post-write summary said nothing about — the
// operator authorising `--execute` would never have seen them coming. The
// invariant below is what makes that impossible to repeat: if the mutation
// ever reports a numeric counter not listed here, the script refuses to run
// rather than silently under-report. e2ePrune.test.ts:36-42 built the same
// drift-proofing into the TEST helper when this file was first written; this
// script just didn't get the same treatment until now.
const TOTAL_KEYS = [
  'playersScanned',
  'e2ePlayersFound',
  'playersDeleted',
  'dailyScoresDeleted',
  'monthlyWinnersDeleted',
  'scoringSystemsDeleted',
  'playerMembershipsDeleted',
  'pushSubscriptionsDeleted',
  'teamsDeleted',
  'teamRostersPatched',
  'teamInvitesCleared',
  'celebrationRefsCleared',
  'teamsKeptWithUnresolvableMembers',
  'invitesDiscardedWithDeletedTeams',
]

// A safety ceiling, not a tuning knob. Each call advances the cursor by one page
// unconditionally — even a page holding no e2e rows — so the loop terminates on
// `isDone`. This exists only so that a backend that somehow stopped advancing
// the cursor spins a bounded number of times instead of forever.
const MAX_BATCHES = 100_000

async function pass(label, writing) {
  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0]))
  let cursor = null
  let batches = 0

  for (;;) {
    if (batches >= MAX_BATCHES) fail(`${label}: exceeded ${MAX_BATCHES} batches without finishing.`)
    const report = await convex.mutation(internal.e2ePrune.pruneBatch, {
      execute: writing,
      cursor,
      ...(pageSize === undefined ? {} : { pageSize }),
    })
    batches += 1

    // THE DRIFT GUARD. Checked every batch, before totalling, so a counter
    // added to the mutation but never added to TOTAL_KEYS above fails loudly
    // instead of being silently absent from both the dry-run table and the
    // post-write summary — the exact failure this script shipped with once
    // already. Cheap: PruneBatchReport is small and this runs once per batch.
    for (const [key, value] of Object.entries(report)) {
      if (typeof value === 'number' && !TOTAL_KEYS.includes(key)) {
        fail(
          `${label}: the mutation reports a counter this script does not print: ${key}.\n` +
            'Add it to TOTAL_KEYS. An operator must never authorise a destructive write from a\n' +
            'summary that silently omits a whole table.',
        )
      }
    }

    for (const key of TOTAL_KEYS) totals[key] += report[key]

    // THE ACCOUNTING INVARIANT, checked every batch rather than at the end. If
    // the mutation ever reports deleting a different number of players than it
    // classified as e2e, its selection and its deletion have come apart, and the
    // only safe response is to stop mid-pass rather than finish the sweep.
    //
    // The comparison is the same on both passes on purpose: `playersDeleted`
    // counts what the batch REMOVED OR WOULD HAVE REMOVED, so a dry run reports
    // the same number as the write that follows it. That is what makes the dry
    // run a prediction rather than a separate code path.
    if (report.playersDeleted !== report.e2ePlayersFound) {
      fail(
        `${label}: REFUSING TO CONTINUE. Batch ${batches} classified ${report.e2ePlayersFound}\n` +
          `e2e players but accounted for ${report.playersDeleted} deletions. The selection rule and\n` +
          `the deletion no longer agree; nothing further will be touched.`,
      )
    }

    if (report.isDone) break
    cursor = report.cursor
  }

  return { totals, batches }
}

const report = (label, { totals, batches }) => {
  console.log(`\n${label}  (${batches} batch${batches === 1 ? '' : 'es'})`)
  for (const key of TOTAL_KEYS) console.log(`  ${key.padEnd(34)} ${totals[key]}`)
}

console.log(`Deployment: ${url}`)
console.log(`Mode:       ${execute ? 'EXECUTE (will delete)' : 'DRY RUN (writes nothing)'}`)

// PASS 1 IS ALWAYS A DRY RUN, even when --execute was passed. It is what gives
// this script the whole-deployment view the mutation cannot have from a single
// page — specifically, whether the deployment holds anything that is NOT debris.
const dry = await pass('dry run', false)
report('DRY RUN — what is there', dry)

// A RUN THAT SCANNED NOTHING IS A FAILURE, NOT A CLEAN NO-OP. An empty
// deployment and a typo'd --url produce identical output otherwise, and the
// second one is the one that matters: it would let somebody believe a prune had
// happened when nothing was ever read.
if (dry.totals.playersScanned === 0) {
  fail(
    'Scanned 0 player rows. That is not a clean no-op — it is indistinguishable from being\n' +
      'pointed at the wrong deployment. Check --url.',
  )
}

const nonE2e = dry.totals.playersScanned - dry.totals.e2ePlayersFound
console.log(`\n  players that are NOT e2e debris    ${nonE2e}`)

if (dry.totals.teamsKeptWithUnresolvableMembers > 0) {
  console.log(
    `\n  NOTE: ${dry.totals.teamsKeptWithUnresolvableMembers} team(s) were KEPT because a roster id\n` +
      '  does not resolve to a player document. Those are pre-existing dangling references from\n' +
      '  some earlier deletion, not something this prune created. They are deliberately not\n' +
      '  guessed at — see the deletion rule in convex/e2ePrune.ts.',
  )
}

if (!execute) {
  console.log('\nDRY RUN. Nothing was written. Re-run with --execute to delete.')
  process.exit(0)
}

// REFUSES LOUDLY on a deployment that holds real rows. Nothing non-e2e would be
// deleted — the rule cannot reach it — but "this deployment has real data on it"
// is exactly the moment to stop and make a person look, rather than to run a
// destructive tool on the strength of a flag. --allow-mixed is the deliberate
// override, and a deployment carrying copied Supabase data (beta) needs it.
if (nonE2e > 0 && !allowMixed) {
  fail(
    `REFUSING TO EXECUTE. This deployment holds ${nonE2e} player row(s) that are not e2e debris.\n` +
      'None of them would be deleted, and no team with a non-e2e member would be either — but a\n' +
      'destructive sweep across a deployment with real data on it should be a decision, not a\n' +
      'default. Re-run with --allow-mixed if that is what you mean.',
  )
}

const done = await pass('execute', true)
report('EXECUTED — what was removed', done)
console.log('')
