import { holds, type Clue } from './clues.ts'
import { ALL_ORDERS, type Order } from './orders.ts'

export const MIN_CLUES = 4
export const MAX_CLUES = 6

/** The orders consistent with every clue, in ALL_ORDERS order. */
export function survivors(clues: readonly Clue[], orders: readonly Order[] = ALL_ORDERS): Order[] {
  return orders.filter((order) => clues.every((clue) => holds(clue, order)))
}

/** remaining[i] = orders still possible after clue i + 1. */
export function remainingAfter(clues: readonly Clue[]): number[] {
  const counts: number[] = []
  let left: readonly Order[] = ALL_ORDERS
  for (const clue of clues) {
    left = left.filter((order) => holds(clue, order))
    counts.push(left.length)
  }
  return counts
}

export type LadderProblem = 'length' | 'false-clue' | 'no-progress' | 'not-unique'

/** Null when the ladder obeys spec section 3's rules, else the first rule it breaks. */
export function ladderProblem(answer: Order, clues: readonly Clue[]): LadderProblem | null {
  if (clues.length < MIN_CLUES || clues.length > MAX_CLUES) return 'length'
  if (!clues.every((clue) => holds(clue, answer))) return 'false-clue'
  const remaining = remainingAfter(clues)
  let previous = ALL_ORDERS.length
  for (const count of remaining) {
    if (count >= previous) return 'no-progress'
    previous = count
  }
  if (previous !== 1) return 'not-unique'
  return null
}
