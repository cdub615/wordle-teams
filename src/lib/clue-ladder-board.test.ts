import { describe, expect, test } from 'vitest'
import { clearSlot, EMPTY_SLOTS, filledOrder, placeShape, trayShapes } from './clue-ladder-board.ts'

describe('placeShape', () => {
  test('puts a tray shape in an empty slot', () => {
    expect(placeShape(EMPTY_SLOTS, 'star', 2)).toEqual([null, null, 'star', null, null])
  })

  test('moves a placed shape rather than copying it', () => {
    const slots = placeShape(EMPTY_SLOTS, 'star', 0)
    expect(placeShape(slots, 'star', 4)).toEqual([null, null, null, null, 'star'])
  })

  test('the shape it replaces goes back to the tray', () => {
    const slots = placeShape(EMPTY_SLOTS, 'star', 0)
    const next = placeShape(slots, 'circle', 0)
    expect(next).toEqual(['circle', null, null, null, null])
    expect(trayShapes(next)).toContain('star')
  })

  test('leaves its input alone', () => {
    const slots = placeShape(EMPTY_SLOTS, 'star', 0)
    placeShape(slots, 'circle', 1)
    expect(slots).toEqual(['star', null, null, null, null])
  })
})

describe('clearSlot', () => {
  test('empties one slot', () => {
    expect(clearSlot(['star', 'circle', null, null, null], 0)).toEqual([null, 'circle', null, null, null])
  })
})

describe('trayShapes', () => {
  test('lists unplaced shapes in a fixed order', () => {
    expect(trayShapes(['circle', null, 'triangle', null, null])).toEqual(['square', 'diamond', 'star'])
  })
})

describe('filledOrder', () => {
  test('is null until every slot is filled', () => {
    expect(filledOrder(['circle', null, 'triangle', null, null])).toBeNull()
  })

  test('is the order once full', () => {
    const full = ['star', 'circle', 'square', 'triangle', 'diamond'] as const
    expect(filledOrder(full)).toEqual(full)
  })
})
