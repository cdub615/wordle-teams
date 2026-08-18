import { describe, expect, test } from 'vitest'
import { scoreCell, tileStates, toRows } from './wordle.ts'

// The duplicate-letter rules are the part of the board most likely to regress
// in a port, so they are pinned here against v1's algorithm.

const s = (answer: string, guess: string) =>
  tileStates(answer, guess)
    .map((t) => ({ correct: 'G', present: 'Y', absent: '-', empty: '.' })[t])
    .join('')

describe('tileStates', () => {
  test('all exact', () => expect(s('CRANE', 'CRANE')).toBe('GGGGG'))
  test('nothing in common', () => expect(s('CRANE', 'MOODY')).toBe('-----'))

  test('present letters in the wrong column', () => {
    expect(s('CRANE', 'NACRE')).toBe('YYYYG')
  })

  test('a second copy of a letter the answer only has once is absent', () => {
    // ROBOT has one R; only the first R can be present.
    expect(s('ROBOT', 'RRRRR')).toBe('G----')
  })

  test('an earlier present is demoted when a later column takes the same letter', () => {
    // LEMON has one E. EEMON puts an E in column 0 and the real one in column 1.
    // Pass 2 must grey the first, or the board shows two E's for a one-E answer.
    expect(s('LEMON', 'EEMON')).toBe('-GGGG')
  })

  test('surplus duplicates are greyed from the RIGHT, matching real Wordle', () => {
    // This is wt-ksh.12.10, the bug v1 has and v2 no longer does.
    // Answer SPEED has two E's; guess GEESE has three.
    //   green at column 2, yellow at column 1, grey at column 4 — two E's lit,
    //   matching the two in the answer.
    // v1 returned '--GY-', lighting only ONE E, because its second pass demoted
    // the earlier present instead of the later surplus one.
    expect(s('SPEED', 'GEESE')).toBe('-YGY-')
  })

  test('an exact match wins its column even when duplicates surround it', () => {
    // ALLOY has two L's. BALLS puts one at column 2, where ALLOY also has one,
    // so that column is exact and only one L is left in the pool for column 3.
    expect(s('ALLOY', 'BALLS')).toBe('-YGY-')
  })

  test('greens consume the answer letters before any yellow can', () => {
    // ABBEY has exactly two B's and both are already exact at columns 1 and 2,
    // so the third B in the guess has nothing left to claim.
    expect(s('ABBEY', 'BBBEY')).toBe('-GGGG')
  })

  test('never lights more tiles for a letter than the answer contains', () => {
    const cases = [
      ['SPEED', 'GEESE'],
      ['ALLOY', 'LLLLL'],
      ['ABBEY', 'BBBBB'],
      ['ROBOT', 'OOOOO'],
      ['CRANE', 'EEEEE'],
    ] as const
    for (const [answer, guess] of cases) {
      const states = tileStates(answer, guess)
      // Count lit tiles PER LETTER — the invariant is per letter, not overall.
      const lit = new Map<string, number>()
      states.forEach((state, i) => {
        if (state !== 'correct' && state !== 'present') return
        lit.set(guess[i], (lit.get(guess[i]) ?? 0) + 1)
      })
      for (const [letter, count] of lit) {
        const inAnswer = answer.split('').filter((c) => c === letter).length
        expect(
          count,
          `${guess} vs ${answer}: lit ${count} "${letter}" tiles but the answer has ${inAnswer}`,
        ).toBeLessThanOrEqual(inAnswer)
      }
    }
  })

  test('a partial guess leaves the remaining columns empty', () => {
    expect(s('CRANE', 'CR')).toBe('GG...')
  })

  test('no guess is an empty row', () => expect(s('CRANE', '')).toBe('.....'))

  test('no answer yields an empty row, matching v1s bare grid', () => {
    expect(s('', 'CRANE')).toBe('.....')
    expect(s('TOOSHORT', 'CRANE')).toBe('.....')
  })
})

describe('toRows', () => {
  test('pads to six', () => expect(toRows(['A', 'B'])).toEqual(['A', 'B', '', '', '', '']))
  test('does not mutate its input', () => {
    const input = ['A']
    toRows(input)
    expect(input).toEqual(['A'])
  })
  test('a full board is unchanged', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F']
    expect(toRows(six)).toEqual(six)
  })
})

describe('scoreCell', () => {
  test('a missed day in the past scores zero', () =>
    expect(scoreCell({ hasScore: false, isBeforeToday: true })).toBe(0))
  test('a day not yet due is blank', () =>
    expect(scoreCell({ hasScore: false, isBeforeToday: false })).toBe(''))
  test('seven attempts renders X', () =>
    expect(scoreCell({ attempts: 7, hasScore: true, isBeforeToday: true })).toBe('X'))
  test('an ordinary score renders the attempt count', () =>
    expect(scoreCell({ attempts: 4, hasScore: true, isBeforeToday: true })).toBe(4))
  test('a started-but-empty score today is blank', () =>
    expect(scoreCell({ attempts: 0, hasScore: true, isBeforeToday: false })).toBe(''))
  test('a zero-attempt score in the past stays zero', () =>
    expect(scoreCell({ attempts: 0, hasScore: true, isBeforeToday: true })).toBe(0))
})
