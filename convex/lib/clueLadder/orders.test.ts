// convex/lib/clueLadder/orders.test.ts
import { describe, expect, test } from 'vitest'
import { ALL_ORDERS, isOrder, orderKey, SHAPE_SYMBOLS, SHAPES, SLOT_COUNT } from './orders.ts'

describe('orders', () => {
  test('there are five shapes and five slots', () => {
    expect(SHAPES).toHaveLength(5)
    expect(SLOT_COUNT).toBe(5)
  })

  test('ALL_ORDERS is every permutation exactly once', () => {
    expect(ALL_ORDERS).toHaveLength(120)
    expect(new Set(ALL_ORDERS.map(orderKey)).size).toBe(120)
    for (const order of ALL_ORDERS) expect(isOrder(order)).toBe(true)
  })

  test('isOrder rejects wrong length, repeats and unknown shapes', () => {
    expect(isOrder(['triangle', 'square', 'circle', 'diamond'])).toBe(false)
    expect(isOrder(['triangle', 'triangle', 'circle', 'diamond', 'star'])).toBe(false)
    expect(isOrder(['triangle', 'square', 'circle', 'diamond', 'hexagon'])).toBe(false)
    expect(isOrder(['star', 'diamond', 'circle', 'square', 'triangle'])).toBe(true)
  })

  test('every shape has a distinct symbol', () => {
    expect(new Set(SHAPES.map((s) => SHAPE_SYMBOLS[s])).size).toBe(5)
  })
})
