import { describe, expect, test } from 'vitest'
import { DEFAULT_PARAMS, generatePuzzle, type GeneratorParams } from './generate.ts'
import { ladderProblem, MAX_CLUES, MIN_CLUES, remainingAfter } from './ladder.ts'
import { isOrder } from './orders.ts'

const SEEDS = Array.from({ length: 1500 }, (_, i) => i * 7919 + 1)
// Generated once at collection time, outside any test's 5 s timeout.
const PUZZLES = SEEDS.map((seed) => ({ seed, puzzle: generatePuzzle(seed) }))

describe('generatePuzzle', () => {
  test('every ladder obeys the rules across many seeds', () => {
    for (const { seed, puzzle: p } of PUZZLES) {
      expect(isOrder(p.answer)).toBe(true)
      expect(ladderProblem(p.answer, p.clues), `seed ${seed}`).toBeNull()
      expect(p.remaining).toEqual(remainingAfter(p.clues))
    }
  })

  test('the same seed always gives the same puzzle', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      expect(generatePuzzle(seed)).toEqual(generatePuzzle(seed))
    }
  })

  test('different seeds give varied answers and lengths', () => {
    const puzzles = PUZZLES.map(({ puzzle }) => puzzle)
    expect(new Set(puzzles.map((p) => p.answer.join())).size).toBeGreaterThan(100)
    const lengths = new Set(puzzles.map((p) => p.clues.length))
    for (let n = MIN_CLUES; n <= MAX_CLUES; n++) expect(lengths.has(n), `length ${n}`).toBe(true)
  })

  test('no clue kind is used more than maxPerKind times, except in the fallback', () => {
    for (const { puzzle: p } of PUZZLES) {
      if (p.fallback) continue
      const counts = new Map<string, number>()
      for (const c of p.clues) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1)
      for (const n of counts.values()) expect(n).toBeLessThanOrEqual(DEFAULT_PARAMS.maxPerKind)
    }
  })

  test('the fallback is rare with default params', () => {
    const fallbacks = PUZZLES.filter(({ puzzle }) => puzzle.fallback).length
    expect(fallbacks / SEEDS.length).toBeLessThan(0.05)
  })

  test('the before-last target is honoured when not falling back', () => {
    const onlyTwo: GeneratorParams = { ...DEFAULT_PARAMS, beforeLastWeights: [[2, 1]] }
    for (const seed of SEEDS.slice(0, 200)) {
      const p = generatePuzzle(seed, onlyTwo)
      if (p.fallback) continue
      expect(p.remaining[p.remaining.length - 2]).toBe(2)
    }
  })

  test('the fallback ladder is itself valid', () => {
    const impossible: GeneratorParams = { ...DEFAULT_PARAMS, attempts: 0 }
    const p = generatePuzzle(5, impossible)
    expect(p.fallback).toBe(true)
    expect(ladderProblem(p.answer, p.clues)).toBeNull()
  })
})
