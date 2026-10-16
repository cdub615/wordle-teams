import { v } from 'convex/values'

/**
 * Convex validators for the clue ladder's shapes and clues (wordle-teams-9j7o.2.3).
 *
 * HERE, NOT IN lib/clueLadder/, which stays free of Convex imports so the
 * simulation runner can load it in plain Node (orders.ts). ladderValidators.test.ts
 * holds these to SHAPES and to the Clue type, so they cannot drift apart.
 */
export const shapeValidator = v.union(
  v.literal('triangle'),
  v.literal('square'),
  v.literal('circle'),
  v.literal('diamond'),
  v.literal('star'),
)

/** One slot of a scratch arrangement: a shape, or null while empty. */
export const slotValidator = v.union(
  v.literal('triangle'),
  v.literal('square'),
  v.literal('circle'),
  v.literal('diamond'),
  v.literal('star'),
  v.null(),
)

export const clueValidator = v.union(
  v.object({ kind: v.literal('atEnd'), shape: shapeValidator, negated: v.boolean() }),
  v.object({ kind: v.literal('inSlot'), shape: shapeValidator, slot: v.number(), negated: v.boolean() }),
  v.object({ kind: v.literal('leftOf'), a: shapeValidator, b: shapeValidator }),
  v.object({ kind: v.literal('rightOf'), a: shapeValidator, b: shapeValidator }),
  v.object({ kind: v.literal('nextTo'), a: shapeValidator, b: shapeValidator, negated: v.boolean() }),
  v.object({ kind: v.literal('between'), shape: shapeValidator, a: shapeValidator, b: shapeValidator }),
  v.object({ kind: v.literal('apart'), a: shapeValidator, b: shapeValidator, distance: v.number() }),
)
