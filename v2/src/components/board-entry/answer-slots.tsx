import { cn } from '#/lib/utils.ts'
import { useReducedMotion } from '#/lib/use-reduced-motion.ts'
import { ANSWER_LENGTH } from './entry-cursor.ts'

/**
 * The day's answer as five slots, one letter each, with a rendered caret.
 *
 * WHAT IT REPLACES, AND THE BUG IT FIXES (wordle-teams-wty4.1.6). The answer was
 * a `contentEditable` div wearing `border border-input bg-background rounded-md
 * h-10` — pixel-for-pixel a shadcn Input — with `caret-transparent` and every key
 * preventDefault'd. So it had the complete visual language of a text input and
 * none of its behaviour: no caret, no click-to-position, no selection, no paste.
 * A focused box with a bright ring and NO BLINKING CARET is the standard
 * signature of a DISABLED field, and that is most of why players opened the
 * dialog and did not know to type. The caret below is not decoration; it is the
 * whole point of the component.
 *
 * FIVE SLOTS RATHER THAN A WIDER BOX, because the answer is a five-letter word
 * and slots say so without a sentence. It is the verification-code input's
 * pattern for the verification-code input's reasons — fixed length, one character
 * per slot, auto-advance, no free-form editing — which is exactly the set of
 * behaviours this field can actually support.
 *
 * PRESENTATIONAL ONLY. It RENDERS a cursor position; it does not decide one.
 * `cursorFor` in entry-cursor.ts is the single definition of "where does the next
 * letter go", shared with the board so the two renderings cannot disagree, and
 * this takes its answer as a prop. No keyboard handling lives here either — the
 * form owns the keystroke stream.
 */
export type AnswerSlotsProps = {
  /** The answer so far, 0..ANSWER_LENGTH letters. Rendered uppercase. */
  answer: string
  /**
   * The caret's insertion point, straight from `cursorFor`: 0..ANSWER_LENGTH
   * inclusive, or null when the cursor is on the board (or nowhere).
   */
  cursorIndex: number | null
  /** Mousedown anywhere in the group. The escape hatch back from the board. */
  onSelect: () => void
  className?: string
}

/**
 * THE SLOT'S SIZE IS THE REPLACED FIELD'S SIZE, `h-10`, ON PURPOSE. The entry
 * dialog is capped at `100dvh` minus its insets and its vertical budget is
 * already tight enough that the board has a short-viewport size step of its own
 * (see TILE_SIZE_ENTRY in wordle-board.tsx). Keeping the answer row's height
 * byte-for-byte what it was means this change cannot be what makes the dialog
 * scroll. `aspect-square` was the alternative and is rejected for the same
 * reason: in the narrow column this sits in on a phone it would collapse the row.
 *
 * WIDTH COMES FROM THE CALLER — `grid-cols-5` over whatever the parent gives —
 * so the component does not need to know how the answer row is laid out.
 *
 * SHARP CORNERS, NO `rounded-*`, ECHOING THE BOARD. wordle-board.tsx calls the
 * square corner "the game's visual signature"; these slots sit directly above
 * that board in the same dialog, and the echo is what makes them read as letter
 * cells rather than as five small text inputs. `border-wordle-tile-border` is the
 * board's own empty-tile border for the same reason.
 */
const SLOT_CLASS =
  'relative flex h-10 items-center justify-center border border-wordle-tile-border text-lg font-semibold uppercase'

export function AnswerSlots({ answer, cursorIndex, onSelect, className }: AnswerSlotsProps) {
  /**
   * ASKED IN JAVASCRIPT, NOT IN A `@media (prefers-reduced-motion: reduce)` BLOCK
   * — this repo's established shape, because there is no CSSOM under vitest and a
   * rule in styles.css is therefore a rule no gate here can observe. See the note
   * on the hook itself and on the confetti keyframes in styles.css.
   *
   * REDUCED MOTION STILL RENDERS THE CARET, it just stops it blinking. Unlike the
   * confetti — whose entire content is motion, so rendering nothing is honest —
   * the caret's job is to be VISIBLE. Dropping it for the reduced-motion reader
   * would hand them back the exact bug this component exists to fix.
   */
  const reducedMotion = useReducedMotion()

  /**
   * `cursorIndex === ANSWER_LENGTH` IS LEGAL AND MUST RENDER. It is the insertion
   * point past a complete answer — `cursorFor` returns `{ index: answer.length }`,
   * and a player reaches it by clicking back to correct a finished answer. There
   * are five slots to draw six insertion points in, so index 5 lands on the LAST
   * slot as a TRAILING caret, the way an OTP input does. Returning nothing here
   * would take the caret off screen at precisely the moment the player asked to
   * edit, which is the original bug wearing a different hat.
   */
  const trailing = cursorIndex === ANSWER_LENGTH
  const cursorSlot = cursorIndex === null ? null : trailing ? ANSWER_LENGTH - 1 : cursorIndex

  /**
   * SLICED TO ANSWER_LENGTH so the aria-label can never claim more letters than
   * there are slots to show. `normalise` in entry-cursor.ts already clamps, and
   * its doc explains why a six-letter answer is REAL data (convex/schema.ts
   * stores it unconstrained) rather than an impossible one — this keeps the
   * spoken count and the rendered slots agreeing without depending on who called.
   */
  const letters = [...answer.toUpperCase()].slice(0, ANSWER_LENGTH)

  return (
    <div
      role="group"
      /**
       * THE LETTERS ARE SPACE-SEPARATED so a screen reader spells the answer out
       * rather than pronouncing a part-word ("CR"), and the count leads so the
       * reader hears how much is left before hearing what is there.
       *
       * THE EMPTY ANSWER GETS ITS OWN SENTENCE. The general form would end
       * "0 of 5 letters: " with a dangling colon and nothing after it.
       */
      aria-label={
        letters.length === 0
          ? "Today's Wordle answer, no letters yet"
          : `Today's Wordle answer, ${letters.length} of ${ANSWER_LENGTH} letters: ${letters.join(' ')}`
      }
      // MOUSEDOWN, NOT CLICK: it has to land before the focus/blur pair a click
      // on the other zone would otherwise settle first.
      onMouseDown={onSelect}
      // `caret-transparent` AND `select-none` ARE KEPT FROM THE FIELD THIS
      // REPLACES. The native caret must stay suppressed — the rendered one below
      // is its replacement, and two carets is worse than none — and a drag across
      // five letter cells selecting text is meaningless here.
      className={cn('grid grid-cols-5 gap-1 caret-transparent select-none', className)}
    >
      {Array.from({ length: ANSWER_LENGTH }, (_, index) => {
        const isCursor = index === cursorSlot
        const isTrailing = isCursor && trailing
        return (
          <div
            key={index}
            data-testid="answer-slot"
            // BOTH ATTRIBUTES ARE ALWAYS PRESENT, spelled 'true'/'false' rather
            // than present/absent, so a test asserting "exactly one slot carries
            // the cursor" reads the same attribute on every slot.
            data-cursor={isCursor ? 'true' : 'false'}
            data-cursor-trailing={isTrailing ? 'true' : 'false'}
            className={cn(SLOT_CLASS, isCursor && 'z-10 ring-2 ring-ring')}
          >
            {letters[index] ?? ''}
            {/* THE CARET. `aria-hidden` because the group's aria-label already
                says how many letters are in, so announcing a caret element would
                only add noise; it is a VISUAL cue for a sighted player.

                IT CONTRIBUTES NO TEXT, which is load-bearing rather than
                incidental: the cursor slot is frequently the EMPTY one, and a
                caret carrying so much as a U+200B would make that slot's
                textContent non-empty.

                TRAILING SITS AT THE SLOT'S RIGHT EDGE, centred otherwise —
                the two cases are "before this letter" and "after the last
                letter", and the caret has to look like the difference. */}
            {isCursor && (
              <span
                data-testid="answer-caret"
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-0 flex items-center',
                  isTrailing ? 'justify-end pr-1' : 'justify-center',
                )}
              >
                <span
                  className={cn(
                    'h-5 w-px bg-foreground',
                    !reducedMotion && 'animate-caret-blink duration-1000',
                  )}
                />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default AnswerSlots
