import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { KeyboardEvent, KeyboardEventHandler } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { WordleBoard } from '#/components/wordle-board.tsx'
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
export function applyLetter(key: string, answer: string, guesses: Array<string>): Array<string> {
  const rows = toRows(guesses)
  const current = rows.find((guess) => guess.length < 5) ?? ''
  // v1 stops here: once a row equals the answer the board is finished, and
  // typing past it would start a seventh guess.
  if (current === answer) return rows
  // A full, six-row board (every row length 5): there is no row left with
  // room for another letter, so `current` falls back to '', which no row
  // actually contains. board-input.tsx never reaches this — it gates every
  // letter key on `toRows(guesses)[5].length < 5` first — but this is an
  // exported pure function and that guard is a caller's responsibility to
  // replicate, not this one's to assume.
  const index = rows.indexOf(current)
  if (index === -1) return rows
  const next = [...rows]
  next[index] = current + key.toUpperCase()
  return next
}

export function applyBackspace(guesses: Array<string>): Array<string> {
  const rows = toRows(guesses)
  // Array.prototype.findLastIndex is ES2023; this project's tsconfig targets
  // ES2022, so the last filled row is found with a manual reverse scan instead.
  let lastFilled = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].length > 0) {
      lastFilled = i
      break
    }
  }
  if (lastFilled < 0) return rows
  const next = [...rows]
  next[lastFilled] = rows[lastFilled].slice(0, -1)
  return next
}

export function BoardInput({
  guesses,
  setGuesses,
  answer,
  hasExistingScore,
  submitting,
  submitDisabled,
  tabIndex,
  onBoardFocus,
}: {
  guesses: Array<string>
  setGuesses: (guesses: Array<string>) => void
  answer: string
  hasExistingScore: boolean
  submitting: boolean
  submitDisabled: boolean
  tabIndex?: number
  onBoardFocus?: () => void
}) {
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
      setGuesses(applyBackspace(guesses))
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
    const isLetter = key.length === 1 && /[a-zA-Z]/.test(key)
    if (isLetter && !boardIsValid(answer, guesses, hasExistingScore) && toRows(guesses)[5].length < 5) {
      setGuesses(applyLetter(key, answer, guesses))
    }
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
        className="mt-4 flex h-fit w-full select-none justify-center rounded-lg caret-transparent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-4 focus:ring-offset-background md:my-6"
        role="region"
        aria-label="Wordle Board"
        tabIndex={tabIndex}
      >
        <WordleBoard guesses={toRows(guesses)} answer={answer} boardEntry />
      </div>
      {/* Desktop's submit. The mobile one lives in the sheet footer so it can
          pin above the keyboard. */}
      <div className="invisible mt-2 flex h-0 justify-end space-x-4 md:visible md:mt-4 md:h-fit">
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
