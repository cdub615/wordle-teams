import { feedbackFor, marksEqual } from './feedback.ts'
import type { RowObservation } from './types.ts'

export type RowResolution =
  | { ok: true; word: string; score: number }
  | { ok: false; reason: 'no-candidate' }

/**
 * Turns one noisy row into one certain word — Stage 4 of the spec.
 *
 * WHY THIS IS ACCURATE WHERE GENERAL OCR IS NOT. Two constraints that ordinary
 * text recognition does not have:
 *
 *   1. the row must be a word in the accepted-guess list, and
 *   2. colouring that word against the answer must reproduce the marks we read.
 *
 * Together those usually leave exactly one admissible word, so a shaky glyph is
 * repaired rather than propagated. The reader's confidence is then only a
 * tie-breaker AMONG words that already satisfy both constraints — which is why
 * a confident misread still loses to the colours.
 *
 * NO ANSWER IS AN ORDINARY CASE, not an error: it happens on a board the player
 * failed. Constraint 2 is simply unavailable and constraint 1 carries the row
 * alone, which is weaker — and is why the caller must still show the parse for
 * confirmation rather than saving it.
 *
 * A LINEAR SCAN OF ~13k WORDS IS THE RIGHT IMPLEMENTATION. It runs once per row
 * on a user gesture; an index would be complexity bought with nothing.
 */
export function resolveRow(
  observation: RowObservation,
  words: ReadonlyArray<string>,
  answer: string | null,
): RowResolution {
  let best: { word: string; score: number } | null = null

  for (const word of words) {
    if (word.length !== observation.letters.length) continue
    if (answer !== null && !marksEqual(feedbackFor(word, answer), observation.marks)) continue

    let score = 0
    for (let i = 0; i < word.length; i++) {
      score += observation.letters[i][word[i]] ?? 0
    }

    // Strictly greater, so a tie keeps the earlier word and the result is
    // stable under a re-sort of the list.
    if (best === null || score > best.score) best = { word, score }
  }

  return best === null ? { ok: false, reason: 'no-candidate' } : { ok: true, ...best }
}
