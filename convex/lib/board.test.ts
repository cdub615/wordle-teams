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

  /**
   * THE GAP RULE (wordle-teams-5w0t), AND IT IS A SCORING RULE. Screenshot import
   * leaves a row the reader could not make out BLANK, in position — so a board
   * can arrive with a hole in it, which v1 had no way to produce because typing
   * fills the rows in order.
   *
   * WHAT MADE IT WORTH REJECTING RATHER THAN TOLERATING: `attemptsFor` counts
   * through `normalizeGuesses`, which DROPS the blank, so every one of these
   * boards scored BETTER than the player played and Submit was enabled with
   * nothing on screen to question it. The scores are asserted alongside the
   * validity below, because the wrong number is the actual harm — a rule that
   * merely rejected these shapes without that context would look like fussiness
   * and get relaxed.
   */
  describe('a gap between the guesses', () => {
    test('rejects a hole in the middle of a solved board, which used to score one too good', () => {
      const gapped = ['SLATE', '', 'CRANE', '', '', '']
      expect(boardIsValid('CRANE', gapped, false)).toBe(false)
      // The player took three guesses. This is what would have been written.
      expect(attemptsFor(gapped, 'CRANE')).toBe(2)
    })

    test('rejects a six-guess failure with rows unread, which used to score as a WIN', () => {
      const gapped = ['CRANE', '', 'SLATE', '', '', 'TRAIN']
      expect(boardIsValid('PIVOT', gapped, false)).toBe(false)
      // Six guesses, none of them the answer, is a FAILED board — 7. Three rows
      // went unread, so the filter counted three guesses and called it a win in
      // three.
      expect(attemptsFor(gapped, 'PIVOT')).toBe(3)
    })

    test('rejects a hole even when the last row is full', () => {
      // The `rows[5].length === 5` half of the final condition, so this cannot
      // be dismissed as the solved-board case alone.
      expect(boardIsValid('PIVOT', ['CRANE', '', 'SLATE', 'BLOND', 'GHOST', 'MUSIC'], false)).toBe(
        false,
      )
    })

    test('rejects a leading gap, which this rule now owns on its own', () => {
      // wordle-teams-x7ds's board. It was already rejected before this rule by
      // `rows[0].length === 5`, and the gap rule subsumes that clause entirely —
      // verified exhaustively, see the note in board.ts. So this asserts the
      // behaviour, NOT that both rules are needed: deleting the first-row check
      // leaves the suite green, which is the honest state of it.
      expect(boardIsValid('CRANE', ['', '', 'CRANE', '', '', ''], false)).toBe(false)
    })

    test('TRAILING blanks are not a gap, which is every ordinary board', () => {
      // The rule has to be "no blank BEFORE a guess", not "no blank": a board
      // solved in two has four empty rows under it and is the common case.
      expect(boardIsValid('CRANE', ['SLATE', 'CRANE', '', '', '', ''], false)).toBe(true)
      expect(boardIsValid('CRANE', ['CRANE', '', '', '', '', ''], false)).toBe(true)
    })

    test("and v1's seventh-row sentinel is not a gap either", () => {
      // v1's upsertBoard appended a '' to a failed six-guess board. `toRows`
      // truncates to six, so the sentinel never reaches the gap check — but if
      // it ever did, it would read as a blank after six played rows, which is
      // trailing.
      const missed = ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST', 'MUSIC', '']
      expect(boardIsValid('SPEED', missed, false)).toBe(true)
    })
  })
})
