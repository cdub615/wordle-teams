import { describe, expect, test } from 'vitest'
import { candidateClues, clueText, holds, type Clue } from './clues.ts'
import { ALL_ORDERS, type Order } from './orders.ts'

// ▲ ■ ● ◆ ★
const ORDER: Order = ['triangle', 'square', 'circle', 'diamond', 'star']

describe('holds', () => {
  test.each<[Clue, boolean]>([
    [{ kind: 'atEnd', shape: 'triangle', negated: false }, true],
    [{ kind: 'atEnd', shape: 'star', negated: false }, true],
    [{ kind: 'atEnd', shape: 'circle', negated: false }, false],
    [{ kind: 'atEnd', shape: 'circle', negated: true }, true],
    [{ kind: 'atEnd', shape: 'triangle', negated: true }, false],
    [{ kind: 'inSlot', shape: 'circle', slot: 2, negated: false }, true],
    [{ kind: 'inSlot', shape: 'circle', slot: 1, negated: false }, false],
    [{ kind: 'inSlot', shape: 'circle', slot: 1, negated: true }, true],
    [{ kind: 'inSlot', shape: 'circle', slot: 2, negated: true }, false],
    [{ kind: 'leftOf', a: 'triangle', b: 'star' }, true],
    [{ kind: 'leftOf', a: 'star', b: 'triangle' }, false],
    [{ kind: 'rightOf', a: 'star', b: 'triangle' }, true],
    [{ kind: 'rightOf', a: 'triangle', b: 'star' }, false],
    [{ kind: 'nextTo', a: 'square', b: 'circle', negated: false }, true],
    [{ kind: 'nextTo', a: 'square', b: 'diamond', negated: false }, false],
    [{ kind: 'nextTo', a: 'square', b: 'diamond', negated: true }, true],
    [{ kind: 'nextTo', a: 'square', b: 'circle', negated: true }, false],
    [{ kind: 'between', shape: 'circle', a: 'triangle', b: 'star' }, true],
    [{ kind: 'between', shape: 'circle', a: 'star', b: 'triangle' }, true],
    [{ kind: 'between', shape: 'triangle', a: 'square', b: 'star' }, false],
    [{ kind: 'between', shape: 'star', a: 'triangle', b: 'square' }, false],
    [{ kind: 'between', shape: 'triangle', a: 'triangle', b: 'star' }, false],
    [{ kind: 'apart', a: 'triangle', b: 'circle', distance: 2 }, true],
    [{ kind: 'apart', a: 'triangle', b: 'circle', distance: 3 }, false],
    [{ kind: 'apart', a: 'triangle', b: 'star', distance: 4 }, true],
  ])('%j on ▲■●◆★ is %s', (clue, expected) => {
    expect(holds(clue, ORDER)).toBe(expected)
  })
})

describe('candidateClues', () => {
  test('every candidate is true for the answer', () => {
    const clues = candidateClues(ORDER)
    expect(clues.length).toBeGreaterThan(40)
    for (const clue of clues) expect(holds(clue, ORDER)).toBe(true)
  })

  test('every clue kind appears for an arbitrary answer', () => {
    const kinds = new Set(candidateClues(ORDER).map((c) => c.kind))
    expect([...kinds].sort()).toEqual(
      ['apart', 'atEnd', 'between', 'inSlot', 'leftOf', 'nextTo', 'rightOf'],
    )
  })

  test('the candidates together pin down the answer uniquely', () => {
    const clues = candidateClues(ORDER)
    const left = ALL_ORDERS.filter((o) => clues.every((c) => holds(c, o)))
    expect(left).toEqual([ORDER])
  })
})

describe('clueText', () => {
  test.each<[Clue, string]>([
    [{ kind: 'atEnd', shape: 'triangle', negated: false }, 'The triangle is at one end.'],
    [{ kind: 'atEnd', shape: 'circle', negated: true }, 'The circle is not at either end.'],
    [{ kind: 'inSlot', shape: 'circle', slot: 2, negated: false }, 'The circle is in the third slot.'],
    [{ kind: 'inSlot', shape: 'circle', slot: 0, negated: true }, 'The circle is not in the first slot.'],
    [{ kind: 'inSlot', shape: 'diamond', slot: 4, negated: false }, 'The diamond is in the fifth slot.'],
    [{ kind: 'leftOf', a: 'star', b: 'circle' }, 'The star is somewhere left of the circle.'],
    [{ kind: 'rightOf', a: 'star', b: 'triangle' }, 'The star is somewhere right of the triangle.'],
    [{ kind: 'nextTo', a: 'square', b: 'circle', negated: false }, 'The square is next to the circle.'],
    [{ kind: 'nextTo', a: 'square', b: 'diamond', negated: true }, 'The square is not next to the diamond.'],
    [{ kind: 'between', shape: 'circle', a: 'triangle', b: 'star' }, 'The circle is somewhere between the triangle and the star.'],
    [{ kind: 'apart', a: 'triangle', b: 'circle', distance: 2 }, 'Exactly one shape sits between the triangle and the circle.'],
    [{ kind: 'apart', a: 'triangle', b: 'square', distance: 3 }, 'Exactly two shapes sit between the triangle and the square.'],
    [{ kind: 'apart', a: 'triangle', b: 'star', distance: 4 }, 'Exactly three shapes sit between the triangle and the star.'],
  ])('%j reads "%s"', (clue, text) => {
    expect(clueText(clue)).toBe(text)
  })

  test('every clue the vocabulary can produce is one sentence in words', () => {
    // No symbol, no digit, a capital first and a full stop last, for every true
    // clue about every order: the cases above cover each kind, this covers
    // every shape, slot and distance.
    for (const order of ALL_ORDERS) {
      for (const clue of candidateClues(order)) {
        const text = clueText(clue)
        expect(text, JSON.stringify(clue)).toMatch(/^[A-Z][a-z ]+\.$/)
      }
    }
  })
})
