import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { KeyboardEvent, KeyboardEventHandler } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { WordleBoard } from '#/components/wordle-board.tsx'
import { backspace, typeLetter } from './entry-cursor.ts'
import type { Cursor } from './entry-cursor.ts'
import { boardIsValid, toRows } from '../../../convex/lib/board.ts'

/**
 * The board, with the keyboard captured over it. Ported from v1's
 * wordle-board-input.tsx and the handleKey/handleLetter/handleBackspace trio in
 * board-entry/utils.ts.
 *
 * The board is a contentEditable div rather than inputs so the mobile keyboard
 * appears without a visible caret or a focus-zoom. Every key except Tab is
 * preventDefault'd; nothing is ever typed into the DOM directly.
 *
 * keydown alone is not enough to guarantee that: paste fires a separate
 * `paste` event, IME composition commits and mobile swipe-typing/predictive-
 * text/dictation insert via `beforeinput`/`input` with no per-character keydown
 * at all, and `<WordleBoard>` — a React-owned subtree — renders INSIDE this
 * node, so a native insertion here can corrupt the DOM React thinks it owns
 * (wrong board on submit, or a `removeChild` reconciliation crash). `input` is
 * not cancelable, but `beforeinput` is (it is also what fires for paste and
 * IME), so onBeforeInput + onPaste close the gap keydown leaves open.
 */
export function BoardInput({
  guesses,
  setGuesses,
  answer,
  hasExistingScore,
  submitting,
  submitDisabled,
  cursor = null,
  tabIndex,
  onBoardFocus,
}: {
  guesses: Array<string>
  setGuesses: (guesses: Array<string>) => void
  answer: string
  hasExistingScore: boolean
  submitting: boolean
  submitDisabled: boolean
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
  tabIndex?: number
  onBoardFocus?: () => void
}) {
  /**
   * THIS COMPONENT'S KEYSTROKES ARE BOARD KEYSTROKES, BY CONSTRUCTION.
   *
   * `zone: 'board'` is not an assumption about where the caret is: it is a
   * statement about where the event came from. This handler is bound to the
   * board's own contentEditable, and form.tsx's answer field has its own
   * handler, so a key that arrives here was typed at the board. The zone that
   * comes BACK from `backspace` is a different matter — see below.
   */
  const state = () => ({ answer, guesses, zone: 'board' as const })

  const handleKeyDown: KeyboardEventHandler = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key
    // Tab must reach the browser to move focus. Ctrl/Cmd combos (paste,
    // copy, select-all, ...) must NOT be treated as plain letters — found
    // while verifying the paste/beforeinput guards below: Ctrl+V's keydown
    // has event.key === 'v' with no modifier check, so without this a paste
    // shortcut got typed as a literal "v" instead of ever reaching a real
    // paste attempt. Returning without preventDefault lets the browser
    // proceed with its native action, which is exactly what onBeforeInput/
    // onPaste below exist to intercept.
    if (key === 'Tab' || event.ctrlKey || event.metaKey) return
    event.preventDefault()

    if (key === 'Backspace') {
      // THE ZONE IS DISCARDED, DELIBERATELY. On a genuinely empty board
      // `backspace` walks back to the answer, and this component has no answer
      // to walk back to — form.tsx owns that field and its own focus. The
      // guesses it returns are correct either way, so writing them and ignoring
      // where the cursor went is the whole of what is available here.
      setGuesses(backspace(state()).guesses)
      return
    }
    if (key === 'Enter') {
      if (boardIsValid(answer, guesses, hasExistingScore)) {
        document.getElementById('board-submit')?.click()
      } else {
        toast.warning('Board must be complete to submit')
      }
      return
    }
    /**
     * NO GATE OF ITS OWN, AND THAT IS THE POINT OF ROUTING THROUGH `typeLetter`.
     *
     * This used to read `isLetter && !boardIsValid(...) && toRows(guesses)[5].length
     * < 5`, three conditions re-deciding here what the state machine already
     * decides: 'not-a-letter', 'board-solved' and 'board-full' are exactly those
     * three answers, plus 'answer-incomplete', which nothing here asked at all.
     * Keeping them would leave two sites answering "may this letter land?", which
     * is the shape of the bug this change exists to kill.
     *
     * THE WRITE IS SKIPPED ON A REFUSAL rather than merely harmless: every
     * refusal returns the input normalised through `toRows`, so a fresh `guesses`
     * array on every Shift press would re-fire form.tsx's `useEffect(…, [guesses])`
     * — scrollActiveRowIntoView — for a keystroke that changed nothing.
     *
     * Nothing surfaces the refusal yet. The coach line that names it is the next
     * task; until then a refused keystroke is as silent as it has always been.
     */
    const result = typeLetter(state(), key)
    if (result.refused === null) setGuesses(result.next.guesses)
  }

  return (
    <>
      <div
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onBeforeInput={(event) => event.preventDefault()}
        onPaste={(event) => event.preventDefault()}
        onFocus={onBoardFocus}
        /*
          `mx-auto w-fit`, NOT `w-full ... justify-center` (wordle-teams-rpql).
          The ring is drawn around THIS element, and while it spanned the full
          row the ring outlined the whole sheet rather than the board — too
          large, and clipped at both edges by form.tsx's `overflow-y-auto`
          scroll container, which computes overflow-x to auto as well (the same
          CSS rule wordle-teams-iv09 turned on).

          Hugging the board puts the ring just outside the tiles, where it is
          visible all the way round and has slack inside the scroll container.
          `ring-offset-4` is kept rather than reduced: with the element now the
          board's own size, 4px of gap is what stops the ring cutting into the
          top row of tiles.
        */
        className="mx-auto mt-4 flex h-fit w-fit select-none rounded-lg caret-transparent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 focus:ring-offset-background md:my-2"
        role="region"
        aria-label="Wordle Board"
        tabIndex={tabIndex}
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
      {/* Desktop's submit. The mobile one lives in the sheet footer so it can
          pin above the keyboard. */}
      <div className="invisible mt-2 flex h-0 justify-end space-x-4 md:visible md:mt-2 md:h-fit">
        <Button
          disabled={submitting || submitDisabled}
          aria-disabled={submitting || submitDisabled}
          type="submit"
          id="board-submit"
          tabIndex={5}
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
        </Button>
      </div>
    </>
  )
}

export default BoardInput
