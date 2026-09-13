import { cn } from '#/lib/utils.ts'
import { type TileState, tileStates, toRows } from '#/lib/wordle.ts'

/**
 * The Wordle board. Presentational only — given guesses and an answer, it
 * renders. Entry interaction (keyboard, the mobile viewport-aware sheet,
 * submit handling) is Phase 2 and deliberately lives elsewhere.
 *
 * DESIGN_SYSTEM.md section 6: 5 columns, 6 rows, gap-1, w-72 on mobile and
 * w-80 (320px) from md. Letters uppercase at text-3xl md:text-4xl.
 */

/**
 * TILES ARE SQUARE. radius 0, no rounded-* class anywhere in this file. The
 * doc says so twice — "Don't round them", "the sharp corner is the game's
 * visual signature" — and it is the one component the radius vocabulary in
 * section 4 does not apply to.
 */
const tileClass: Record<TileState, string> = {
  // Foreground travels with the background (styles.css rule 2) rather than
  // inheriting as v1 does. v1's present tile inherits the page foreground,
  // which in DARK mode is near-white on #eab308 — 1.84:1, below even the 3:1
  // large-text floor. Pairing it with --warning-foreground takes it to 9.83:1.
  correct: 'bg-wordle-correct text-success-foreground',
  present: 'bg-wordle-present text-warning-foreground',
  absent: 'bg-wordle-absent text-foreground',
  empty: 'border-wordle-tile-border',
}

export type WordleBoardProps = {
  guesses: Array<string>
  answer: string
  /** The team's showLetters setting. When false, letters are hidden from others. */
  showLetters?: boolean
  /** True on the entry view, where you always see your own letters. */
  boardEntry?: boolean
  className?: string
}

/**
 * THE TILE'S SIZE STEP, AND WHY THE ENTRY BOARD HAS ITS OWN (wordle-teams-wty4.1.5).
 *
 * THE DISPLAY BOARD IS THE DESIGN SYSTEM'S: h-14, stepping to h-16 from `md`,
 * exactly as section 6 specifies. It renders in team-boards.tsx, which is not
 * height-constrained and has no reason to shrink.
 *
 * THE ENTRY BOARD STEPS UP ONLY WHEN THERE IS VERTICAL ROOM, because it renders
 * inside a Dialog capped at `100dvh` minus its insets. MEASURED: six rows at
 * 64px plus the dialog's own chrome — padding, header, the day/answer row, the
 * submit — comes to roughly 700px, so every browser window shorter than that
 * scrolled, and it was DialogContent's own overflow doing it rather than
 * anything in the form. Dropping the tile to 56px on a short viewport gives
 * back 48px, which with the trimmed chrome is the difference between fitting a
 * 1366x768 laptop and not.
 *
 * A COMBINED WIDTH-AND-HEIGHT QUERY, not `md:` plus something: the step-up
 * needs BOTH. `md` alone is what put a 64px tile on a wide-but-short window,
 * which is the bug. 44rem (704px) is chosen with headroom over the ~672px the
 * tall layout actually needs, so a board that steps up always has room.
 *
 * THE TEXT SIZE TRAVELS WITH IT. A text-4xl glyph in a 56px tile is not
 * clipped, but it is tight enough to look like a mistake; the two belong to one
 * decision and must not be separated.
 */
const TILE_SIZE_DISPLAY = 'h-14 text-3xl md:h-16 md:text-4xl'
const TILE_SIZE_ENTRY =
  'h-14 text-3xl [@media(min-width:48rem)_and_(min-height:44rem)]:h-16 [@media(min-width:48rem)_and_(min-height:44rem)]:text-4xl'

export function WordleBoard({
  guesses,
  answer,
  showLetters = true,
  boardEntry = false,
  className,
}: WordleBoardProps) {
  const rows = toRows(guesses)
  // v1: a hidden board still renders its colours, just not its letters, so you
  // can see how someone did without being told the word.
  const reveal = showLetters || boardEntry

  return (
    <div className={cn('pt-1', className)} data-slot="wordle-board">
      {rows.map((guess, row) => (
        <div key={row} className="flex justify-center">
          <div className="mb-1 grid w-72 grid-cols-5 gap-1 md:w-80">
            {tileStates(answer, guess).map((state, col) => (
              <div
                key={col}
                id={`${row + 1}-${col + 1}`}
                data-state={state}
                className={cn(
                  'flex items-center justify-center border uppercase caret-transparent',
                  boardEntry ? TILE_SIZE_ENTRY : TILE_SIZE_DISPLAY,
                  tileClass[state],
                )}
              >
                {reveal ? (guess[col] ?? '') : ''}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default WordleBoard
