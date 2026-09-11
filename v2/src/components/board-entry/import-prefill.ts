import type { BoardParse } from '#/lib/board-import/parse.ts'

/**
 * Stage 5, the pure half: what a parse puts into the form, and what the player
 * changed afterwards.
 *
 * NOTHING HERE WRITES ANYTHING. The parse fills the existing entry form in and
 * stops; the player confirms it with the same Submit they have always used.
 * That is the whole safety argument for the feature — the spec's shipping bar
 * is "knows when it failed", not "never wrong", and it is only affordable
 * because a wrong parse costs a correction rather than a bad row in the table.
 *
 * THE CORRECTION LOG IS THE LABELLED CORPUS, and that is worth understanding
 * rather than filing under analytics. The epic asks for a labelled corpus of
 * real screenshots, which cannot be collected from seventy players of whom ten
 * are most of the activity. Logging every (tile, read, actual) BUILDS one out
 * of ordinary use — and it only starts accruing once the UI ships, which is the
 * argument for shipping rather than stopping at a proven parse core.
 */

/** The form's own shape: six rows, blank where nothing is known. */
export const EMPTY_ROWS: ReadonlyArray<string> = ['', '', '', '', '', '']

export type Prefill = {
  readonly answer: string
  readonly guesses: Array<string>
  /** Rows the parse could not read, so the UI can say which ones to type. */
  readonly missingRows: ReadonlyArray<number>
}

/**
 * The parse as form state.
 *
 * A ROW THE PARSE COULD NOT READ IS LEFT BLANK, not filled with its best guess
 * at the letters. The entry form's board is positional — row 3 is the third
 * guess — so a half-read row put in the wrong place is worse than an empty one,
 * and `unresolved[].letters` is explicitly the reader's first choice rather
 * than an answer. It is reported through `missingRows` so the UI can point at
 * the rows that still need typing.
 */
export function prefillFrom(parse: BoardParse): Prefill {
  const guesses = [...EMPTY_ROWS]
  for (const guess of parse.guesses) {
    if (guess.row >= 0 && guess.row < guesses.length) guesses[guess.row] = guess.word
  }

  return {
    answer: parse.answer ?? '',
    guesses,
    missingRows: parse.unresolved.map((row) => row.row).filter((row) => row >= 0 && row < guesses.length),
  }
}

/** One tile the parse got wrong, as the log records it. */
export type Correction = {
  readonly target: 'guess' | 'answer'
  readonly row: number
  readonly column: number
  /** What the parser read. Empty when it read nothing at all for that tile. */
  readonly read: string
  /** What the player says is actually there. Empty when they cleared it. */
  readonly actual: string
}

/**
 * Every tile where what the player submitted differs from what was parsed.
 *
 * PER TILE, NOT PER ROW, because a row is a near miss far more often than it is
 * wrong: FLUNX for FLUNK is one bad glyph, and a row-level log would record it
 * as "one whole row wrong" and lose which letter it was — the only part Stage 3
 * could ever learn from.
 *
 * A ROW THE PARSE NEVER READ IS NOT A CORRECTION. The player typing a guess
 * into a blank row is them doing the work, not the parser being wrong about
 * anything, and counting it would make the log say Stage 3 misread tiles it
 * never saw.
 */
export function correctionsFrom(
  parse: BoardParse,
  submitted: { readonly answer: string; readonly guesses: ReadonlyArray<string> },
): Array<Correction> {
  const corrections: Array<Correction> = []

  for (const guess of parse.guesses) {
    const actualRow = submitted.guesses[guess.row] ?? ''
    for (let column = 0; column < guess.word.length; column++) {
      const read = guess.word[column] ?? ''
      const actual = (actualRow[column] ?? '').toUpperCase()
      if (read === actual) continue
      corrections.push({ target: 'guess', row: guess.row, column, read, actual })
    }
  }

  const readAnswer = parse.answer ?? ''
  const actualAnswer = submitted.answer.toUpperCase()
  if (readAnswer !== '' && readAnswer !== actualAnswer) {
    for (let column = 0; column < readAnswer.length; column++) {
      const read = readAnswer[column] ?? ''
      const actual = actualAnswer[column] ?? ''
      if (read === actual) continue
      corrections.push({ target: 'answer', row: 0, column, read, actual })
    }
  }

  return corrections
}

/** Plain English for what came back, for the one line the UI shows. */
export function importSummary(parse: BoardParse): string {
  switch (parse.outcome) {
    case 'ok':
      return parse.guesses.length === 1 ? 'Read 1 guess. Check it and submit.' : `Read ${parse.guesses.length} guesses. Check them and submit.`
    case 'partial':
      return `Read ${parse.guesses.length} of ${parse.guesses.length + parse.unresolved.length} guesses. Fill in the rest and submit.`
    case 'share-card':
      return 'That looks like the shared emoji grid, which has no letters on it. Paste a screenshot of the board itself.'
    case 'nothing-played':
      return 'That board has no guesses on it yet.'
    case 'no-board':
      return 'No Wordle board found in that image.'
    case 'unreadable-colours':
      return 'Could not make sense of the colours on that board.'
    case 'no-consistent-word':
      return 'Found the board but could not read any of the guesses. Type them in below.'
  }
}
