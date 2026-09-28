import type { Bitmap, Rect } from '../bitmap.ts'
import type { LetterScores } from '../types.ts'
import templates from '../data/glyph-templates.json'
import { TEMPLATE_SIZE, glyphMask, normaliseGlyph, similarity } from './glyph-shape.ts'
import type { MaskOptions } from './glyph-shape.ts'

/**
 * Stage 3: what letter is on this tile.
 *
 * Size-normalised template matching over 26 classes. No model, no training
 * data, no inference dependency — a dot product against a committed table.
 *
 * IT DOES NOT NEED TO BE ACCURATE ON ITS OWN, AND THAT IS THE WHOLE DESIGN.
 * Stage 4 turns a per-character problem into a near-certain per-word one: every
 * row has to be in the accepted-guess list AND its colours have to be exactly
 * what Wordle emits for that guess against the answer. A shaky CRANF has
 * exactly one repair. So the job here is not to be right, it is to be HONEST —
 * a reader that is torn between two letters must say so with two entries,
 * because resolveRow scores candidate words by summing these confidences and a
 * falsely confident wrong letter is far more damaging than an admitted doubt.
 *
 * WHAT THESE NUMBERS ARE NOT: a measurement. Templates come from fonts, and
 * scoring them against renders of the same fonts measures nothing whatsoever.
 * Stage 3's accuracy is measured on the real screenshot corpus by
 * scripts/validate-board-import.mjs, and nowhere else.
 */

type TemplateFile = {
  readonly width: number
  readonly height: number
  readonly fonts: ReadonlyArray<string>
  readonly letters: Readonly<Record<string, ReadonlyArray<ReadonlyArray<number>>>>
}

const DATA = templates as unknown as TemplateFile

/** Flattened at load: every letter once per font, scored against the best. */
const SHAPES: ReadonlyArray<{ letter: string; cells: Float32Array }> = Object.entries(DATA.letters).flatMap(
  ([letter, variants]) => variants.map((cells) => ({ letter, cells: Float32Array.from(cells, (v) => v / 255) })),
)

/** The template set's own geometry, so a test can check it against the reader's. */
export const templateGeometry = { width: DATA.width, height: DATA.height, fonts: DATA.fonts }

export type GlyphOptions = MaskOptions & {
  /**
   * How sharply a similarity lead turns into confidence. Lower is more
   * decisive. This is the knob that decides whether a near-tie is reported as
   * a near-tie, so it is deliberately gentle: Stage 4 can repair a doubt it
   * was told about and cannot repair one it was not.
   */
  readonly temperature?: number
  /** At most this many letters are reported for one tile. */
  readonly keep?: number
  /** Confidences below this are dropped rather than reported as noise. */
  readonly floor?: number
}

const DEFAULTS = { temperature: 0.045, keep: 5, floor: 0.02 } as const

/**
 * Reads one tile.
 *
 * An EMPTY RESULT IS A REAL ANSWER, not a failure: there is no letter on this
 * tile. A share card — the emoji grid people post — is a lattice of coloured
 * squares with no text at all, and every tile coming back empty is how Task 5
 * tells that apart from a board it merely misread.
 */
export function readGlyph(bitmap: Bitmap, tile: Rect, options: GlyphOptions = {}): LetterScores {
  const settings = { ...DEFAULTS, ...options }
  const mask = glyphMask(bitmap, tile, options)
  if (mask === null) return {}
  const observed = normaliseGlyph(mask)
  if (observed === null) return {}

  // Best over the fonts: a shape one grotesque draws unusually is covered by
  // the others, and taking the max never makes a letter look worse than it is.
  const best = new Map<string, number>()
  for (const shape of SHAPES) {
    const score = similarity(observed, shape.cells)
    const previous = best.get(shape.letter)
    if (previous === undefined || score > previous) best.set(shape.letter, score)
  }
  if (best.size === 0) return {}

  const top = Math.max(...best.values())
  const weights = [...best.entries()]
    .map(([letter, score]) => ({ letter, weight: Math.exp((score - top) / settings.temperature) }))
    .sort((a, b) => b.weight - a.weight)

  const total = weights.reduce((sum, entry) => sum + entry.weight, 0)
  const kept = weights.slice(0, settings.keep).filter((entry) => entry.weight / total >= settings.floor)
  const keptTotal = kept.reduce((sum, entry) => sum + entry.weight, 0)
  if (keptTotal === 0) return {}

  const scores: Record<string, number> = {}
  for (const entry of kept) scores[entry.letter] = entry.weight / keptTotal
  return scores
}

/** Reads a whole row of tiles, left to right. */
export function readRow(
  bitmap: Bitmap,
  tiles: ReadonlyArray<Rect>,
  options: GlyphOptions = {},
): Array<LetterScores> {
  return tiles.map((tile) => readGlyph(bitmap, tile, options))
}

/** Shared with the generator so a mismatch is a test failure, not a silent misread. */
export const expectedTemplateSize = TEMPLATE_SIZE
