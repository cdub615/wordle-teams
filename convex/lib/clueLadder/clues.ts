import { SHAPES, SLOT_COUNT, type Order, type Shape } from './orders.ts'

/**
 * A clue is a true/false test over an Order. Slots are 0-based internally
 * and shown 1-based ("first") to players.
 *
 * leftOf and rightOf are the same relation with the operands swapped. Both
 * exist so a ladder can phrase it either way; the generator's per-kind cap
 * treats them as separate kinds.
 */
export type Clue =
  | { kind: 'atEnd'; shape: Shape; negated: boolean }
  | { kind: 'inSlot'; shape: Shape; slot: number; negated: boolean }
  | { kind: 'leftOf'; a: Shape; b: Shape }
  | { kind: 'rightOf'; a: Shape; b: Shape }
  | { kind: 'nextTo'; a: Shape; b: Shape; negated: boolean }
  | { kind: 'between'; shape: Shape; a: Shape; b: Shape }
  | { kind: 'apart'; a: Shape; b: Shape; distance: number }

export type ClueKind = Clue['kind']

export function holds(clue: Clue, order: Order): boolean {
  const at = (shape: Shape) => order.indexOf(shape)
  switch (clue.kind) {
    case 'atEnd': {
      const p = at(clue.shape)
      return (p === 0 || p === SLOT_COUNT - 1) !== clue.negated
    }
    case 'inSlot':
      return (at(clue.shape) === clue.slot) !== clue.negated
    case 'leftOf':
      return at(clue.a) < at(clue.b)
    case 'rightOf':
      return at(clue.a) > at(clue.b)
    case 'nextTo':
      return (Math.abs(at(clue.a) - at(clue.b)) === 1) !== clue.negated
    case 'between': {
      const p = at(clue.shape)
      const a = at(clue.a)
      const b = at(clue.b)
      return Math.min(a, b) < p && p < Math.max(a, b)
    }
    case 'apart':
      return Math.abs(at(clue.a) - at(clue.b)) === clue.distance
  }
}

/**
 * Every clue in the vocabulary that is TRUE for `answer`. Symmetric relations
 * (nextTo, apart, between's two ends) appear once, with operands in SHAPES
 * order. apart starts at distance 2 because distance 1 is nextTo.
 */
export function candidateClues(answer: Order): Clue[] {
  const all: Clue[] = []
  for (const shape of SHAPES) {
    for (const negated of [false, true]) all.push({ kind: 'atEnd', shape, negated })
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      for (const negated of [false, true]) all.push({ kind: 'inSlot', shape, slot, negated })
    }
  }
  SHAPES.forEach((a, i) => {
    SHAPES.forEach((b, j) => {
      if (i === j) return
      all.push({ kind: 'leftOf', a, b }, { kind: 'rightOf', a, b })
      if (i < j) {
        for (const negated of [false, true]) all.push({ kind: 'nextTo', a, b, negated })
        for (let distance = 2; distance < SLOT_COUNT; distance++) {
          all.push({ kind: 'apart', a, b, distance })
        }
      }
    })
  })
  for (const shape of SHAPES) {
    SHAPES.forEach((a, i) => {
      SHAPES.forEach((b, j) => {
        if (i < j && shape !== a && shape !== b) all.push({ kind: 'between', shape, a, b })
      })
    })
  }
  return all.filter((clue) => holds(clue, answer))
}

const SLOT_NAMES = ['first', 'second', 'third', 'fourth', 'fifth'] as const

/** Shapes between two others: apart's distance runs 2–4, so 1–3. */
const COUNT_WORDS = ['no', 'one', 'two', 'three'] as const

/** "the star". The shape's own name, so a screen reader reads the clue exactly as written. */
const the = (shape: Shape) => `the ${shape}`

const sentence = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}.`

/**
 * Player-facing text for a clue: one sentence that names the shapes in words
 * (owner decision, 2026-10-15). Not symbols: the board draws outlines, not the
 * filled ▲ ● glyphs, and a screen reader reads a glyph out by its Unicode name.
 *
 * "SOMEWHERE" MARKS A RELATION THAT HOLDS AT ANY DISTANCE (left of, right of,
 * between), so it is not read as "directly". "Next to" is the adjacent one.
 *
 * TEXT ONLY. Nothing scores or generates from it; the clue objects are what is
 * stored and tested, so rewording a sentence never changes a puzzle.
 */
export function clueText(clue: Clue): string {
  switch (clue.kind) {
    case 'atEnd':
      return sentence(`${the(clue.shape)} is ${clue.negated ? 'not at either end' : 'at one end'}`)
    case 'inSlot':
      return sentence(`${the(clue.shape)} is ${clue.negated ? 'not ' : ''}in the ${SLOT_NAMES[clue.slot]} slot`)
    case 'leftOf':
      return sentence(`${the(clue.a)} is somewhere left of ${the(clue.b)}`)
    case 'rightOf':
      return sentence(`${the(clue.a)} is somewhere right of ${the(clue.b)}`)
    case 'nextTo':
      return sentence(`${the(clue.a)} is ${clue.negated ? 'not ' : ''}next to ${the(clue.b)}`)
    case 'between':
      return sentence(`${the(clue.shape)} is somewhere between ${the(clue.a)} and ${the(clue.b)}`)
    case 'apart': {
      const gap = clue.distance - 1
      const shapes = gap === 1 ? 'shape sits' : 'shapes sit'
      return sentence(`exactly ${COUNT_WORDS[gap]} ${shapes} between ${the(clue.a)} and ${the(clue.b)}`)
    }
  }
}
