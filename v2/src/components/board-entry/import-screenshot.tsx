import { useEffect, useRef, useState } from 'react'
import { ImageDown, Loader2 } from 'lucide-react'
import type { ChangeEvent, DragEvent } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { bitmapFromBlob, imageFromDrop, imageFromFiles, imageFromPaste } from '#/lib/board-import/adapter.ts'
import { parseBoard } from '#/lib/board-import/parse.ts'
import type { BoardParse } from '#/lib/board-import/parse.ts'
import { cn } from '#/lib/utils.ts'
import { importSummary } from './import-prefill.ts'

/**
 * Stage 5's front door: paste, drop or choose a screenshot.
 *
 * IT FILLS THE FORM IN AND STOPS. Nothing here saves anything — the player
 * confirms with the same Submit they have always used, and a wrong parse
 * therefore costs a correction rather than a bad row in the table. That is the
 * whole safety argument for shipping a reader that is 93% right per glyph
 * rather than waiting for one that is never wrong.
 *
 * THE PASTE LISTENER IS ON THE DOCUMENT, and it has to be. A screenshot is
 * pasted with Cmd-V while the player is looking at the sheet, not while some
 * particular element has focus — and the board itself is a contentEditable that
 * cancels every paste that reaches it (board-input.tsx), so a listener bound
 * there would never fire. Capture phase, for the same reason.
 */
export function ImportScreenshot({
  onParsed,
  answer,
  disabled = false,
}: {
  onParsed: (parse: BoardParse) => void
  /** The answer the player has already typed, if any. It constrains the parse. */
  answer: string
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // The latest answer, without making the paste listener depend on it: a
  // re-bound document listener on every keystroke in the answer field would
  // detach and reattach thirty times a board.
  const answerRef = useRef(answer)
  answerRef.current = answer

  const run = async (blob: Blob | null) => {
    if (blob === null) {
      setMessage('That did not contain an image.')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const bitmap = await bitmapFromBlob(blob)
      const typed = answerRef.current.trim()
      const parse = parseBoard(bitmap, { answer: typed.length === 5 ? typed.toUpperCase() : null })
      setMessage(importSummary(parse))
      onParsed(parse)
    } catch (error) {
      // A decode that fails is a real possibility — an unsupported format, a
      // truncated file, a browser with no canvas — and it must not take the
      // form down with it. Manual entry still works.
      console.error('Board import could not read that image', error)
      setMessage('Could not read that image. You can still type the board in.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (disabled) return
    const onPaste = (event: ClipboardEvent) => {
      const file = imageFromPaste(event)
      if (file === null) return
      // Only once we KNOW there is an image: a plain text paste must still
      // reach whatever the player was typing into.
      event.preventDefault()
      void run(file)
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled])

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    void run(imageFromDrop(event.nativeEvent))
  }

  const onChoose = (event: ChangeEvent<HTMLInputElement>) => {
    void run(imageFromFiles(event.target.files))
    // So choosing the same file twice in a row fires change again.
    event.target.value = ''
  }

  return (
    <div
      data-testid="board-import"
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'mx-2 flex flex-col gap-1 rounded-md border border-dashed border-input px-3 py-2 md:mx-4',
        dragging && 'border-solid border-ring bg-accent/30',
      )}
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          aria-disabled={disabled || busy}
          onClick={() => fileInput.current?.click()}
          tabIndex={4}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageDown className="mr-2 h-4 w-4" />}
          Import screenshot
        </Button>
        <span className="text-xs text-muted-foreground">or paste, or drop one here</span>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Wordle screenshot"
        onChange={onChoose}
      />
      {message !== null && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  )
}

export default ImportScreenshot
