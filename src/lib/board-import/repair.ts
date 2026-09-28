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

export type BoardResolution =
  | { ok: true; answer: string | null; words: Array<string> }
  | { ok: false; reason: 'no-candidate'; rowIndex: number }

/**
 * Resolves a whole board, deriving the answer first when it is not supplied.
 *
 * THE ANSWER IS CIRCULAR, AND THE TWO PASSES ARE HOW THAT IS BROKEN. A solved
 * board's winning row IS the answer, but reading it wants the answer as a
 * constraint. So: resolve the all-correct row under constraint 1 alone, take
 * the word it yields as the answer, then resolve every row — that one included
 * — under both constraints.
 *
 * WHERE THE ANSWER COMES FROM, in the order the spec sets out: the caller's
 * value if it has one (the entry form already asks the player for it); else the
 * all-correct row; else nothing, and the board resolves on the word list alone.
 * That last case is the failed board, and it is ordinary rather than an error.
 */
export function resolveBoard(
  rows: ReadonlyArray<RowObservation>,
  words: ReadonlyArray<string>,
  suppliedAnswer: string | null,
): BoardResolution {
  let answer = suppliedAnswer === null ? null : suppliedAnswer.toUpperCase()

  if (answer === null) {
    const winning = rows.findIndex((r) => r.marks.every((mark) => mark === 'correct'))
    if (winning !== -1) {
      const derived = resolveRow(rows[winning], words, null)
      // A winning row we cannot read is a failure THERE, reported against that
      // row — not a silent fall back to answerless mode, which would resolve
      // the rest of the board under a weaker constraint and hide the problem.
      if (!derived.ok) return { ok: false, reason: 'no-candidate', rowIndex: winning }
      answer = derived.word
    }
  }

  const resolved: Array<string> = []
  for (let i = 0; i < rows.length; i++) {
    const row = resolveRow(rows[i], words, answer)
    if (!row.ok) return { ok: false, reason: 'no-candidate', rowIndex: i }
    resolved.push(row.word)
  }

  return { ok: true, answer, words: resolved }
}
