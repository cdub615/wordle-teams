import { cn } from '#/lib/utils.ts'
import { tileStates, type TileState } from '#/lib/wordle.ts'

/**
 * The signature component, at list scale.
 *
 * DESIGN PRINCIPLE #5 IS "THE BOARD IS THE SIGNATURE", and until now the page
 * about board performance rendered no tiles at all. Square corners, no radius —
 * the sharp corner is the game's visual mark and rounding it is the one thing
 * DESIGN_SYSTEM.md §6 says not to do.
 *
 * aria-hidden BECAUSE A SCREEN READER DOES NOT WANT THIS. Fifteen to thirty
 * tiles read one colour at a time is noise; the score ("3/6") sits beside it as
 * real text and carries the information.
 */
const FILL: Record<TileState, string> = {
  correct: 'bg-wordle-correct',
  present: 'bg-wordle-present',
  absent: 'bg-wordle-absent',
  empty: 'border-wordle-tile-border border bg-transparent',
}

export function MiniBoard({
  guesses,
  answer,
  testId,
}: {
  guesses: Array<string>
  /** Optional on dailyScores, so its absence is ordinary rather than an error. */
  answer?: string
  testId?: string
}) {
  /*
    THE EMPTY-STRING SENTINEL IS REAL DATA, NOT DEFENSIVENESS. v1 appended a ''
    to a failed six-guess board, and those rows were copied into v2. Rendering
    one would draw a row of five blank tiles under a completed board.
  */
  const rows = guesses.filter((guess) => guess.length > 0)

  return (
    <div className="grid w-fit grid-cols-5 gap-[2px]" aria-hidden="true" data-testid={testId}>
      {rows.map((guess, row) =>
        // Without an answer there is nothing to colour against, and inventing a
        // colouring would assert a result. Neutral tiles state nothing.
        (answer ? tileStates(answer, guess) : guess.split('').map(() => 'empty' as TileState)).map(
          (state, column) => (
            <span
              key={`${row}-${column}`}
              className={cn('size-[11px] md:size-[13px]', FILL[state])}
            />
          ),
        ),
      )}
    </div>
  )
}

/**
 * A word in the board's typography, asserting no result.
 *
 * UNCOLOURED ON PURPOSE, and this is the whole point of the component existing
 * separately from MiniBoard. An opener used 41 times has 41 different
 * colourings, so there is no correct one to show. Colouring by, say, hit rate
 * would give green and yellow a second meaning, and in this product they mean
 * exactly one thing. The tiles carry the shape; the numbers beside them carry
 * the result.
 */
export function WordTiles({ word, testId }: { word: string; testId?: string }) {
  return (
    <div className="flex w-fit gap-[2px]" data-testid={testId}>
      {word.split('').map((letter, index) => (
        <span
          key={index}
          className="border-wordle-tile-border text-foreground flex size-[19px] items-center justify-center border text-[11px] font-bold"
        >
          {letter}
        </span>
      ))}
    </div>
  )
}
