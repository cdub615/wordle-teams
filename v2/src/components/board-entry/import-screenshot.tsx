import { useEffect, useRef, useState } from 'react'
import { ClipboardPaste, ImageDown, Loader2 } from 'lucide-react'
import type { ChangeEvent, DragEvent } from 'react'
import { Button } from '#/components/ui/button.tsx'
import {
  bitmapFromBlob,
  canReadClipboard,
  imageFromClipboard,
  imageFromDrop,
  imageFromFiles,
  imageFromPaste,
} from '#/lib/board-import/adapter.ts'
import type { ClipboardImage } from '#/lib/board-import/adapter.ts'
import { parseBoard } from '#/lib/board-import/parse.ts'
import type { BoardParse } from '#/lib/board-import/parse.ts'
import { cn } from '#/lib/utils.ts'

/**
 * Stage 5's front door: paste, drop or choose a screenshot.
 *
 * IT FILLS THE FORM IN AND STOPS. Nothing here saves anything — the player
 * confirms with the same Submit they have always used, and a wrong parse
 * therefore costs a correction rather than a bad row in the table. That is the
 * whole safety argument for shipping a reader that is 93% right per glyph
 * rather than waiting for one that is never wrong.
 *
 * THERE ARE TWO PASTE MECHANISMS HERE AND BOTH ARE NEEDED. The document
 * listener catches a desktop Cmd-V. The BUTTON is the only thing that works on
 * iOS at all: there is no Cmd-V there, and the only way to fire a paste event
 * is a long-press "Paste" on an editable element — which board-input.tsx and
 * the answer field both cancel on purpose. The button is listed first because
 * on a phone it is the common case, not the fallback: a screenshot taken with
 * "Copy and Delete" never reaches Photos, so the file picker finds nothing.
 *
 * THE PASTE LISTENER IS ON THE DOCUMENT, and it has to be. A screenshot is
 * pasted with Cmd-V while the player is looking at the sheet, not while some
 * particular element has focus — and the board itself is a contentEditable that
 * cancels every paste that reaches it (board-input.tsx), so a listener bound
 * there would never fire. Capture phase, for the same reason.
 */
/** Each clipboard outcome reads as help, because none of them is really an error. */
function clipboardMessage(reason: Extract<ClipboardImage, { ok: false }>['reason']): string {
  switch (reason) {
    case 'refused':
      return 'Your browser did not allow the paste. Tap Paste again and choose Allow.'
    case 'no-image':
      return 'There is no image on the clipboard. Copy a screenshot first, then tap Paste.'
    case 'unsupported':
      return 'This browser cannot paste images. Use Import screenshot instead.'
    case 'failed':
      return 'Could not read the clipboard. You can still use Import screenshot.'
  }
}

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
      // WHAT THE PARSE MEANS IS THE CALLER'S TO SAY, not this component's. A
      // parse always moves the panel to another step — to confirm what was
      // read, or to manual entry carrying the reason there was nothing — and a
      // message set here would be unmounted before anyone could read it.
      // Everything below still reports HERE, because an image that never
      // became a parse leaves the player exactly where they are.
      onParsed(parseBoard(bitmap, { answer: typed.length === 5 ? typed.toUpperCase() : null }))
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

  /**
   * NOTHING IS AWAITED BEFORE imageFromClipboard(), and that is load-bearing
   * rather than tidy. Safari drops the user gesture across an await, and the
   * clipboard read then rejects with NotAllowedError however the person got
   * here. setState is synchronous, so these two calls are safe; an await in
   * front of them would silently break paste on every iPhone.
   */
  const onPasteClick = () => {
    setBusy(true)
    setMessage(null)
    const reading = imageFromClipboard()

    void reading.then(async (image) => {
      if (!image.ok) {
        setBusy(false)
        setMessage(clipboardMessage(image.reason))
        return
      }
      await run(image.blob)
    })
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
        'mx-2 flex flex-col gap-2 rounded-md border border-dashed border-input p-3 md:mx-0',
        dragging && 'border-solid border-ring bg-accent/30',
      )}
    >
      {/* STACKED AND FULL WIDTH, because this is step one's list of choices
          rather than a control tucked beside a form. Two side-by-side buttons
          wrap awkwardly at an iPhone SE's width and read as secondary. */}
      <div className="flex flex-col gap-2">
        {/* PASTE FIRST. On a phone the clipboard is where the screenshot is —
            "Copy and Delete" never writes one to Photos — so this is the
            common case and the picker is the fallback, not the other way
            round. Hidden entirely where the browser cannot read images off
            the clipboard, rather than offered and then apologised for. */}
        {canReadClipboard() && (
          <Button
            type="button"
            variant="outline"
            className="justify-start"
            disabled={disabled || busy}
            aria-disabled={disabled || busy}
            onClick={onPasteClick}
            tabIndex={2}
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ClipboardPaste className="mr-2 h-4 w-4" />
            )}
            Paste screenshot
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="justify-start"
          disabled={disabled || busy}
          aria-disabled={disabled || busy}
          onClick={() => fileInput.current?.click()}
          tabIndex={3}
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageDown className="mr-2 h-4 w-4" />}
          Import screenshot
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">or drop a screenshot here</span>
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
