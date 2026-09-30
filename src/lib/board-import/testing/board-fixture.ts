import { setPixel } from '../bitmap.ts'
import type { Bitmap, Rect, Rgb } from '../bitmap.ts'
import templates from '../data/glyph-templates.json'
import { feedbackFor } from '../feedback.ts'
import type { Mark } from '../types.ts'
import { renderBoard } from './render.ts'
import type { RenderOptions, RenderedBoard, TileSpec } from './render.ts'

/**
 * A whole played board, letters and all — the fixture Task 5's round-trip
 * property test needs.
 *
 * THE LETTERS COME FROM THE TEMPLATE TABLE, WHICH MAKES THIS CIRCULAR, AND
 * THAT IS FINE FOR WHAT IT IS FOR. Painting a template and then matching it
 * measures nothing about whether Stage 3 can read NYT's typeface — the plan
 * draws that line explicitly and Stage 3's accuracy is measured on the real
 * corpus by scripts/validate-board-import.mjs, never here.
 *
 * What a round trip through this DOES pin is everything between the pixels and
 * the words: that the lattice lands on the right tiles, that colour and glyph
 * agree about which tile is which, that both present/correct mappings are
 * tried, that the answer is derived where it can be, and that the words come
 * back in the order they were played. All of that is orchestration, all of it
 * has broken before in ways a per-stage test would not catch, and none of it
 * depends on the typeface.
 *
 * This is deliberately NOT in render.ts. That module renders geometry and
 * colour with no font and no data file, and keeping it that way is what lets it
 * be the ground truth for Stages 1 and 2.
 */

type TemplateFile = {
  readonly width: number
  readonly height: number
  readonly letters: Readonly<Record<string, ReadonlyArray<ReadonlyArray<number>>>>
}

const DATA = templates as unknown as TemplateFile

/** White on every mark, as Wordle draws it. */
const INK: Rgb = [255, 255, 255]

/**
 * Fraction of the tile's height a capital fills, MEASURED ON THE REAL CORPUS:
 * a 184px tile carries a 59px cap, and a 163px one a 59px cap.
 *
 * Not a cosmetic choice. Set too large, the letter fills so much of the tile
 * that the tile's own MEDIAN colour becomes the letter — Stage 2 then reads the
 * ink instead of the fill and reports the row unreadable. An early value of
 * 0.58 here did exactly that to any row containing an M, which made the fixture
 * a harder input than a real screenshot rather than a fair one.
 */
const CAP_HEIGHT = 0.36

export type PlayedBoardOptions = Omit<RenderOptions, 'rows'> & {
  /** The word each row holds, top to bottom. */
  readonly guesses: ReadonlyArray<string>
  /** The day's answer. Required: it is what turns guesses into colours. */
  readonly answer: string
  /** Rows drawn after the guesses. Six total is what the game shows. */
  readonly totalRows?: number
  /** Skip the letters to produce a SHARE CARD: the colours with no text. */
  readonly withoutLetters?: boolean
}

export type PlayedBoard = RenderedBoard & {
  readonly guesses: ReadonlyArray<string>
  readonly answer: string
  readonly marks: ReadonlyArray<ReadonlyArray<Mark>>
}

export function renderPlayedBoard(options: PlayedBoardOptions): PlayedBoard {
  const { guesses, answer, totalRows = 6, withoutLetters = false, ...render } = options
  const marks = guesses.map((guess) => feedbackFor(guess, answer))
  const empty: Array<TileSpec> = Array.from({ length: answer.length }, () => null)
  const rows: Array<Array<TileSpec>> = [
    ...marks.map((row) => [...row] as Array<TileSpec>),
    ...Array.from({ length: Math.max(0, totalRows - guesses.length) }, () => [...empty]),
  ]

  const board = renderBoard({ ...render, rows })
  if (!withoutLetters) {
    guesses.forEach((guess, row) => {
      guess.toUpperCase().split('').forEach((letter, column) => {
        paintLetter(board.bitmap, board.tiles[row][column], letter)
      })
    })
  }

  return { ...board, guesses, answer: answer.toUpperCase(), marks }
}

/** Scales a template into a tile the way text sits in one, and paints it. */
export function paintLetter(bitmap: Bitmap, tile: Rect, letter: string, variant = 0): void {
  const cells = DATA.letters[letter.toUpperCase()]?.[variant]
  if (cells === undefined) return

  const height = tile.height * CAP_HEIGHT
  const width = height * (DATA.width / DATA.height)
  const left = tile.x + (tile.width - width) / 2
  const top = tile.y + (tile.height - height) / 2

  for (let y = 0; y < Math.round(height); y++) {
    for (let x = 0; x < Math.round(width); x++) {
      const sx = Math.min(DATA.width - 1, Math.floor((x / width) * DATA.width))
      const sy = Math.min(DATA.height - 1, Math.floor((y / height) * DATA.height))
      if (cells[sy * DATA.width + sx] > 128) setPixel(bitmap, Math.round(left + x), Math.round(top + y), INK)
    }
  }
}
