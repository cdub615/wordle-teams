import { candidateClues, holds, type Clue, type ClueKind } from './clues.ts'
import { remainingAfter } from './ladder.ts'
import { ALL_ORDERS, SHAPES, type Order } from './orders.ts'
import { createRng, type Rng } from './rng.ts'

export type GeneratorParams = {
  /** [ladder length, weight]; lengths must be 4–6. */
  lengthWeights: ReadonlyArray<readonly [number, number]>
  /** [orders left before the final clue, weight]; 4 means "4 or more". */
  beforeLastWeights: ReadonlyArray<readonly [number, number]>
  /** No clue kind appears more than this many times in one ladder. */
  maxPerKind: number
  /** Random build attempts before falling back. */
  attempts: number
}

/** Starting values. Task 8 of the simulation plan tunes these. */
export const DEFAULT_PARAMS: GeneratorParams = {
  lengthWeights: [
    [4, 3],
    [5, 3],
    [6, 2],
  ],
  beforeLastWeights: [
    [2, 3],
    [3, 2],
    [4, 1],
  ],
  maxPerKind: 2,
  attempts: 400,
}

export type Puzzle = {
  answer: Order
  clues: Clue[]
  /** remaining[i] = orders still possible after clue i + 1. */
  remaining: number[]
  /** True when the random build gave up and the four-slot fallback was used. */
  fallback: boolean
}

export function generatePuzzle(seed: number, params: GeneratorParams = DEFAULT_PARAMS): Puzzle {
  const rng = createRng(seed)
  const answer: Order = rng.shuffle(SHAPES)
  const pool = candidateClues(answer)
  const length = rng.weighted(params.lengthWeights)
  const beforeLast = rng.weighted(params.beforeLastWeights)
  for (let i = 0; i < params.attempts; i++) {
    const clues = tryLadder(rng, pool, length, beforeLast, params.maxPerKind)
    if (clues) return { answer, clues, remaining: remainingAfter(clues), fallback: false }
  }
  const clues = fallbackLadder(rng, answer)
  return { answer, clues, remaining: remainingAfter(clues), fallback: true }
}

function countHolding(clue: Clue, orders: readonly Order[]): number {
  let n = 0
  for (const order of orders) if (holds(clue, order)) n++
  return n
}

function tryLadder(
  rng: Rng,
  pool: readonly Clue[],
  length: number,
  beforeLast: number,
  maxPerKind: number,
): Clue[] | null {
  const clues: Clue[] = []
  const used = new Map<ClueKind, number>()
  let left: readonly Order[] = ALL_ORDERS
  for (let step = 1; step <= length; step++) {
    const options = pool.filter((clue) => {
      if ((used.get(clue.kind) ?? 0) >= maxPerKind) return false
      const n = countHolding(clue, left)
      if (n >= left.length) return false // must remove at least one order
      if (step === length) return n === 1
      if (step === length - 1) return beforeLast >= 4 ? n >= 4 : n === beforeLast
      return n > beforeLast
    })
    if (options.length === 0) return null
    const clue = rng.pick(options)
    clues.push(clue)
    used.set(clue.kind, (used.get(clue.kind) ?? 0) + 1)
    left = left.filter((order) => holds(clue, order))
  }
  return clues
}

/** Fix four slots in random order: 120 → 24 → 6 → 2 → 1. Always a valid ladder. */
function fallbackLadder(rng: Rng, answer: Order): Clue[] {
  const slots = rng.shuffle([0, 1, 2, 3, 4]).slice(0, 4)
  return slots.map((slot): Clue => ({ kind: 'inSlot', shape: answer[slot], slot, negated: false }))
}
