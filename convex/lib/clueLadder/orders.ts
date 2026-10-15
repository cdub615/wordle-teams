// convex/lib/clueLadder/orders.ts
/**
 * The clue ladder's board: five distinct shapes in a row. An Order is one
 * arrangement, index 0 = leftmost slot. Shapes differ by outline, not colour,
 * so the game reads the same for colour-blind players (spec section 6).
 *
 * Pure and Convex-free: the generator, the Convex functions and the
 * simulation runner (plain Node) all import this.
 */
export const SHAPES = ['triangle', 'square', 'circle', 'diamond', 'star'] as const
export type Shape = (typeof SHAPES)[number]
export type Order = readonly Shape[]

export const SLOT_COUNT = SHAPES.length

export const SHAPE_SYMBOLS: Readonly<Record<Shape, string>> = {
  triangle: '▲',
  square: '■',
  circle: '●',
  diamond: '◆',
  star: '★',
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()]
  const out: T[][] = []
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) out.push([item, ...tail])
  })
  return out
}

/** All 120 orders, computed once. */
export const ALL_ORDERS: readonly Order[] = permutations(SHAPES)

/** True when `value` is a full order: five slots holding each shape once. */
export function isOrder(value: readonly string[]): value is Order {
  return value.length === SLOT_COUNT && SHAPES.every((shape) => value.includes(shape))
}

export function orderKey(order: Order): string {
  return order.join(',')
}
