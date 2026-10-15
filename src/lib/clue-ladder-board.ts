import { isOrder, SHAPES, SLOT_COUNT, type Order, type Shape } from '../../convex/lib/clueLadder/orders.ts'

/** The player's arrangement: one entry per slot, null where empty. Matches clueLadderPlays.scratch. */
export type Slots = ReadonlyArray<Shape | null>

export const EMPTY_SLOTS: Slots = Array.from({ length: SLOT_COUNT }, () => null)

/** Put `shape` in slot `index`. It leaves any other slot it sat in; whatever was at `index` returns to the tray. */
export function placeShape(slots: Slots, shape: Shape, index: number): Slots {
  return slots.map((current, i) => (i === index ? shape : current === shape ? null : current))
}

export function clearSlot(slots: Slots, index: number): Slots {
  return slots.map((current, i) => (i === index ? null : current))
}

/** Shapes not in any slot, in SHAPES order so the tray never reshuffles under the player's thumb. */
export function trayShapes(slots: Slots): Array<Shape> {
  return SHAPES.filter((shape) => !slots.includes(shape))
}

/** The arrangement as an order once every slot holds a different shape, else null. */
export function filledOrder(slots: Slots): Order | null {
  const shapes = slots.filter((shape): shape is Shape => shape !== null)
  return shapes.length === SLOT_COUNT && isOrder(shapes) ? shapes : null
}
