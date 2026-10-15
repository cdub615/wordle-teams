import { pointsFor, type ScoringSystem } from '../scoring.ts'
import { DEFAULT_SYSTEM } from '../scoringSystem.ts'
import { DEFAULT_PARAMS, generatePuzzle, type GeneratorParams } from './generate.ts'
import { clueLadderSystem } from './points.ts'
import { createRng, type Rng } from './rng.ts'

/**
 * The score-spread simulation from spec section 8. Players are modelled as
 * perfect counters of remaining orders, so careful play here is an upper
 * bound on what real careful players achieve.
 */
export type Strategy = 'careful' | 'bold' | 'reckless' | 'mixed'
export const STRATEGIES: readonly Strategy[] = ['careful', 'bold', 'reckless', 'mixed']
export const THRESHOLDS = { careful: 1, bold: 2, reckless: 3 } as const
export const FAIL = 7

/** The team the bar judges: one player per type, so headcount cannot skew the shares. */
export const BAR_TEAM: readonly Strategy[] = STRATEGIES

/**
 * A plausible 7-player team, reported for information only. Careful players have no
 * luck in them, so the two here always tie each other and split their months.
 */
export const SEVEN_PLAYER_TEAM: readonly Strategy[] = [
  'careful',
  'careful',
  'bold',
  'bold',
  'reckless',
  'mixed',
  'mixed',
]

/** Attempts (1–6, or FAIL) for one player who locks in at `threshold` or fewer orders left. */
export function playDay(remaining: readonly number[], threshold: number, rng: Rng): number {
  for (let i = 0; i < remaining.length; i++) {
    const left = remaining[i]
    if (left <= threshold) return rng.int(left) === 0 ? i + 1 : FAIL
  }
  // Unreachable for a valid ladder, whose last count is 1.
  return FAIL
}

function thresholdFor(strategy: Strategy, rng: Rng): number {
  if (strategy === 'mixed') return rng.pick([1, 2, 3])
  return THRESHOLDS[strategy]
}

type PerStrategy<T> = Record<Strategy, T>
const perStrategy = <T>(make: () => T): PerStrategy<T> => ({
  careful: make(),
  bold: make(),
  reckless: make(),
  mixed: make(),
})

/** Credit for one month: the highest totals split one win equally between them. */
export function monthCredit(totals: readonly number[], team: readonly Strategy[]): [Strategy, number][] {
  const top = Math.max(...totals)
  const winners = team.filter((_, i) => totals[i] === top)
  return winners.map((s) => [s, 1 / winners.length])
}

export type SimReport = {
  days: number
  players: PerStrategy<number>
  /** scoreCounts[s][k] = player-days scoring k (1–7) under strategy s; index 0 unused. */
  scoreCounts: PerStrategy<number[]>
  failRate: PerStrategy<number>
  meanScore: PerStrategy<number>
  /** Share of months won, ties split equally. Sums to 1 across strategies. */
  monthWinShare: PerStrategy<number>
  /** Share of days on which two or more players share the best score. */
  tieForFirstRate: number
  /** ladderLengthCounts[n] = days whose ladder had n clues. */
  ladderLengthCounts: number[]
  fallbackRate: number
}

export function simulate(opts: {
  months: number
  daysPerMonth: number
  team: readonly Strategy[]
  seed: number
  params?: GeneratorParams
  system?: ScoringSystem
}): SimReport {
  const { months, daysPerMonth, team, seed } = opts
  const params = opts.params ?? DEFAULT_PARAMS
  // The TEAM's system; X is replaced by the clue ladder's fixed value.
  const system = clueLadderSystem(opts.system ?? DEFAULT_SYSTEM)
  const rng = createRng(seed)

  const players = perStrategy(() => 0)
  for (const s of team) players[s]++
  const scoreCounts = perStrategy(() => [0, 0, 0, 0, 0, 0, 0, 0])
  const monthWins = perStrategy(() => 0)
  const ladderLengthCounts = [0, 0, 0, 0, 0, 0, 0]
  let tieDays = 0
  let fallbacks = 0

  for (let m = 0; m < months; m++) {
    const totals = team.map(() => 0)
    for (let d = 0; d < daysPerMonth; d++) {
      const puzzle = generatePuzzle(rng.int(0x100000000), params)
      ladderLengthCounts[puzzle.clues.length]++
      if (puzzle.fallback) fallbacks++
      const scores = team.map((strategy) => playDay(puzzle.remaining, thresholdFor(strategy, rng), rng))
      scores.forEach((score, i) => {
        scoreCounts[team[i]][score]++
        totals[i] += pointsFor(score, system)
      })
      const best = Math.min(...scores)
      if (scores.filter((s) => s === best).length >= 2) tieDays++
    }
    for (const [s, credit] of monthCredit(totals, team)) monthWins[s] += credit
  }

  const days = months * daysPerMonth
  const failRate = perStrategy(() => 0)
  const meanScore = perStrategy(() => 0)
  const monthWinShare = perStrategy(() => 0)
  for (const s of STRATEGIES) {
    const counts = scoreCounts[s]
    const n = counts.reduce((a, b) => a + b, 0)
    failRate[s] = n === 0 ? 0 : counts[FAIL] / n
    meanScore[s] = n === 0 ? 0 : counts.reduce((sum, c, k) => sum + c * k, 0) / n
    monthWinShare[s] = months === 0 ? 0 : monthWins[s] / months
  }

  return {
    days,
    players,
    scoreCounts,
    failRate,
    meanScore,
    monthWinShare,
    tieForFirstRate: days === 0 ? 0 : tieDays / days,
    ladderLengthCounts,
    fallbackRate: days === 0 ? 0 : fallbacks / days,
  }
}

export type BarCheck = { name: string; value: number; target: string; pass: boolean }
export type BarResult = { pass: boolean; checks: BarCheck[] }

/** Spec section 8's bar. The owner may revise these numbers. */
export function checkBar(report: SimReport): BarResult {
  const careful = report.monthWinShare.careful
  const largest = Math.max(...STRATEGIES.map((s) => report.monthWinShare[s]))
  const bold = report.failRate.bold
  // Daily ties are reported, not judged: on a 1–6 scale a team shares the
  // best score on most days at every setting (dry run, 2026-10-14).
  const checks: BarCheck[] = [
    {
      name: 'careful month-win share',
      value: careful,
      target: '0.10 to 0.50',
      pass: careful >= 0.1 && careful <= 0.5,
    },
    { name: 'largest month-win share', value: largest, target: '<= 0.50', pass: largest <= 0.5 },
    { name: 'bold fail rate', value: bold, target: '0.15 to 0.35', pass: bold >= 0.15 && bold <= 0.35 },
  ]
  return { pass: checks.every((c) => c.pass), checks }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

/** Pass `bar` only for the judged team; without it the verdict lines are left out. */
export function formatReport(report: SimReport, bar?: BarResult): string {
  const lines: string[] = []
  lines.push(`Simulated days: ${report.days}  (fallback ladders: ${pct(report.fallbackRate)})`)
  const lengths = [3, 4, 5, 6].map((n) => `${n}: ${report.ladderLengthCounts[n] ?? 0}`).join('  ')
  lines.push(`Ladder lengths  ${lengths}`)
  lines.push('')
  lines.push('strategy   players  mean   fail    month wins   per player   scores 1..6, X')
  for (const s of STRATEGIES) {
    if (report.players[s] === 0) continue
    const counts = report.scoreCounts[s].slice(1).join(' ')
    lines.push(
      `${s.padEnd(10)} ${String(report.players[s]).padEnd(8)} ${report.meanScore[s].toFixed(2).padEnd(6)} ` +
        `${pct(report.failRate[s]).padEnd(7)} ${pct(report.monthWinShare[s]).padEnd(12)} ` +
        `${pct(report.monthWinShare[s] / report.players[s]).padEnd(12)} ${counts}`,
    )
  }
  lines.push('')
  lines.push(`Tie for first: ${pct(report.tieForFirstRate)} of days`)
  if (!bar) return lines.join('\n')
  lines.push('')
  for (const c of bar.checks) {
    lines.push(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.value.toFixed(3)} (target ${c.target})`)
  }
  lines.push(`VERDICT: ${bar.pass ? 'PASS' : 'FAIL'}`)
  return lines.join('\n')
}
