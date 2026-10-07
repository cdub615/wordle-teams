// WHAT scripts/redate-misdated-boards.mjs DECIDES BEFORE IT TOUCHES ANYTHING
// (wordle-teams-c442.3).
//
// The runner drives migrate.ts's misdatedBoardsProbe and repairMisdatedBoards
// against a real deployment with the migration key, exactly as
// rac-duplicate-scores.mjs drives rac's. Its flags, its target, where its report
// may land, the months it repairs, the one fingerprint an apply must quote and
// whether an apply may proceed are decided here, purely, so
// redate-runner.test.mjs can drive them — the script itself does its work at
// module scope and is untestable, like every runner in scripts/.
//
// THE GUARDS ARE rac's, NOT COPIES: the target, --out and the record are generic
// and imported from rac-runner.mjs, so the two runners cannot drift apart.

import {
  classifyApplyError,
  classifyRefusals,
  decideRacTarget,
  fingerprintOf,
  outputPathAllowed,
  parseRunnerArgs,
  recorder,
} from './rac-runner.mjs'

export { classifyApplyError, classifyRefusals, outputPathAllowed, recorder }

/**
 * Production only (the deployment wrangler.jsonc declares at its top level),
 * loopback only with --local, and --apply must name the host: rac's guard.
 */
export const decideRedateTarget = decideRacTarget

const MODES = ['measure', 'repair']

/**
 * argv (without node and the script) -> { mode, apply, local, confirmHost, expect,
 * out } or { error }. rac's flags and refusals: `--apply` needs `--expect`, and an
 * unknown flag is refused rather than ignored.
 */
export function parseRedateArgs(argv) {
  return parseRunnerArgs(argv, MODES)
}

const monthOf = (day) => day.slice(0, 7)

/**
 * The probe's plans by SOURCE month — the month of the day the pair sits on,
 * which is the month repairMisdatedBoards is called with — months in order.
 */
export function groupBySourceMonth(plans) {
  const byMonth = new Map()
  for (const plan of plans) {
    const month = monthOf(plan.puzzleDay)
    if (!byMonth.has(month)) byMonth.set(month, { month, moves: [], holds: [] })
    byMonth.get(month)[plan.kind === 'move' ? 'moves' : 'holds'].push(plan)
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
}

/** The source months with at least one move: the months `repair` plans. */
export function sourceMonthsWithMoves(plans) {
  return groupBySourceMonth(plans)
    .filter((g) => g.moves.length > 0)
    .map((g) => g.month)
}

/** Moves, holds, and holds per reason. */
export function summarizePlans(plans) {
  const holdReasons = {}
  let moves = 0
  for (const plan of plans) {
    if (plan.kind === 'move') moves += 1
    else holdReasons[plan.reason] = (holdReasons[plan.reason] ?? 0) + 1
  }
  return { moves, holds: plans.length - moves, holdReasons }
}

/** A move as redateKey (convex/lib/redate.ts) names it: `legacyId:from>to`. */
export function moveIdOf(move) {
  return `${move.move.legacyId}:${move.puzzleDay}>${move.to}`
}

/**
 * THE FINGERPRINT AN APPLY MUST QUOTE: rac's fingerprintOf over every planned
 * month's redateKey (`YYYY-MM:` + its moves) — sixteen hex characters of SHA-256
 * over the keys sorted, which is month order, newline-joined. A month whose dry
 * run was refused is in it as `YYYY-MM:refused`, as in rac. A key not starting
 * with its own month is refused: the server binds the month into the key, so
 * anything else is a runner bug that would let one month's approval cover another.
 */
export function redateFingerprint(results) {
  const keys = results.map((r) => {
    if (r.refused) return `${r.month}:refused`
    if (typeof r.redateKey !== 'string' || !r.redateKey.startsWith(`${r.month}:`)) {
      throw new Error(`redateKey ${r.redateKey} is not ${r.month}'s`)
    }
    return r.redateKey
  })
  return fingerprintOf(keys)
}

/**
 * WHERE THE DRY RUN AND measure PLAN DIFFERENT MOVES, per planned month. measure
 * plans each player's whole history (batch conflicts across months resolved
 * there); the repair plans one month against what is stored. If they differ, a
 * month-by-month apply can find the plan changed partway — after earlier months
 * were written — so the operator must look before anything is applied.
 */
export function planDisagreements(measuredPlans, planned) {
  const disagreements = []
  for (const result of planned) {
    const measured = new Set(
      measuredPlans
        .filter((p) => p.kind === 'move' && monthOf(p.puzzleDay) === result.month)
        .map(moveIdOf),
    )
    const dry = new Set(result.moves.map(moveIdOf))
    const onlyMeasured = [...measured].filter((id) => !dry.has(id)).sort()
    const onlyPlanned = [...dry].filter((id) => !measured.has(id)).sort()
    if (onlyMeasured.length || onlyPlanned.length) {
      disagreements.push({ month: result.month, onlyMeasured, onlyPlanned })
    }
  }
  return disagreements
}

/**
 * THE WINNER DRIFT A DRY RUN REPORTS, as printed: per team-month, whether the
 * stored winner would no longer match a recompute after the moves. INFORMATION
 * ONLY — the repair never writes winners — and not part of the fingerprint.
 */
export function winnerDriftLines(teamMonths) {
  if (teamMonths.length === 0) return []
  return [
    '  WINNER DRIFT (not written):',
    ...teamMonths.map((tm) => {
      const at = `    team ${tm.team} ${tm.month}:`
      if (tm.storedWinner === null) return `${at} no winner row`
      if (tm.winnerDrift) return `${at} DRIFT: stored ${tm.storedWinner}, after the moves ${tm.winnerAfterMoves}`
      return `${at} no drift (stored ${tm.storedWinner})`
    }),
  ]
}

/**
 * REFUSE UNLESS THE PLAN IS STILL THE ONE APPROVED: every month planned, the dry
 * run agreeing with measure, and the fingerprint equal to `--expect`.
 */
export function decideApply({ fingerprint, expect, failed, disagreements }) {
  if (failed.length > 0) {
    return { ok: false, reason: `${failed.join(', ')} could not be planned.` }
  }
  if (disagreements.length > 0) {
    return {
      ok: false,
      reason: `the dry run and measure disagree for ${disagreements.map((d) => d.month).join(', ')}.`,
    }
  }
  if (!expect || fingerprint !== expect) {
    return { ok: false, reason: `the plan's fingerprint is ${fingerprint}, not ${expect}.` }
  }
  return { ok: true }
}
