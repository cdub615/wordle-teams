/**
 * Clue ladder score-spread simulation (spec section 8; plan
 * docs/superpowers/plans/2026-10-14-clue-ladder-simulation.md).
 *
 *   node scripts/clue-ladder-sim.mjs [--months 500] [--seed 1] [--samples 3]
 *
 * Imports the TypeScript engine directly; Node 25 strips types on import.
 * Pure computation: touches no network and no Convex deployment.
 * The bar is judged on one player of each type; a 7-player team is printed for
 * information. Exit code 0 when the bar passes, 1 when it fails.
 */
import { parseArgs } from 'node:util'
import { clueText } from '../convex/lib/clueLadder/clues.ts'
import { generatePuzzle } from '../convex/lib/clueLadder/generate.ts'
import { SHAPE_SYMBOLS } from '../convex/lib/clueLadder/orders.ts'
import {
  BAR_TEAM,
  checkBar,
  formatReport,
  SEVEN_PLAYER_TEAM,
  simulate,
} from '../convex/lib/clueLadder/simulate.ts'

const { values } = parseArgs({
  options: {
    months: { type: 'string', default: '500' },
    seed: { type: 'string', default: '1' },
    samples: { type: 'string', default: '3' },
  },
})
const months = Number(values.months)
const seed = Number(values.seed)
const samples = Number(values.samples)

for (let i = 0; i < samples; i++) {
  const puzzle = generatePuzzle(seed * 1000 + i)
  console.log(`Sample puzzle ${i + 1}: answer ${puzzle.answer.map((s) => SHAPE_SYMBOLS[s]).join(' ')}`)
  puzzle.clues.forEach((clue, k) => {
    console.log(`  ${k + 1}. ${clueText(clue)}   (${puzzle.remaining[k]} left)`)
  })
  console.log('')
}

const header = (team) => `Team: ${team.join(', ')}  ·  ${months} months of 28 days  ·  seed ${seed}`

// The bar is judged on one player of each type (spec section 8).
const report = simulate({ months, daysPerMonth: 28, team: BAR_TEAM, seed })
const bar = checkBar(report)
console.log(header(BAR_TEAM))
console.log('')
console.log(formatReport(report, bar))
console.log('')

console.log(`For information, not judged. ${header(SEVEN_PLAYER_TEAM)}`)
console.log('')
console.log(formatReport(simulate({ months, daysPerMonth: 28, team: SEVEN_PLAYER_TEAM, seed })))
process.exitCode = bar.pass ? 0 : 1
