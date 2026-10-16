import type { Infer } from 'convex/values'
import { describe, expect, expectTypeOf, test } from 'vitest'
import type { Clue } from './clueLadder/clues.ts'
import { SHAPES } from './clueLadder/orders.ts'
import { clueValidator, shapeValidator, slotValidator } from './ladderValidators.ts'

describe('ladder validators', () => {
  test('the shape validator is exactly SHAPES, in order', () => {
    expect(shapeValidator.members.map((member) => member.value)).toEqual([...SHAPES])
  })

  test('a slot is a shape or null', () => {
    // v.null() has no `.value`, so the null member is read by its kind.
    const members = slotValidator.members.map((member) => ('value' in member ? member.value : member.kind))
    expect(members).toEqual([...SHAPES, 'null'])
  })

  test('the clue validator stores exactly the engine’s Clue type', () => {
    // A compile-time check: `pnpm typecheck` fails if the two drift apart.
    expectTypeOf<Infer<typeof clueValidator>>().toEqualTypeOf<Clue>()
  })
})
