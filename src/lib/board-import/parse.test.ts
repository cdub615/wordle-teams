import { describe, expect, it } from 'vitest'
import { createBitmap, fillRect } from './bitmap.ts'
import { feedbackFor } from './feedback.ts'
import { parseBoard, resolveWithAnswer } from './parse.ts'
import type { BoardParse } from './parse.ts'
import { renderPlayedBoard } from './testing/board-fixture.ts'
import { renderBoard } from './testing/render.ts'
import type { ThemeName } from './testing/render.ts'
import { acceptedGuesses } from './wordlist.ts'

const WORDS = acceptedGuesses()
const THEMES: Array<ThemeName> = ['light', 'dark', 'high-contrast']

/** mulberry32, so a failing case is reproducible from its seed alone. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('parseBoard round trip', () => {
  // THE PROPERTY: a board rendered from real words comes back as those words.
  //
  // The letters are painted from the template table, so this says NOTHING about
  // whether Stage 3 can read NYT's typeface — that is measured on the real
  // corpus and nowhere else. What it does pin is every joint between the
  // pixels and the words: that the lattice lands on the right tiles, that
  // colour and glyph agree which tile is which, that both present/correct
  // mappings are tried, that the answer is derived where it can be, and that
  // the guesses come back in the order they were played.
  it('recovers random guesses against random answers', () => {
    const next = random(20260910)
    const pick = () => WORDS[Math.floor(next() * WORDS.length)]

    for (let iteration = 0; iteration < 30; iteration++) {
      const answer = pick()
      const guessCount = 1 + Math.floor(next() * 5)
      const guesses = Array.from({ length: guessCount }, pick)
      const theme = THEMES[iteration % THEMES.length]
      const tileSize = [40, 62, 96][iteration % 3]

      const board = renderPlayedBoard({ answer, guesses, theme, tileSize })
      const parsed = parseBoard(board.bitmap, { answer })
      const where = `iteration ${iteration}: ${answer} / ${guesses.join(' ')} / ${theme} @ ${tileSize}`

      expect(parsed.outcome, where).toBe('ok')
      expect(parsed.guesses.map((guess) => guess.word), where).toEqual(guesses)
      expect(parsed.answer, where).toBe(answer)
      expect(parsed.guesses.map((guess) => guess.marks), where).toEqual(
        guesses.map((guess) => feedbackFor(guess, answer)),
      )
    }
    // Thirty boards, each resolved against ~13,000 accepted guesses under both
    // colour mappings. That is the cost of the property being worth having, and
    // it runs past the default five seconds when the whole suite is in flight.
  }, 30_000)

  // WITHOUT A SUPPLIED ANSWER the winning row has to supply it, which is the
  // circular case resolveBoard breaks with two passes.
  it('derives the answer from a solved board when it is not told one', () => {
    const answer = 'CRANE'
    const board = renderPlayedBoard({ answer, guesses: ['SLATE', 'CRANE'], tileSize: 62 })
    const parsed = parseBoard(board.bitmap)

    expect(parsed.outcome).toBe('ok')
    expect(parsed.answer).toBe('CRANE')
    expect(parsed.guesses.map((guess) => guess.word)).toEqual(['SLATE', 'CRANE'])
  })

  // THE MAPPING STAGE 2 COULD NOT SETTLE. Present and correct are told apart
  // only by which one colours a real word against the answer.
  it('picks the present/correct mapping the words agree with', () => {
    // No winning row, so Stage 2's own hint is unavailable and only the
    // constraint can decide.
    const answer = 'CRANE'
    const board = renderPlayedBoard({ answer, guesses: ['SLATE', 'TRACE'], tileSize: 62 })
    const parsed = parseBoard(board.bitmap, { answer })

    expect(parsed.outcome).toBe('ok')
    expect(parsed.guesses.map((guess) => guess.marks)).toEqual([
      feedbackFor('SLATE', answer),
      feedbackFor('TRACE', answer),
    ])
  })

  // A SEVERED COLUMN IS A REAL LIMIT AND THIS TEST STATES IT RATHER THAN
  // PRETENDING OTHERWISE. Half a letter is half a letter: the lattice recovers
  // the column (Task 2's job, and it does), the colours are read, and the word
  // list plus the answer narrow the row to the handful of accepted guesses that
  // fit — but where two of those differ only in the severed position, nothing
  // in the image can choose between them. SLATE and BLATE coloured against
  // CRANE are identical.
  //
  // Which is exactly the case confirm-before-save exists for. The board comes
  // back whole and plausible with one letter to correct, not as a failure.
  it('recovers a board severed through its outer columns, bar the severed letter', () => {
    const answer = 'CRANE'
    const guesses = ['SLATE', 'CRANE']
    const whole = renderPlayedBoard({ answer, guesses, tileSize: 62, gap: 5 })
    const crop = {
      x: whole.tiles[0][0].x + 31,
      y: whole.tiles[0][0].y - 10,
      width: whole.tiles[0][4].x + 31 - (whole.tiles[0][0].x + 31),
      height: whole.tiles[5][0].y + 62 + 10 - (whole.tiles[0][0].y - 10),
    }
    const board = renderPlayedBoard({ answer, guesses, tileSize: 62, gap: 5, crop })
    const parsed = parseBoard(board.bitmap, { answer })

    expect(parsed.outcome).toBe('ok')
    expect(parsed.guesses).toHaveLength(2)
    // The intact interior, and the row whose severed letters were recoverable.
    expect(parsed.guesses[0].word.slice(1)).toBe('LATE')
    expect(parsed.guesses[1].word).toBe('CRANE')
    // Whatever it chose for the severed column, it is a real accepted guess
    // that colours exactly as the screenshot shows — never a fabrication.
    expect(acceptedGuesses()).toContain(parsed.guesses[0].word)
    expect(parsed.guesses[0].marks).toEqual(feedbackFor(parsed.guesses[0].word, answer))
  })

  it('is unbothered by a status bar and by noise', () => {
    const answer = 'PLANK'
    const guesses = ['SHAME', 'PLANK']
    const board = renderPlayedBoard({
      answer,
      guesses,
      theme: 'dark',
      tileSize: 62,
      statusBar: { height: 44 },
      noise: 5,
      seed: 9,
    })
    expect(parseBoard(board.bitmap, { answer }).guesses.map((guess) => guess.word)).toEqual(guesses)
  })
})

describe('parseBoard failure paths', () => {
  // A SHARE CARD IS A REAL INPUT AND DESERVES ITS OWN ANSWER. Telling the user
  // "that is the emoji grid, paste the board" is a different message from "we
  // could not read your screenshot", and only this can tell them apart.
  it('names a share card specifically rather than failing generically', () => {
    const board = renderPlayedBoard({
      answer: 'CRANE',
      guesses: ['SLATE', 'CRANE'],
      tileSize: 62,
      withoutLetters: true,
    })
    const parsed = parseBoard(board.bitmap)

    expect(parsed.outcome).toBe('share-card')
    // It still found the board, and says so.
    expect(parsed.lattice?.columns).toBe(5)
    expect(parsed.lattice?.rows).toBe(6)
  })

  it('says there is no board rather than inventing one', () => {
    const blank = createBitmap(400, 400, [255, 255, 255])
    expect(parseBoard(blank)).toMatchObject({ outcome: 'no-board', lattice: null, guesses: [] })
  })

  it('says an untouched board is untouched', () => {
    const board = renderBoard({ tileSize: 62 })
    expect(parseBoard(board.bitmap).outcome).toBe('nothing-played')
  })

  // NOTHING HERE MAY RETURN NOTHING. Four rows the user does not have to type
  // is worth four rows, even when the fifth defeated it.
  it('returns the rows it could read when one row defeats it', () => {
    const answer = 'CRANE'
    const guesses = ['SLATE', 'CRANE']
    const board = renderPlayedBoard({ answer, guesses, tileSize: 62 })

    // Obliterate the first row's letters, leaving its colours intact. No word
    // can satisfy them, so the board as a whole cannot resolve.
    for (let column = 0; column < 5; column++) {
      const tile = board.tiles[0][column]
      fillRect(board.bitmap, tile, [90, 90, 90])
    }

    const parsed = parseBoard(board.bitmap, { answer })
    expect(parsed.outcome).toBe('partial')
    expect(parsed.guesses.map((guess) => guess.word)).toEqual(['CRANE'])
    expect(parsed.unresolved.map((row) => row.row)).toEqual([0])
    expect(parsed.lattice).not.toBeNull()
    // And it still knows the answer, which is most of what the form needs.
    expect(parsed.answer).toBe('CRANE')
  })

  it('reports the letters it read for a row it could not resolve', () => {
    const answer = 'CRANE'
    const board = renderPlayedBoard({ answer, guesses: ['SLATE', 'CRANE'], tileSize: 62 })
    const parsed = parseBoard(board.bitmap, { answer, words: ['CRANE'] })

    expect(parsed.outcome).toBe('partial')
    const failed = parsed.unresolved.find((row) => row.row === 0)
    expect(failed?.letters).toBe('SLATE')
    expect(failed?.marks).toEqual(feedbackFor('SLATE', answer))
  })

  it('keeps the row indices, so a gap in the board is visible', () => {
    const answer = 'CRANE'
    const board = renderPlayedBoard({ answer, guesses: ['SLATE', 'TRACE', 'CRANE'], tileSize: 62 })
    const parsed = parseBoard(board.bitmap, { answer })
    expect(parsed.guesses.map((guess) => guess.row)).toEqual([0, 1, 2])
  })
})

describe('resolveWithAnswer', () => {
  /** A board with no winning row, so no answer can be derived from it. */
  const unsolved = () =>
    renderPlayedBoard({ answer: 'DRYLY', guesses: ['SLATE', 'BROIL', 'WRYLY'], tileSize: 62 })

  // WHY THERE IS NO SECOND PARSE. Nothing about the image is read differently
  // when the answer is known — lattice, colours and glyphs are all
  // answer-independent — so only Stage 4's last step can change. This asserts
  // the consequence: re-resolving the evidence gives the same board as parsing
  // the pixels again with the answer supplied from the start.
  //
  // ON ITS OWN THIS DOES NOT SHOW THE CONSTRAINT DOING ANY WORK, and it cannot:
  // the letters here are painted from the template table, so the reader is
  // never torn and the answer never has a tie to break. Measured — blind and
  // told agree on every synthesised board tried, smudged ones included. The
  // test below constructs the torn evidence directly, which is the only honest
  // way to show it.
  it('reaches exactly what a fresh parse with the answer would have', () => {
    const board = unsolved()
    const blind = parseBoard(board.bitmap)
    const told = parseBoard(board.bitmap, { answer: 'DRYLY' })
    const reresolved = resolveWithAnswer(blind, 'DRYLY')

    expect(reresolved.guesses.map((guess) => guess.word)).toEqual(told.guesses.map((guess) => guess.word))
    expect(reresolved.answer).toBe(told.answer)
    expect(reresolved.outcome).toBe(told.outcome)
  })

  it('carries the evidence forward, so it can be re-resolved again', () => {
    const blind = parseBoard(unsolved().bitmap)
    expect(blind.evidence).not.toBeNull()
    expect(resolveWithAnswer(blind, 'DRYLY').evidence).toBe(blind.evidence)
  })

  // A SOLVED BOARD NEEDS NONE OF THIS. The winning row IS the answer, so the
  // first parse already derived it and used it on every row — which is why the
  // form never asks for one.
  it('has nothing to add to a board that was already solved', () => {
    const solved = renderPlayedBoard({ answer: 'CRANE', guesses: ['SLATE', 'CRANE'], tileSize: 62 })
    const blind = parseBoard(solved.bitmap)

    expect(blind.answer).toBe('CRANE')
    expect(resolveWithAnswer(blind, 'CRANE').guesses.map((g) => g.word)).toEqual(
      blind.guesses.map((g) => g.word),
    )
  })

  it('is a no-op on a parse that never found a board to gather evidence from', () => {
    const blank = parseBoard(createBitmap(400, 400, [255, 255, 255]))
    expect(blank.evidence).toBeNull()
    expect(resolveWithAnswer(blank, 'CRANE')).toBe(blank)
  })

  // It cannot rescue everything, and the test says so rather than pretending.
  // Two words that colour identically against the answer are indistinguishable
  // to every constraint Stage 4 has.
  it('cannot separate two words the answer colours identically', () => {
    expect(feedbackFor('SLATE', 'DRYLY')).toEqual(feedbackFor('BLATE', 'DRYLY'))
  })
})

/**
 * THE CONSTRAINT ITSELF, on evidence built by hand.
 *
 * It has to be built by hand. Glyphs painted from the template table are read
 * perfectly, so a rendered board never puts the reader in the position this
 * exists for — being torn between two letters that the ANSWER can separate.
 * The real corpus does: one screenshot read DRYLY where the board said WRYLY,
 * and that is the case reproduced here.
 */
describe('what knowing the answer is actually for', () => {
  /** A reader that slightly prefers D, on a row whose colours say otherwise. */
  const torn = (): BoardParse => ({
    outcome: 'ok',
    answer: null,
    guesses: [],
    unresolved: [],
    lattice: null,
    evidence: {
      rows: [0],
      letters: [[{ D: 0.55, W: 0.45 }, { R: 1 }, { Y: 1 }, { L: 1 }, { Y: 1 }]],
      readings: [[['absent', 'correct', 'correct', 'correct', 'correct']]],
      unreadable: [],
    },
  })

  it('overrules the reader when the colours forbid its first choice', () => {
    const told = resolveWithAnswer(torn(), 'DRYLY')

    // DRYLY against DRYLY colours CCCCC, which is not the .CCCC on the board —
    // so the reader's own first choice is inadmissible, and WRYLY wins despite
    // scoring lower. This is the whole reason the answer is worth asking for.
    expect(told.guesses.map((guess) => guess.word)).toEqual(['WRYLY'])
    expect(feedbackFor('WRYLY', 'DRYLY')).toEqual(['absent', 'correct', 'correct', 'correct', 'correct'])
    expect(feedbackFor('DRYLY', 'DRYLY')).not.toEqual(feedbackFor('WRYLY', 'DRYLY'))
  })

  it('keeps the reader when nothing forbids it', () => {
    // SLATE and BLATE colour identically against DRYLY — both all-absent — so
    // no answer can separate them and the reader is left to decide. The limit
    // is stated rather than papered over.
    expect(feedbackFor('SLATE', 'DRYLY')).toEqual(feedbackFor('BLATE', 'DRYLY'))
  })
})
