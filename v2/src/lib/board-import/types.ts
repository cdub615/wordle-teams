/**
 * Shared vocabulary for board import. Deliberately plain data: nothing in here
 * references an image, a DOM node or a Convex document, which is what lets the
 * whole correctness core be tested in this repo's edge-runtime vitest
 * environment (see vitest.config.ts — there is no DOM and no canvas).
 */

/**
 * What a tile's colour MEANS. Named for meaning, never for the colour itself:
 * high-contrast mode paints "correct" blue and "present" orange, so a type
 * called `green` would be a lie on a real player's screenshot.
 */
export type Mark = 'absent' | 'present' | 'correct'

/**
 * What the glyph reader thinks a single tile says: a confidence in 0..1 for
 * each letter it considered. Sparse on purpose — a reader that is sure returns
 * one entry, a reader that is torn returns several. Letters not mentioned
 * score 0.
 */
export type LetterScores = Readonly<Record<string, number>>

/** One row of the board as OBSERVED, before any repair. */
export type RowObservation = {
  readonly letters: ReadonlyArray<LetterScores>
  readonly marks: ReadonlyArray<Mark>
}
