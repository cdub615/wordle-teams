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
    [{ kind: 'atEnd', shape: 'triangle', negated: false }, '▲ is at one end'],
    [{ kind: 'atEnd', shape: 'circle', negated: true }, '● is not at either end'],
    [{ kind: 'inSlot', shape: 'circle', slot: 2, negated: false }, '● is third'],
    [{ kind: 'inSlot', shape: 'circle', slot: 0, negated: true }, '● is not first'],
    [{ kind: 'leftOf', a: 'triangle', b: 'star' }, '▲ is somewhere left of ★'],
    [{ kind: 'rightOf', a: 'star', b: 'triangle' }, '★ is somewhere right of ▲'],
    [{ kind: 'nextTo', a: 'square', b: 'circle', negated: false }, '■ is next to ●'],
    [{ kind: 'nextTo', a: 'square', b: 'diamond', negated: true }, '■ is not next to ◆'],
    [{ kind: 'between', shape: 'circle', a: 'triangle', b: 'star' }, '● is somewhere between ▲ and ★'],
    [{ kind: 'apart', a: 'triangle', b: 'circle', distance: 2 }, 'Exactly 1 shape sits between ▲ and ●'],
    [{ kind: 'apart', a: 'triangle', b: 'star', distance: 4 }, 'Exactly 3 shapes sit between ▲ and ★'],
  ])('%j reads "%s"', (clue, text) => {
    expect(clueText(clue)).toBe(text)
  })
})
