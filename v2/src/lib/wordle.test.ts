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

  test('KNOWN v1 DIVERGENCE FROM REAL WORDLE: over-demotion (wt-ksh.12.10)', () => {
    // Answer SPEED has two E's; guess GEESE has three.
    // Real Wordle: green at column 2, yellow at column 1, grey at column 4
    //   -> '-YGY-'  (two E's shown, matching the two in the answer)
    // v1 and therefore this port: '--GY-'  (only ONE E shown)
    // Pass 2 demotes the EARLIER present rather than the later surplus one, so
    // a legitimate yellow is lost. Pinned here because Phase 1.5 is a parity
    // port; filed as wt-ksh.12.10 to fix deliberately rather than by accident.
    expect(s('SPEED', 'GEESE')).toBe('--GY-')
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
