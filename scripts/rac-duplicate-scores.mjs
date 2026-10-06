#!/usr/bin/env node
/**
 * MEASURE, DIFF AND REPAIR DUPLICATE DAILY SCORES (wordle-teams-rac.2).
 *
 * Drives migrate.ts's duplicateScoresProbe, duplicateScoresImpact and
 * repairDuplicateScores with the migration key. EVERY MODE IS READ-ONLY EXCEPT
 * `repair --apply`.
 *
 *   measure          every player holding a duplicated day (the probe, all
 *                    pages), with every HELD group and its reasons
 *   impact           the probe, then each month's impact, all pages, checked
 *                    complete: stats as stored vs. as the repair would leave
 *                    them — the diff the owner approves. Winner DRIFT (a stored
 *                    winner a recompute today would disagree with) is listed as
 *                    information only: the repair never writes winners.
 *   repair           a DRY RUN (the default; --dry-run says so explicitly): what
 *                    each month's repair would delete and roll up, and the
 *                    FINGERPRINT of exactly those rows
 *   repair --apply --confirm-host=<host> --expect=<fingerprint>
 *                    re-plans every month; refuses unless the fingerprint still
 *                    matches; then repairs one month per call, each call tied to
 *                    its month's deletion key, and measures again
 *
 * TARGET. Load the PRODUCTION URL and migration key BY NAME from the commented
 * block of the repo-root .env.local, exactly as copy-from-supabase.mjs is run
 * (bd memory convex-env-and-key-scopes) — never the whole block:
 *
 *   set -a; . <(sed -n 's/^#[[:space:]]*\(CONVEX_URL=.*\|CONVEX_MIGRATION_KEY=.*\)/\1/p' .env.local); set +a
 *   node scripts/rac-duplicate-scores.mjs measure
 *
 * The host is printed FIRST, and the script refuses to run against anything but
 * the deployment wrangler.jsonc declares at its top level — 127.0.0.1 included,
 * because `convex run --prod` silently resolves there. `--local` flips that, for
 * testing against the local backend only. `--apply` additionally needs
 * `--confirm-host=<the printed host>`.
 *
 * OUTPUT. Every function call's result is printed AS IT RETURNS and, with
 * --out=<path>, appended to that file as one JSON line before the next call
 * (revision 2, I2), so a run that dies halfway keeps the record of what it already
 * deleted. --out is accepted only under the OS temp dir, symlinks resolved: it
 * names real players' legacy ids and boards, and this repository is public.
 */
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'
import { environmentsFromWranglerConfig } from './lib/copy-target.mjs'
import {
  checkImpactPages,
  decideRacTarget,
  fingerprintOf,
  monthsOf,
  outputPathAllowed,
  parseRacArgs,
  recorder,
} from './lib/rac-runner.mjs'

const CONVEX_URL = process.env.CONVEX_URL
const CONVEX_MIGRATION_KEY = process.env.CONVEX_MIGRATION_KEY

// THE HOST, BEFORE ANYTHING ELSE IS SAID OR DONE.
let printedHost = '(none: CONVEX_URL is not set)'
try {
  if (CONVEX_URL) printedHost = new URL(CONVEX_URL).hostname
} catch {
  printedHost = `(unparseable: ${CONVEX_URL})`
}
console.log(`TARGET HOST: ${printedHost}`)

const args = parseRacArgs(process.argv.slice(2))
if (args.error) {
  console.error(args.error)
  console.error('Usage: rac-duplicate-scores.mjs measure|impact|repair [--dry-run]')
  console.error('       rac-duplicate-scores.mjs repair --apply --confirm-host=<host> --expect=<fingerprint>')
  console.error('       [--local] [--out=<path under the OS temp dir>]')
  process.exit(1)
}

let environments = []
try {
  const { experimental_readRawConfig } = await import('wrangler')
  const { rawConfig } = experimental_readRawConfig({
    config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
  })
  environments = environmentsFromWranglerConfig(rawConfig)
} catch (error) {
  // Not fatal here, and not a way round the guard: with no environments the
  // expected host is unknown, and decideRacTarget refuses.
  console.warn(`Could not read wrangler.jsonc: ${error.message}`)
}

const verdict = decideRacTarget({ convexUrl: CONVEX_URL, environments, ...args })
if (!verdict.ok) {
  console.error(`REFUSING TO RUN. ${verdict.reason}`)
  process.exit(1)
}
if (!CONVEX_MIGRATION_KEY) {
  console.error('Set CONVEX_MIGRATION_KEY (by name, from the commented block — see the header).')
  process.exit(1)
}
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
if (args.out && !outputPathAllowed(args.out, { tmpdir: os.tmpdir(), repoRoot })) {
  console.error(`REFUSING --out=${args.out}: it must be in an existing directory under ${os.tmpdir()},`)
  console.error('outside the repository, with symlinks resolved.')
  process.exit(1)
}

const writes = args.mode === 'repair' && args.apply
console.log(`MODE: ${args.mode}${args.mode === 'repair' ? (writes ? ' --apply (WRITES)' : ' (dry run)') : ''}`)
const record = recorder(args.out)
record({ kind: 'run', host: verdict.host, mode: args.mode, apply: args.apply, at: new Date().toISOString() })

const convex = new ConvexHttpClient(CONVEX_URL)
convex.setAdminAuth(CONVEX_MIGRATION_KEY)

/** A ConvexError's message rides on `data`; anything else on `message`. */
const messageOf = (error) => String(error?.data ?? error?.message ?? error)

async function measure(label) {
  const affected = []
  let players = 0
  let cursor = null
  for (;;) {
    const page = await convex.query(internal.migrate.duplicateScoresProbe, { cursor })
    players += page.players
    affected.push(...page.affected)
    if (page.isDone) break
    cursor = page.cursor
  }
  const groups = affected.flatMap((a) => a.groups.map((g) => ({ player: a.player, ...g })))
  const held = groups.filter((g) => g.held.length > 0)
  const summary = {
    kind: 'measure',
    label,
    playersScanned: players,
    affectedPlayers: affected.length,
    groups: groups.length,
    collapsible: groups.length - held.length,
    held: held.length,
    differing: groups.filter((g) => g.differing).length,
    rowsToDelete: groups.filter((g) => g.held.length === 0).reduce((n, g) => n + g.drop.length, 0),
  }
  record(summary)
  for (const g of groups) record({ kind: 'group', ...g })
  return { affected, groups, summary }
}

async function impact(months) {
  let complete = true
  for (const month of months) {
    const pages = []
    let after = null
    try {
      do {
        const page = await convex.query(internal.migrate.duplicateScoresImpact, { month, after })
        pages.push(page)
        for (const entry of page.entries) record({ kind: 'impact', ...entry })
        after = page.next
      } while (after !== null)
    } catch (error) {
      record({ kind: 'impact-refused', month, reason: messageOf(error) })
      continue
    }
    const check = checkImpactPages(pages)
    const entries = pages.flatMap((p) => p.entries)
    const statsChanges = entries.filter((e) => e.statsChanged).length
    const drift = entries.filter((e) => e.winnerDrift).length
    record({
      kind: 'impact-month',
      month,
      deletionKey: pages[0].deletionKey,
      pairs: pages[0].pairs,
      held: pages[0].held,
      statsChanges,
      // Counted apart from what the repair does, and labelled so: the repair never
      // writes monthlyWinners (revision 3).
      winnerDriftInformational: drift,
      ...check,
    })
    console.log(
      `${month} [deletes ${pages[0].deletionKey}]: ${statsChanges} team stats change(s) by this repair; ` +
        `${drift} winner drift (not changed by this repair); ${pages[0].held} held group(s)`,
    )
    if (!check.ok) complete = false
  }
  return complete
}

/** One dry-run pass over every month: the plan, recorded as it returns. */
async function plan(months) {
  const keys = []
  const planned = []
  for (const month of months) {
    try {
      const result = await convex.mutation(internal.migrate.repairDuplicateScores, { month, dryRun: true })
      record({ kind: 'plan', ...result })
      keys.push(result.deletionKey)
      planned.push(result)
    } catch (error) {
      record({ kind: 'plan-refused', month, reason: messageOf(error) })
      keys.push(`${month}:refused`)
    }
  }
  return { fingerprint: fingerprintOf(keys), planned }
}

const { affected } = await measure('before')
const months = monthsOf(affected)
let exitCode = 0

if (args.mode === 'impact') {
  if (!(await impact(months))) {
    console.error('IMPACT INCOMPLETE: a month did not return every (team, month) pair. Do not approve it.')
    exitCode = 1
  }
}

if (args.mode === 'repair') {
  const { fingerprint, planned } = await plan(months)
  record({ kind: 'fingerprint', fingerprint })
  if (!args.apply) {
    console.log(`\nFINGERPRINT: ${fingerprint}`)
    console.log(`To apply exactly this plan: repair --apply --confirm-host=${verdict.host} --expect=${fingerprint}`)
  } else if (fingerprint !== args.expect) {
    console.error(`REFUSING TO APPLY: the plan's fingerprint is ${fingerprint}, not ${args.expect}.`)
    console.error('Something changed since the dry run that was approved. Nothing was written.')
    exitCode = 1
  } else {
    for (const month of planned) {
      if (month.deletionKey.endsWith(':')) continue // nothing to delete in this month
      try {
        const result = await convex.mutation(internal.migrate.repairDuplicateScores, {
          month: month.month,
          dryRun: false,
          expect: month.deletionKey,
        })
        record({ kind: 'applied', ...result })
      } catch (error) {
        record({ kind: 'apply-refused', month: month.month, reason: messageOf(error) })
        console.error(`STOPPED at ${month.month}: ${messageOf(error)}`)
        exitCode = 1
        break
      }
    }
    // Only months the plan covered can be expected clean: a month the server
    // refused (not yet past) was never planned, and is reported, not failed.
    const covered = new Set(planned.map((p) => p.month))
    const { groups } = await measure('after')
    const left = groups.filter((g) => g.held.length === 0 && covered.has(g.puzzleDay.slice(0, 7)))
    const refused = groups.filter((g) => g.held.length === 0 && !covered.has(g.puzzleDay.slice(0, 7)))
    record({ kind: 'verify', collapsibleLeft: left.length, refusedMonthGroups: refused.length })
    if (left.length > 0) {
      console.error(`${left.length} COLLAPSIBLE DUPLICATE(S) REMAIN in repaired months after --apply.`)
      exitCode = 1
    }
  }
}

process.exit(exitCode)
