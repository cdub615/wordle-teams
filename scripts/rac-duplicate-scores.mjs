#!/usr/bin/env node
/**
 * MEASURE, DIFF AND REPAIR DUPLICATE DAILY SCORES (wordle-teams-rac.2).
 *
 * Drives migrate.ts's duplicateScoresProbe, duplicateScoresImpact and
 * repairDuplicateScores with the migration key. EVERY MODE IS READ-ONLY EXCEPT
 * `repair --apply`.
 *
 *   measure          every player holding a duplicated day (the probe, all pages)
 *   impact           the probe, then every affected (team, month): winner and
 *                    stats as stored vs. with the duplicates collapsed. This is
 *                    the diff the owner approves before anything is written.
 *   repair           a DRY RUN (the default; --dry-run says so explicitly): what
 *                    each player's repair would delete and recompute
 *   repair --apply   deletes and recomputes, one (player, month) per call, then
 *                    measures again and fails unless nothing is left
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
 * OUTPUT. A summary on stdout; with --out=<path> the full JSON as well, and only
 * under the OS temp dir. It names real players' legacy ids and boards, so it must
 * never land in this repository, which is public.
 */
import os from 'node:os'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'
import { environmentsFromWranglerConfig } from './lib/copy-target.mjs'
import {
  chunk,
  decideRacTarget,
  dedupeEntries,
  monthsToRepair,
  outputPathAllowed,
  parseRacArgs,
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
  console.error('Usage: rac-duplicate-scores.mjs measure|impact|repair [--dry-run|--apply')
  console.error('         --confirm-host=<host>] [--local] [--out=<path under the OS temp dir>]')
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
  console.error(`REFUSING --out=${args.out}: it must be under ${os.tmpdir()} and outside the repo.`)
  process.exit(1)
}

const writes = args.mode === 'repair' && args.apply
console.log(`MODE: ${args.mode}${args.mode === 'repair' ? (writes ? ' --apply (WRITES)' : ' (dry run)') : ''}`)
console.log('')

const convex = new ConvexHttpClient(CONVEX_URL)
convex.setAdminAuth(CONVEX_MIGRATION_KEY)

async function measure() {
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
  const groups = affected.flatMap((a) => a.groups)
  return {
    playersScanned: players,
    affectedPlayers: affected.length,
    groups: groups.length,
    differingGroups: groups.filter((g) => g.differing).length,
    rowsToDrop: groups.reduce((n, g) => n + g.drop.length, 0),
    affected,
  }
}

function printMeasure(m) {
  console.log(
    `${m.playersScanned} players scanned; ${m.affectedPlayers} hold duplicates: ` +
      `${m.groups} duplicated days (${m.differingGroups} differing), ${m.rowsToDrop} rows to drop.`,
  )
  for (const a of m.affected) {
    for (const g of a.groups) {
      const row = (r) => `#${r.legacyId ?? 'v2'} @${r.createdAt ?? '-'} (${r.attempts})`
      console.log(
        `  ${a.player}  ${g.puzzleDay}  x${g.rows}${g.differing ? '  DIFFERING' : ''}` +
          `  keep ${row(g.keep)}  drop ${g.drop.map(row).join(', ')}`,
      )
    }
  }
}

/** Players the functions can address. A v2-born player has no legacy id. */
function addressable(m) {
  const native = m.affected.filter((a) => a.player === 'v2-native')
  if (native.length > 0) {
    console.log(`${native.length} v2-born player(s) hold duplicates and cannot be named here.`)
  }
  return m.affected.filter((a) => a.player !== 'v2-native')
}

async function impact(m) {
  const entries = []
  const missing = []
  for (const batch of chunk(addressable(m).map((a) => a.player), 5)) {
    let offset = 0
    while (offset !== null) {
      const page = await convex.query(internal.migrate.duplicateScoresImpact, {
        players: batch,
        offset,
      })
      if (offset === 0) missing.push(...page.missing)
      entries.push(...page.entries)
      offset = page.nextOffset
    }
  }
  return { entries: dedupeEntries(entries), missing }
}

function printImpact({ entries, missing }) {
  const changed = entries.filter((e) => e.winnerChanged)
  console.log(
    `${entries.length} (team, month) pairs affected; ${changed.length} winner change(s), ` +
      `${entries.filter((e) => e.statsChanged).length} stats change(s).`,
  )
  if (missing.length) console.log(`Players not found: ${missing.join(', ')}`)
  for (const e of entries) {
    const winner =
      e.winnerChanged ? `WINNER ${e.winnerBefore} -> ${e.winnerAfter}` : `winner ${e.winnerAfter}`
    const drift = e.winnerLive !== e.winnerBefore ? `  (stored winner already stale: live ${e.winnerLive})` : ''
    console.log(`  team ${e.team}  ${e.month}  ${winner}${drift}`)
    for (const p of e.players) {
      if (p.boardsBefore === p.boardsAfter && p.avgBefore === p.avgAfter) continue
      console.log(
        `      ${p.player}  boards ${p.boardsBefore} -> ${p.boardsAfter}  avg ${p.avgBefore} -> ${p.avgAfter}`,
      )
    }
  }
}

async function repair(m) {
  const results = []
  for (const a of addressable(m)) {
    for (const month of monthsToRepair(a)) {
      results.push(
        await convex.mutation(internal.migrate.repairDuplicateScores, {
          player: a.player,
          month,
          dryRun: !args.apply,
        }),
      )
    }
  }
  return results
}

function printRepair(results) {
  const verb = args.apply ? 'deleted' : 'would delete'
  let rows = 0
  for (const r of results) {
    if (!r.found) {
      console.log(`  ${r.player}: NOT FOUND`)
      continue
    }
    for (const g of r.groups) {
      rows += g.deleted.length
      console.log(
        `  ${r.player}  ${g.puzzleDay}${g.differing ? '  DIFFERING' : ''}  keep #${g.kept.legacyId}` +
          `  ${verb} ${g.deleted.map((d) => `#${d.legacyId}`).join(', ')}`,
      )
    }
    for (const tm of r.teamMonths) {
      console.log(`      ${args.apply ? 'recomputed' : 'would recompute'} team ${tm.team} ${tm.month}`)
    }
  }
  console.log(`${rows} row(s) ${verb}.`)
}

const report = { host: verdict.host, mode: args.mode, apply: args.apply }
const measured = await measure()
report.measure = measured
printMeasure(measured)

if (args.mode === 'impact') {
  console.log('')
  report.impact = await impact(measured)
  printImpact(report.impact)
}

let exitCode = 0
if (args.mode === 'repair') {
  console.log('')
  report.repair = await repair(measured)
  printRepair(report.repair)
  if (args.apply) {
    console.log('')
    console.log('Measuring again after the repair:')
    const after = await measure()
    report.after = after
    printMeasure(after)
    if (after.groups > 0) {
      console.error('DUPLICATES REMAIN after --apply.')
      exitCode = 1
    }
  }
}

if (args.out) {
  writeFileSync(args.out, JSON.stringify(report, null, 2))
  console.log(`\nFull report: ${args.out}`)
}
process.exit(exitCode)
