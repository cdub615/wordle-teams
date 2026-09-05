import type { Mark } from './types.ts'

/**
 * Wordle's colouring rules, reproduced exactly.
 *
 * This is the constraint that makes board import accurate rather than merely
 * plausible: a candidate word is admissible only if colouring it against the
 * answer reproduces the marks we read off the screenshot. See repair.ts.
 *
 * TWO PASSES, AND THE ORDER IS THE WHOLE ALGORITHM. Greens are claimed first
 * and remove their letter from the pool; only then are yellows handed out from
 * what is left. A single pass marks an early duplicate yellow and then has
 * nothing left for a later green, which is the classic wrong answer.
 */
export function feedbackFor(guess: string, answer: string): Array<Mark> {
  const g = guess.toUpperCase()
  const a = answer.toUpperCase()
  const marks: Array<Mark> = Array.from({ length: g.length }, () => 'absent')

  // Pass one: greens, and count what the answer has left over afterwards.
  const remaining = new Map<string, number>()
  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) marks[i] = 'correct'
    else remaining.set(a[i], (remaining.get(a[i]) ?? 0) + 1)
  }

  // Pass two: yellows, paid for out of the remainder, left to right.
  for (let i = 0; i < g.length; i++) {
    if (marks[i] === 'correct') continue
    const left = remaining.get(g[i]) ?? 0
    if (left > 0) {
      marks[i] = 'present'
      remaining.set(g[i], left - 1)
    }
  }

  return marks
}

/** Marks compare by value; there is no shared identity to lean on. */
export function marksEqual(a: ReadonlyArray<Mark>, b: ReadonlyArray<Mark>): boolean {
  return a.length === b.length && a.every((mark, i) => mark === b[i])
}
