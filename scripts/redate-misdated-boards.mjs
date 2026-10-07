#!/usr/bin/env node
/**
 * MEASURE AND RE-DATE MISDATED BOARDS (wordle-teams-c442.3).
 *
 * Drives migrate.ts's misdatedBoardsProbe and repairMisdatedBoards with the
 * migration key — two DIFFERENT puzzles sharing one (player, puzzleDay), where the
 * v1 copy put one board on a neighbour's day. Built exactly like
 * rac-duplicate-scores.mjs, and with its guards (lib/rac-runner.mjs, through
 * lib/redate-runner.mjs). EVERY MODE IS READ-ONLY EXCEPT `repair --apply`.
 *
 *   measure          the probe, all pages: every MOVE (day -> target day) and
 *                    every HOLD (reason, targets), grouped by source month; the
 *                    source months with a move; the counts
 *   repair           a DRY RUN (the default; --dry-run says so explicitly): measure,
 *                    then repairMisdatedBoards({ month, dryRun: true }) for each
 *                    source month with a move — its moves, holds and per
 *                    (team, month) stats impact — and ONE overall FINGERPRINT
 *   repair --apply --confirm-host=<host> --expect=<fingerprint>
 *                    re-plans every month (dry runs); refuses unless every month
 *                    planned, each agrees with measure, and the fingerprint still
 *                    matches; then applies one month per call, each tied to its
 *                    own month's key, and measures again: only holds should remain
 *
 * The repair never writes winners (monthlyWinners, hasSeenCelebration): it moves
 * puzzleDay and rolls up teamMonthStats for the source and target months.
 *
 * TARGET. Load the PRODUCTION URL and migration key BY NAME from the commented
 * block of the repo-root .env.local, exactly as copy-from-supabase.mjs is run
 * (bd memory convex-env-and-key-scopes) — never the whole block:
 *
 *   set -a; . <(sed -n 's/^#[[:space:]]*\(CONVEX_URL=.*\|CONVEX_MIGRATION_KEY=.*\)/\1/p' .env.local); set +a
 *   node scripts/redate-misdated-boards.mjs measure
 *
 * The host is printed FIRST, and the script refuses to run against anything but
 * the deployment wrangler.jsonc declares at its top level — 127.0.0.1 included,
 * because `convex run --prod` silently resolves there. `--local` flips that, for
 * testing against the local backend only. `--apply` additionally needs
 * `--confirm-host=<the printed host>`.
 *
 * OUTPUT. Every function call's result is printed AS IT RETURNS and, with
 * --out=<path>, appended to that file as one JSON line before the next call, so a
 * run that dies halfway keeps the record of what it already moved. --out is
 * accepted only under the OS temp dir, symlinks resolved: it names real players'
 * legacy ids and boards, and this repository is public.
 */
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { ConvexHttpClient } from 'convex/browser'
import { internal } from '../convex/_generated/api.js'
import { environmentsFromWranglerConfig } from './lib/copy-target.mjs'
import {
  classifyApplyError,
  classifyRefusals,
  decideApply,
  decideRedateTarget,
  groupBySourceMonth,
  outputPathAllowed,
  parseRedateArgs,
  planDisagreements,
  recorder,
  redateFingerprint,
  sourceMonthsWithMoves,
  summarizePlans,
} from './lib/redate-runner.mjs'

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

const args = parseRedateArgs(process.argv.slice(2))
if (args.error) {
  console.error(args.error)
  console.error('Usage: redate-misdated-boards.mjs measure|repair [--dry-run]')
  console.error('       redate-misdated-boards.mjs repair --apply --confirm-host=<host> --expect=<fingerprint>')
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
  // expected host is unknown, and decideRedateTarget refuses.
  console.warn(`Could not read wrangler.jsonc: ${error.message}`)
}

const verdict = decideRedateTarget({ convexUrl: CONVEX_URL, environments, ...args })
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

/** Every page of the probe, each page recorded as it returns; then the grouped view. */
async function measure(label) {
  const plans = []
  let players = 0
  let cursor = null
  for (;;) {
    const page = await convex.query(internal.migrate.misdatedBoardsProbe, { cursor })
    players += page.players
    plans.push(...page.plans)
    record({ kind: 'probe-page', label, players: page.players, plans: page.plans, isDone: page.isDone })
    if (page.isDone) break
    cursor = page.cursor
  }

  console.log(`\nMISDATED BOARDS (${label}), by source month:`)
  for (const { month, moves, holds } of groupBySourceMonth(plans)) {
    console.log(`\n${month}: ${moves.length} move(s), ${holds.length} hold(s)`)
    for (const m of moves) {
      console.log(`  MOVE ${m.player} ${m.puzzleDay} -> ${m.to}  (board ${m.move.legacyId} ${m.move.answer}; stays: ${m.stay.legacyId} ${m.stay.answer})`)
    }
    for (const h of holds) {
      const targets = h.targets.length ? ` targets ${h.targets.join(', ')}` : ''
      const boards = h.boards.map((b) => `${b.legacyId} ${b.answer}`).join('; ')
      console.log(`  HOLD ${h.player} ${h.puzzleDay} ${h.reason}${targets}  (boards ${boards})`)
    }
  }
  const months = sourceMonthsWithMoves(plans)
  console.log(`\nSOURCE MONTHS WITH MOVES: ${months.length ? months.join(', ') : '(none)'}`)
  const summary = { kind: 'measure', label, playersScanned: players, ...summarizePlans(plans), monthsWithMoves: months }
  record(summary)
  return { plans, months, summary }
}

/** One dry-run pass over every month: the plan, recorded as it returns. */
async function plan(months) {
  const results = []
  const planned = []
  const refusals = []
  for (const month of months) {
    try {
      const result = await convex.mutation(internal.migrate.repairMisdatedBoards, { month, dryRun: true })
      record({ kind: 'plan', ...result })
      const changed = result.teamMonths.filter((t) => t.statsChanged).length
      const created = result.teamMonths.filter((t) => t.statsCreated).length
      console.log(
        `${month} [re-dates ${result.redateKey}]: ${result.moves.length} move(s), ${result.holds.length} ` +
          `hold(s); ${result.teamMonths.length} team-month(s) rolled up, ${changed} with stats changed ` +
          `(${created} stats doc(s) created); winners never written`,
      )
      results.push({ month, redateKey: result.redateKey })
      planned.push(result)
    } catch (error) {
      record({ kind: 'plan-refused', month, reason: messageOf(error) })
      refusals.push({ month, reason: messageOf(error) })
      results.push({ month, refused: true })
    }
  }
  // Listed loudly, never folded silently into the fingerprint.
  const { deferred, failed } = classifyRefusals(refusals)
  if (deferred.length) console.log(`DEFERRED, not yet past (not planned): ${deferred.join(', ')}`)
  if (failed.length) console.error(`PLAN REFUSED for ${failed.join(', ')}: those months have no plan.`)
  return { fingerprint: redateFingerprint(results), planned, failed }
}

const before = await measure('before')
let exitCode = 0

if (args.mode === 'repair') {
  const { fingerprint, planned, failed } = await plan(before.months)
  const disagreements = planDisagreements(before.plans, planned)
  record({ kind: 'fingerprint', fingerprint, refusedMonths: failed, disagreements })
  for (const d of disagreements) {
    console.error(
      `DRY RUN DISAGREES WITH MEASURE for ${d.month}: only measured ${d.onlyMeasured.join(', ') || '-'}; ` +
        `only planned ${d.onlyPlanned.join(', ') || '-'}`,
    )
  }
  if (!args.apply) {
    console.log(`\nFINGERPRINT: ${fingerprint}`)
    const applicable = decideApply({ fingerprint, expect: fingerprint, failed, disagreements })
    if (!applicable.ok) {
      console.error(`NOT APPLICABLE: ${applicable.reason} --apply will refuse.`)
      exitCode = 1
    } else {
      console.log(`To apply exactly this plan: repair --apply --confirm-host=${verdict.host} --expect=${fingerprint}`)
    }
  } else {
    const decision = decideApply({ fingerprint, expect: args.expect, failed, disagreements })
    if (!decision.ok) {
      console.error(`REFUSING TO APPLY: ${decision.reason}`)
      console.error('Something changed since the dry run that was approved. Nothing was written.')
      exitCode = 1
    } else {
      let unconfirmed = null
      for (const month of planned) {
        if (month.redateKey.endsWith(':')) continue // nothing to move in this month
        try {
          const result = await convex.mutation(internal.migrate.repairMisdatedBoards, {
            month: month.month,
            dryRun: false,
            expect: month.redateKey,
          })
          record({ kind: 'applied', ...result })
        } catch (error) {
          exitCode = 1
          if (classifyApplyError(error) === 'refused') {
            record({ kind: 'apply-refused', month: month.month, reason: messageOf(error) })
            console.error(`STOPPED at ${month.month}, refused before writing: ${messageOf(error)}`)
          } else {
            // The answer was lost, not necessarily the write: the month may be done.
            unconfirmed = month.month
            record({ kind: 'apply-unconfirmed', month: month.month, reason: messageOf(error) })
            console.error(`APPLY UNCONFIRMED for ${month.month}: the response was lost and the`)
            console.error('repair may or may not have committed. Re-run `measure` (and a dry run) to')
            console.error('see what is there BEFORE doing anything else. Nothing further was attempted.')
          }
          break
        }
      }
      if (unconfirmed !== null) process.exit(exitCode)
      // Only months the plan covered can be expected clean: a month the server
      // deferred (not yet past) was never planned, and is reported, not failed.
      const covered = new Set(planned.map((p) => p.month))
      const after = await measure('after')
      const left = after.plans.filter((p) => p.kind === 'move' && covered.has(p.puzzleDay.slice(0, 7)))
      const deferredLeft = after.plans.filter((p) => p.kind === 'move' && !covered.has(p.puzzleDay.slice(0, 7)))
      record({
        kind: 'verify',
        movesLeftInRepairedMonths: left.length,
        movesLeftInOtherMonths: deferredLeft.length,
        holds: after.summary.holds,
      })
      console.log(`\nREMAINING: ${after.summary.holds} hold(s), ${after.summary.moves} move(s).`)
      if (left.length > 0) {
        console.error(`${left.length} MOVE(S) REMAIN in repaired months after --apply.`)
        exitCode = 1
      }
    }
  }
}

process.exit(exitCode)
