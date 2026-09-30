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
  /**
   * WHERE THE NEXT LETTER LANDS, as zero-based row and column.
   *
   * DERIVED FROM `cursorFor` (board-entry/entry-cursor.ts) BUT NOT ITS RETURN TYPE.
   * `cursorFor` is the SINGLE definition of "where does the next letter go",
   * shared with the answer slots so the two renderings cannot disagree — do not
   * re-derive the position here, because a previous version of this feature
   * computed it a second way and the two diverged on import-prefilled boards,
   * which shipped (wordle-teams-lz3w). ADAPT it, in one expression:
   *
   *   cursor={c?.zone === 'board' ? { row: c.row, col: c.index } : null}
   *
   * The board variant is `{ zone: 'board'; row: number; index: number }`, so a
   * caller must discriminate on `zone` AND rename `index` to `col`. TypeScript
   * rejects the naive spelling because the field names differ, which is the only
   * reason that rename is safe to state in a comment rather than to enforce.
   *
   * NULL IN THREE CASES, AND THE THIRD IS THE ONE THAT SURPRISES: a solved board,
   * six full rows, AND `zone === 'answer'` — where `cursorFor` returns a NON-null
   * cursor whose caret belongs to answer-slots.tsx, not here. A non-null result
   * from `cursorFor` does NOT mean "mark a tile"; only its board variant does.
   * Two carets on screen at once is the failure this sentence exists to prevent.
   *
   * OPTIONAL, AND ABSENT ON THE DISPLAY BOARD. team-boards.tsx renders a
   * teammate's finished game, which is not an input and must never grow a caret.
   * Null is the same as absent. `boardEntry` gates the mark as well, so passing
   * this to a display board is inert rather than merely discouraged.
   */
  cursor?: { row: number; col: number } | null
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

/**
 * THE CURSOR'S MARK: A RING OUTSIDE THE TILE, NOT A REPLACEMENT BORDER.
 *
 * `border-*` IS SPENT ALREADY AND SPENT ON SOMETHING ELSE. The tile's border
 * colour encodes its own RESULT — correct / present / absent / empty, see
 * tileClass — so recolouring it to say "you are here" would make the active tile
 * read as a different score. A Tailwind `ring` is a non-inset box-shadow: it draws
 * OUTSIDE the border box, leaving every state colour intact underneath.
 *
 * `ring-2 ring-ring` AND `z-10`, WHICH IS THE CURSOR SLOT IN `AnswerSlots`
 * (board-entry/answer-slots.tsx) BYTE FOR BYTE. The
 * two sit in the same dialog marking the same cursor as it hands itself from one
 * to the other; a differently-styled mark either side of the hand-off would read
 * as two different things happening. `--ring` is the accent (styles.css) and is
 * defined in both themes.
 *
 * NO `ring-offset-*`, AND THE GRID'S GAP IS WHY. MEASURED in headless Chromium
 * against the BUILT stylesheet, at a 360px viewport, inside the real nesting
 * (SheetContent `p-6` > form.tsx's `min-h-0 flex-1 overflow-y-auto` > board-input's
 * `mx-auto w-fit`), `boardEntry`, tiles 54.39-54.41 x 56px with `gap-1` (4px —
 * the columns alternate 54.391/54.406 on Chromium's 1/64px rounding):
 *
 *                       outward reach   gap to neighbour   slack at col 4
 *   ring-2                      2.0px              2.0px          10.0px
 *   ring-2 ring-offset-2        4.0px              0.0px           8.0px
 *
 * `ring-offset-2` puts the ring's outer edge FLUSH against the next tile's border
 * — 0.0px between them — so the mark and the neighbour fuse into one thick divider,
 * the same failure mode as the answer caret that landed inside the 'W'. Plain
 * `ring-2` keeps 2.0px of background either side, which is what reads as a ring.
 * The box-shadow it computes to is `rgb(21,128,61) 0px 0px 0px 2px`, NOT inset, so
 * it is genuinely outside the border box rather than painted over it.
 *
 * NOT CLIPPED IN THE LAST COLUMN, and that was the open question: the board sits
 * inside form.tsx's `overflow-y-auto`, which computes `overflow-x` to `auto` too
 * (wordle-teams-rpql clipped board-input's own ring on exactly this), so a ring on
 * a col-4 tile draws outside the grid's content box. It survives because the grid
 * (w-72, 288px) is narrower than that scroll container's 312px content box and is
 * CENTRED in it: the clip box measures [24, 336] against a ring outer edge at 326,
 * so 10.0px of slack against the 2.0px needed, and scrollWidth - clientWidth is
 * 0.0px — nothing overflows at all.
 *
 * VERTICALLY THE SAME 2.0px, AND THAT IS WHAT CHECKS THE CLAIM BELOW. Rows are
 * separated by `mb-1`, also 4px, so the ring clears the tile above and below by
 * 2.0px each. MEASURED against a scored tile directly above the cursor — a
 * `correct` green, rgb(22,163,74) in light and rgb(21,128,61) in dark — which is
 * the case that would expose a ring drawn on a state colour rather than on the
 * page. It does not touch it in either theme.
 *
 * VISIBLE IN BOTH THEMES. `--ring` is `--accent-solid`, which forks: #15803d on the
 * #fafafa page in light (4.81:1) and #22c55e on #0a0a0a in dark (8.69:1), both well
 * clear of the 3:1 floor for a non-text graphical object. The ring always draws on
 * the PAGE background rather than on a tile, because the cursor tile is by
 * construction the EMPTY one — `cursorFor` returns the first slot with no letter in
 * it — so `tileClass.empty` leaves it transparent and no state colour is behind it.
 *
 * NO GATE IN THIS REPO CAN SEE ANY OF THAT. vitest has no layout engine, so
 * `getBoundingClientRect` is all zeros and a ring that was clipped, zero-sized or
 * invisible against the tile would pass every test here. The numbers above came
 * from rendering this component's real output in a real browser and screenshotting
 * a strip straddling the tile edge to prove the pixels actually change, which is
 * the only way a change to this line can be checked too.
 */
const CURSOR_CLASS = 'z-10 ring-2 ring-ring'

export function WordleBoard({
  guesses,
  answer,
  showLetters = true,
  boardEntry = false,
  cursor = null,
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
            {tileStates(answer, guess).map((state, col) => {
              /**
               * `boardEntry &&` IS A SECOND LOCK ON THE SAME DOOR, and it is
               * deliberate belt-and-braces. The display board (team-boards.tsx) is
               * not an input and must never grow a caret; today it simply passes no
               * `cursor`, but that is a CONVENTION a future caller can break by
               * accident — forwarding props wholesale, say. Gating on the flag that
               * already means "this board is being typed into" makes it structural:
               * there is no argument to this component that puts a cursor on a
               * board that is only being read.
               */
              const isCursor =
                boardEntry && cursor !== null && cursor.row === row && cursor.col === col
              return (
                <div
                  key={col}
                  // THE ID SCHEME IS LOAD-BEARING ELSEWHERE — form.tsx's
                  // scrollActiveRowIntoView selects on it. Do not change it.
                  id={`${row + 1}-${col + 1}`}
                  data-state={state}
                  /**
                   * PRESENT ONLY ON THE CURSOR TILE, unlike answer-slots.tsx which
                   * spells 'true'/'false' on every slot. There the attribute is how a
                   * test counts marked slots; here `data-testid` does that, and the
                   * display board should carry no trace of a concept it has no part
                   * in — a grid of 30 `data-cursor="false"` tiles invites exactly the
                   * "so make it configurable" change this prop exists to prevent.
                   */
                  {...(isCursor ? { 'data-cursor': 'true', 'data-testid': 'board-cursor' } : {})}
                  className={cn(
                    'flex items-center justify-center border uppercase caret-transparent',
                    boardEntry ? TILE_SIZE_ENTRY : TILE_SIZE_DISPLAY,
                    tileClass[state],
                    isCursor && CURSOR_CLASS,
                  )}
                >
                  {reveal ? (guess[col] ?? '') : ''}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export default WordleBoard
