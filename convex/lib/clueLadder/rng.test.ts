import { describe, expect, test } from 'vitest'
import { createRng } from './rng.ts'

describe('createRng', () => {
  test('the same seed gives the same sequence', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  // Values from the reference mulberry32. Changing them changes every
  // daily puzzle, so this test failing is never fixed by updating it.
  test.each([
    [42, [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]],
    [3_000_000_000, [0.7568875285796821, 0.3733226382173598, 0.9749945921357721]],
  ])('seed %d matches the reference mulberry32', (seed, expected) => {
    const rng = createRng(seed)
    expect([rng.next(), rng.next(), rng.next()]).toEqual(expected)
  })

  test('different seeds give different sequences', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next())
  })

  test('next is in [0, 1) and int(n) is in [0, n)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 5000; i++) {
      const x = rng.next()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      const k = rng.int(6)
      expect(Number.isInteger(k)).toBe(true)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThan(6)
    }
  })

  test('int(n) reaches every value', () => {
    const rng = createRng(9)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(rng.int(6))
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })

  test('shuffle is a permutation and leaves its input alone', () => {
    const input = [1, 2, 3, 4, 5]
    const out = createRng(3).shuffle(input)
    expect(input).toEqual([1, 2, 3, 4, 5])
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  })

  test('pick throws on an empty list', () => {
    expect(() => createRng(1).pick([])).toThrow()
  })

  test('weighted never returns a zero-weight key and roughly follows weights', () => {
    const rng = createRng(11)
    const counts = new Map<string, number>()
    for (let i = 0; i < 10000; i++) {
      const k = rng.weighted([['a', 3], ['b', 1], ['never', 0]])
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    expect(counts.get('never')).toBeUndefined()
    const ratio = (counts.get('a') ?? 0) / (counts.get('b') ?? 1)
    expect(ratio).toBeGreaterThan(2.5)
    expect(ratio).toBeLessThan(3.5)
  })

  test('weighted throws when all weights are zero', () => {
    expect(() => createRng(1).weighted([['a', 0]])).toThrow()
  })
})
