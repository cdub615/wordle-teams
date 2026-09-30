/**
 * Pure Wordle display logic, ported from v1 (src/components/wordle-board.tsx
 * and src/components/app-grid-items/scores-table/table-config.tsx).
 *
 * Kept separate from the components so the duplicate-letter rules — the part
 * most likely to regress — can be unit tested without a DOM.
 */

export type TileState = 'correct' | 'present' | 'absent' | 'empty'

/**
 * Tile state for each of the five columns of one guess.
 *
 * The standard two-phase Wordle algorithm: exact matches are claimed first,
 * then the remaining answer letters form a pool that the non-exact columns
 * consume left to right. A letter is 'present' only while the pool still has
 * one to give, so the number of lit tiles for a letter can never exceed the
 * number in the answer.
 *
 * REPLACES v1'S ALGORITHM, DELIBERATELY (wt-ksh.12.10). v1 ran a different two
 * passes and its second pass demoted the EARLIER duplicate 'present' rather
 * than the later surplus one, losing a legitimate yellow: answer SPEED with
 * guess GEESE showed one E where the answer has two, telling the player a
 * correct letter was wrong. Patching that pass would have preserved a shape
 * that is hard to reason about; this is the algorithm real Wordle uses and it
 * makes the invariant obvious.
 *
 * This is a KNOWN, INTENTIONAL divergence from v1 during the parallel run. It
 * is a correctness fix on the signature component, not a redesign. Phase 7's
 * parity audit should expect the board to differ from prod on duplicate-letter
 * guesses, and only there.
 *
 * An empty or too-short answer yields all-'empty', matching v1, which renders
 * the bare grid until an answer exists.
 */
export function tileStates(answer: string, guess: string): Array<TileState> {
  const states: Array<TileState> = ['empty', 'empty', 'empty', 'empty', 'empty']
  if (!guess) return states
  if (!answer || answer.length !== 5) return states

  // Phase 1: exact matches. Every answer letter NOT claimed by one goes into
  // the pool that phase 2 draws from.
  const pool = new Map<string, number>()
  for (let i = 0; i < 5; i++) {
    const letter = guess[i]
    if (letter && letter === answer[i]) {
      states[i] = 'correct'
    } else {
      pool.set(answer[i], (pool.get(answer[i]) ?? 0) + 1)
    }
  }

  // Phase 2: everything else, left to right, consuming the pool.
  for (let i = 0; i < 5; i++) {
    if (states[i] === 'correct') continue
    const letter = guess[i]
    if (!letter) {
      states[i] = 'empty' // partial guess: the row is still being typed
      continue
    }
    const available = pool.get(letter) ?? 0
    if (available > 0) {
      pool.set(letter, available - 1)
      states[i] = 'present'
    } else {
      states[i] = 'absent'
    }
  }

  return states
}

// toRows lives in convex/lib/board.ts so the mutation and the browser agree on
// what a board's six rows are. Re-exported here because this module is the
// board components' entry point.
export { toRows } from '../../convex/lib/board.ts'

export type ScoreCell = number | 'X' | ''

/**
 * What one day's cell shows in the scores table. Ported from v1's table-config.
 *
 *   no score, day already past      -> 0     (a missed day scores zero)
 *   no score, today or later        -> ''    (not due yet)
 *   score present, 7 attempts       -> 'X'   (failed)
 *   score present, 0/absent, not past -> ''  (started but nothing recorded yet)
 *   otherwise                       -> the attempt count
 *
 * Weekends on a team with playWeekends off render 'N/A' instead; that is a
 * column-level rule and lives in the cell component, matching v1.
 */
export function scoreCell(opts: {
  attempts?: number | null
  hasScore: boolean
  isBeforeToday: boolean
}): ScoreCell {
  const { attempts, hasScore, isBeforeToday } = opts
  if (!hasScore) return isBeforeToday ? 0 : ''
  if (!attempts && !isBeforeToday) return ''
  if (attempts === 7) return 'X'
  return attempts ?? 0
}
