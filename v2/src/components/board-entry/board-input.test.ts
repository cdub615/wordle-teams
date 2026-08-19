import { describe, expect, test } from 'vitest'
import { applyBackspace, applyLetter } from './board-input.tsx'
import { toRows } from '../../../convex/lib/board.ts'

const EMPTY = ['', '', '', '', '', '']

describe('applyLetter', () => {
  test('types into the active (first incomplete) row', () => {
    const result = applyLetter('c', 'CRANE', EMPTY)
    expect(toRows(result)).toEqual(['C', '', '', '', '', ''])
  })

  test('uppercases the typed letter', () => {
    const result = applyLetter('c', 'CRANE', EMPTY)
    expect(toRows(result)[0]).toBe('C')
  })

  test('advances to the next row once the active one is full', () => {
    const result = applyLetter('X', 'CRANE', ['CRAN', '', '', '', '', ''])
    expect(toRows(result)).toEqual(['CRANX', '', '', '', '', ''])
  })

  test('typing into a finished (all six rows full) board is a clean no-op', () => {
    // No row is '' (every row is full), so `current` falls back to '' and
    // `rows.indexOf(current)` is -1 — a caller-replicated-guard edge that
    // applyLetter now handles itself with an early return, rather than
    // writing to index -1 on the array. Asserted directly (not through
    // toRows): a real early return equals the plain input, no stray
    // property involved.
    const full = ['CRANE', 'SLATE', 'TRAIN', 'HOUSE', 'MOUSE', 'PIVOT']
    const result = applyLetter('X', 'CRANE', full)
    expect(result).toEqual(full)
  })

  test('the current-equals-answer guard is a no-op only when both are empty', () => {
    // This is the literal `current === answer` branch in applyLetter's own
    // jsdoc ("once a row equals the answer the board is finished"). In
    // practice `current` is the ACTIVE (incomplete, <5-char) row, which can
    // only ever equal a 5-letter answer if both are the empty string — i.e.
    // nothing has been typed into either field yet. It is NOT what stops
    // typing after a solved row (see the next test): that is enforced by the
    // caller (board-input.tsx's handleKeyDown checks boardIsValid first),
    // not by this function.
    const result = applyLetter('X', '', EMPTY)
    expect(toRows(result)).toEqual(EMPTY)
  })

  test('does NOT itself stop typing past an already-solved row', () => {
    // Documents the flip side of the guard above: applyLetter alone will
    // happily start a new row after row 0 already equals the answer. The
    // real UI never reaches this because board-input.tsx's handleKeyDown
    // gates every letter key on `!boardIsValid(...)` first.
    const result = applyLetter('X', 'CRANE', ['CRANE', '', '', '', '', ''])
    expect(toRows(result)).toEqual(['CRANE', 'X', '', '', '', ''])
  })
})

describe('applyBackspace', () => {
  test('backspacing an empty board is a no-op', () => {
    expect(applyBackspace(EMPTY)).toEqual(EMPTY)
  })

  test('removes the last letter of the active (last non-empty) row', () => {
    const result = applyBackspace(['CRANE', 'SL', '', '', '', ''])
    expect(toRows(result)).toEqual(['CRANE', 'S', '', '', '', ''])
  })

  test('crosses back into the previous row once the active row is empty', () => {
    // Row 1 is the "active" row by position, but it's empty — there is
    // nothing there to delete, so backspace has to reach back into the last
    // row that actually has content (row 0) rather than no-op.
    const result = applyBackspace(['CRANE', '', '', '', '', ''])
    expect(toRows(result)).toEqual(['CRAN', '', '', '', '', ''])
  })
})
