import { describe, expect, it } from 'vitest'
import type { BoardParse } from '#/lib/board-import/parse.ts'
import { correctionsFrom, importSummary, prefillFrom } from './import-prefill.ts'

const parse = (over: Partial<BoardParse> = {}): BoardParse => ({
  outcome: 'ok',
  answer: 'CRANE',
  guesses: [
    { row: 0, word: 'SLATE', marks: ['absent', 'absent', 'present', 'absent', 'correct'] },
    { row: 1, word: 'CRANE', marks: ['correct', 'correct', 'correct', 'correct', 'correct'] },
  ],
  unresolved: [],
  lattice: null,
  ...over,
})

describe('prefillFrom', () => {
  it('puts each guess in its own row and leaves the rest blank', () => {
    expect(prefillFrom(parse())).toEqual({
      answer: 'CRANE',
      guesses: ['SLATE', 'CRANE', '', '', '', ''],
      missingRows: [],
    })
  })

  // THE BOARD IS POSITIONAL: row 3 is the third guess. A row the parse could
  // not read must stay where it is and stay empty, or every row below it slides
  // up and the saved board is a different game.
  it('keeps the gap where a row could not be read', () => {
    const partial = parse({
      outcome: 'partial',
      guesses: [{ row: 2, word: 'CRANE', marks: ['correct', 'correct', 'correct', 'correct', 'correct'] }],
      unresolved: [
        { row: 0, marks: null, letters: '.....' },
        { row: 1, marks: null, letters: 'SLXTE' },
      ],
    })
    const prefill = prefillFrom(partial)

    expect(prefill.guesses).toEqual(['', '', 'CRANE', '', '', ''])
    expect(prefill.missingRows).toEqual([0, 1])
  })

  // `unresolved[].letters` is explicitly the reader's FIRST CHOICE, not an
  // answer — a row it could not turn into a real word. Filling the board with
  // it would present a non-word as if it had been read.
  it('does not fill a row with letters that spell nothing', () => {
    const partial = parse({
      outcome: 'partial',
      guesses: [],
      unresolved: [{ row: 0, marks: null, letters: 'SLXTE' }],
    })
    expect(prefillFrom(partial).guesses).toEqual(['', '', '', '', '', ''])
  })

  it('leaves the answer blank when none was derived', () => {
    expect(prefillFrom(parse({ answer: null })).answer).toBe('')
  })
})

describe('correctionsFrom', () => {
  it('finds nothing when the player confirmed the parse unchanged', () => {
    expect(correctionsFrom(parse(), { answer: 'CRANE', guesses: ['SLATE', 'CRANE', '', '', '', ''] })).toEqual([])
  })

  // PER TILE, NOT PER ROW. A wrong row is usually one wrong glyph, and a
  // row-level log would say "one row wrong" and lose the only part Stage 3
  // could ever learn from.
  it('records the one letter that changed, not the whole row', () => {
    const corrections = correctionsFrom(
      parse({
        guesses: [{ row: 0, word: 'FLUNX', marks: ['absent', 'absent', 'absent', 'absent', 'absent'] }],
      }),
      { answer: 'CRANE', guesses: ['FLUNK', '', '', '', '', ''] },
    )
    expect(corrections).toEqual([{ target: 'guess', row: 0, column: 4, read: 'X', actual: 'K' }])
  })

  it('records a corrected answer as well as a corrected board', () => {
    const corrections = correctionsFrom(parse(), {
      answer: 'CRANK',
      guesses: ['SLATE', 'CRANE', '', '', '', ''],
    })
    expect(corrections).toEqual([{ target: 'answer', row: 0, column: 4, read: 'E', actual: 'K' }])
  })

  it('keeps the row index, so a correction points at the tile it was', () => {
    const corrections = correctionsFrom(
      parse({
        guesses: [{ row: 4, word: 'SLATE', marks: ['absent', 'absent', 'absent', 'absent', 'absent'] }],
      }),
      { answer: 'CRANE', guesses: ['', '', '', '', 'SLIME', ''] },
    )
    expect(corrections.map((c) => [c.row, c.column, c.read, c.actual])).toEqual([
      [4, 2, 'A', 'I'],
      [4, 3, 'T', 'M'],
    ])
  })

  // A ROW THE PARSE NEVER READ IS NOT A CORRECTION. The player typing into a
  // blank row is them doing the work, not the parser being wrong — counting it
  // would make the log claim Stage 3 misread tiles it never saw.
  it('does not blame the parser for a row it never claimed', () => {
    const partial = parse({
      outcome: 'partial',
      guesses: [],
      unresolved: [{ row: 0, marks: null, letters: '.....' }],
    })
    expect(correctionsFrom(partial, { answer: 'CRANE', guesses: ['SLATE', '', '', '', '', ''] })).toEqual([])
  })

  it('records a tile the player cleared, because that says the parse invented one', () => {
    const corrections = correctionsFrom(
      parse({ guesses: [{ row: 0, word: 'SLATE', marks: ['absent', 'absent', 'absent', 'absent', 'absent'] }] }),
      { answer: 'CRANE', guesses: ['SLAT', '', '', '', '', ''] },
    )
    expect(corrections).toEqual([{ target: 'guess', row: 0, column: 4, read: 'E', actual: '' }])
  })

  it('is case insensitive about what the player typed', () => {
    expect(
      correctionsFrom(parse(), { answer: 'crane', guesses: ['slate', 'crane', '', '', '', ''] }),
    ).toEqual([])
  })
})

describe('importSummary', () => {
  // A SHARE CARD DESERVES ITS OWN SENTENCE. "Paste the board rather than the
  // emoji grid" is actionable; "we could not read that" is not.
  it('tells a share card apart from an unreadable image', () => {
    expect(importSummary(parse({ outcome: 'share-card' }))).toMatch(/emoji grid/i)
    expect(importSummary(parse({ outcome: 'no-board' }))).toMatch(/no wordle board/i)
  })

  it('counts what it read and what is left', () => {
    expect(importSummary(parse())).toMatch(/2 guesses/)
    expect(
      importSummary(
        parse({
          outcome: 'partial',
          guesses: [{ row: 0, word: 'SLATE', marks: ['absent', 'absent', 'absent', 'absent', 'absent'] }],
          unresolved: [{ row: 1, marks: null, letters: '.....' }],
        }),
      ),
    ).toMatch(/1 of 2/)
  })

  it('says something for every outcome', () => {
    const outcomes: Array<BoardParse['outcome']> = [
      'ok',
      'partial',
      'share-card',
      'nothing-played',
      'no-board',
      'unreadable-colours',
      'no-consistent-word',
    ]
    for (const outcome of outcomes) {
      expect(importSummary(parse({ outcome })).length, outcome).toBeGreaterThan(10)
    }
  })
})
