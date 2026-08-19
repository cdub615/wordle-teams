import { describe, expect, test } from 'vitest'
import { attemptsFor, boardIsValid, normalizeGuesses, toRows } from './board'

describe('toRows', () => {
  test('pads to six rows without mutating the input', () => {
    const guesses = ['CRANE']
    expect(toRows(guesses)).toEqual(['CRANE', '', '', '', '', ''])
    expect(guesses).toEqual(['CRANE'])
  })
})

describe('attemptsFor', () => {
  test('counts the guesses it took', () => {
    expect(attemptsFor(['CRANE', 'SPEED'], 'SPEED')).toBe(3 - 1)
  })

  test('returns 7 when six guesses did not reach the answer', () => {
    const missed = ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC']
    expect(attemptsFor(missed, 'SPEED')).toBe(7)
  })

  test('tolerates the trailing empty guess copied rows carry', () => {
    // v1's upsertBoard appends a '' sentinel to a failed six-guess board, so
    // copied rows can hold seven entries. DailyScore's constructor filtered it
    // on read; we filter it here. v2 writes no sentinel of its own.
    const missed = ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC', '']
    expect(attemptsFor(missed, 'SPEED')).toBe(7)
  })

  test('an empty board is zero attempts', () => {
    expect(attemptsFor(['', '', '', '', '', ''], 'SPEED')).toBe(0)
  })
})

describe('normalizeGuesses', () => {
  test('drops empty rows', () => {
    expect(normalizeGuesses(['CRANE', '', 'SPEED', ''])).toEqual(['CRANE', 'SPEED'])
  })
})

describe('boardIsValid', () => {
  const solved = ['CRANE', 'SPEED', '', '', '', '']

  test('accepts a solved board whose last guess is the answer', () => {
    expect(boardIsValid('SPEED', solved, false)).toBe(true)
  })

  test('rejects a board whose last guess is not the answer', () => {
    expect(boardIsValid('SPEED', ['CRANE', 'SLATE', '', '', '', ''], false)).toBe(false)
  })

  test('accepts a full six-row board even though it never reached the answer', () => {
    const missed = ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC']
    expect(boardIsValid('SPEED', missed, false)).toBe(true)
  })

  test('rejects a partial guess', () => {
    expect(boardIsValid('SPEED', ['CRA', '', '', '', '', ''], false)).toBe(false)
  })

  test('rejects a short answer', () => {
    expect(boardIsValid('SPE', solved, false)).toBe(false)
  })

  test('rejects a board with no guesses at all', () => {
    expect(boardIsValid('SPEED', ['', '', '', '', '', ''], false)).toBe(false)
  })

  test('an empty board is the delete case, valid only when a score exists', () => {
    const blank = ['', '', '', '', '', '']
    expect(boardIsValid('', blank, true)).toBe(true)
    expect(boardIsValid('', blank, false)).toBe(false)
  })
})
