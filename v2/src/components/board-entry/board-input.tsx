import { Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { WordleBoard } from '#/components/wordle-board.tsx'
import type { Cursor } from './entry-cursor.ts'
import { toRows } from '../../../convex/lib/board.ts'

/**
 * The board half of the entry surface. Ported from v1's wordle-board-input.tsx,
 * and now a RENDERER ONLY.
 *
 * WHAT MOVED OUT, AND WHY IT HAD TO. This component used to be a focus target of
 * its own: a `contentEditable` with its own keydown handler, its own focus ring
 * and its own tabIndex, sitting beside form.tsx's `#answer` box which had all of
 * the same. Two focus stops meant a player who finished the answer had to
 * discover that the board needed clicking, and the keystroke they tried it with
 * vanished. form.tsx owns the whole keystroke stream now, so all of that lives
 * there.
 *
 * AND THERE IS NO EDITING HOST LEFT ANYWHERE. The ONE region that replaced the
 * two was itself a `contentEditable`, wrapped around this board — React-owned
 * content inside an editing host, which is what made wordle-teams-5n6n possible:
 * an IME commit's `beforeinput` is dispatched `cancelable: false`, so composed
 * text could land in a tile and stay there permanently. form.tsx keeps focus and
 * the software keyboard on a visually-hidden `<input>` that nothing reads now,
 * and this board is plain presentation beside it. The `onBeforeInput`/`onPaste`
 * guards that used to be described here are deleted, because a non-editable
 * subtree has no insertion path to guard.
 *
 * WHAT IT KEEPS: the board, the cursor adaptation below (the one place the whole
 * `Cursor` is narrowed to a tile), and — as a SEPARATE export, `BoardSubmit` —
 * desktop's submit button.
 *
 * THE SUBMIT BUTTON IS STILL A SEPARATE EXPORT, BUT THE CONSTRAINT THAT FORCED
 * IT HAS DISSOLVED. It was forced because form.tsx's region had to CONTAIN the
 * board — that is what makes one focus stop out of two — and NO BUTTON MAY SIT
 * INSIDE A contentEditable: it is focusable-inside-editable (browsers disagree
 * about whether it is even clickable there), it puts an interactive control in a
 * subtree whose every key event is preventDefault'd, and it drags a `type=submit`
 * into the editing host. With the editing host gone, a button beside the board
 * would now be merely a button beside the board.
 *
 * IT STAYS SPLIT ANYWAY, AND THE REASON IS NOW LAYOUT RATHER THAN SAFETY: the
 * board sits in the `w-fit` column the answer slots are centred against, and the
 * desktop submit is a right-aligned row under the whole scroller. Re-merging them
 * is a layout change with `md:` consequences — see BoardSubmit's own
 * `hidden md:flex` note, which is where a phone's last 40px of scrolling went —
 * not a tidy-up. So this is a seam that no longer HAS to exist and costs nothing
 * to keep.
 */
export function BoardInput({
  guesses,
  answer,
  cursor = null,
  onSelect,
}: {
  guesses: Array<string>
  answer: string
  /**
   * `cursorFor`'s RESULT, UNADAPTED — the whole Cursor, both zones, or null.
   *
   * THE ADAPTATION TO `<WordleBoard>`'s `{ row, col }` HAPPENS HERE AND ONLY
   * HERE, one expression, at the render below. It is not the caller's to do: the
   * answer-zone variant is NON-null with a caret that belongs to
   * answer-slots.tsx, so "cursor is not null" is not "mark a tile" and every
   * caller that adapted for itself would be one place the two zones could draw a
   * caret each. Taking the undiscriminated type is what makes that impossible to
   * get wrong from outside — a caller hands over `cursorFor(state)` and nothing
   * else.
   *
   * NULL IS LEGAL AND IS THE DEFAULT, for a board with no cursor to show yet.
   */
  cursor?: Cursor | null
  /**
   * Mousedown anywhere in the board half — `AnswerSlots`' `onSelect` for the
   * other zone, and MOUSEDOWN for the same reason it is there: it is the event
   * whose default action IS the focus change, so it is the only one that can run
   * beside form.tsx's `preventDefault` on the presentation wrapper and leave
   * focus where it already is.
   *
   * The caller answers it with `moveZone`, which REFUSES the move while the
   * answer is short. That refusal is why the board can render at full strength
   * with no lock and no dim: an early click is answered by the coach line rather
   * than prevented by a disabled-looking grid.
   */
  onSelect?: () => void
}) {
  return (
    <div
      onMouseDown={onSelect}
      /*
        `mx-auto w-fit` (wordle-teams-rpql). The ring this once carried is gone
        entirely — there is no focusable element on the entry surface for a ring
        to belong to — but the sizing survives it: while this spanned the full row
        it was the ring that outlined the whole sheet rather than the board, and a
        full-width board half inside form.tsx's `w-fit` wrapper would put that
        wrapper back in exactly that shape.
      */
      className="mx-auto flex h-fit w-fit"
      role="region"
      aria-label="Wordle Board"
    >
      {/* The one adaptation, and the `zone` test is the load-bearing half of
          it: the answer variant is non-null and its caret is drawn by
          answer-slots.tsx, so forwarding it here would put two carets on
          screen at once. See wordle-board.tsx's `cursor` doc. */}
      <WordleBoard
        guesses={toRows(guesses)}
        answer={answer}
        boardEntry
        cursor={cursor?.zone === 'board' ? { row: cursor.row, col: cursor.index } : null}
      />
    </div>
  )
}

/**
 * Desktop's submit. The mobile one lives in the sheet footer so it can pin above
 * the keyboard.
 *
 * `id="board-submit"` is how form.tsx's Enter key reaches it, which is the same
 * indirection the board's own handler used before the stream moved. It used to
 * have to sit OUTSIDE the entry region as well, because that region was an
 * editing host; it is not one any more — see the note above.
 *
 * `hidden md:flex`, NOT `invisible h-0 md:visible md:h-fit` (wordle-teams-bi8i),
 * AND ON A PHONE THAT WAS THE WHOLE OF THE SCROLLING. `invisible` hides this box
 * and `h-0` flattens it, but the `h-10` Button INSIDE it still lays out.
 * Measured at 390x844 against the built stylesheet: the entry scroller's
 * clientHeight was 436 and its real content was exactly 436 — THE BOARD FITS —
 * while scrollHeight read 476. All 40px of the phone's scrolling was this
 * desktop-only button, plus the 8px `mt-2` that came with it.
 *
 * `display: none` RATHER THAN CLIPPING IT: clipping would leave a focusable
 * submit control in the tab order and in the accessibility tree on the viewport
 * where the sheet footer's Submit is the real one. `hidden` takes it out of all
 * three. Under `md` it is a flex row again and the button is the desktop submit,
 * unchanged — and `document.getElementById('board-submit')` still resolves at
 * every width, because `display:none` removes a box, not an element.
 */
export function BoardSubmit({
  submitting,
  disabled,
}: {
  submitting: boolean
  disabled: boolean
}) {
  return (
    <div className="mt-2 hidden h-fit justify-end space-x-4 md:flex">
      <Button
        disabled={submitting || disabled}
        aria-disabled={submitting || disabled}
        type="submit"
        id="board-submit"
        tabIndex={5}
      >
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Submit
      </Button>
    </div>
  )
}

export default BoardInput
