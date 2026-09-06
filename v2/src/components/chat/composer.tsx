import { useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { MAX_BODY_LENGTH } from '../../../convex/lib/chatLimits.ts'

type Props = { onSend: (body: string) => Promise<void>; disabled?: boolean }

/**
 * STICKY, so it pins above the mobile keyboard — the same treatment board
 * entry's footer gets (form.tsx, `sticky bottom-0 ... bg-background`), for the
 * same reason.
 *
 * WHY THIS DOES NOT ALSO REACH FOR `useVisualViewport`, THE OTHER HALF OF
 * BOARD ENTRY'S FIX. That hook (`src/lib/use-visual-viewport.ts`) binds a
 * `position: fixed` Radix Sheet/Dialog's `height`/`top` to the visual
 * viewport, because iOS Safari does not shrink the LAYOUT viewport when the
 * keyboard opens, so a fixed overlay with Radix's body-scroll-lock does not
 * reflow and its lower content ends up behind the keyboard with no way to
 * scroll to it. Every existing call site (board-entry's Sheet, and the
 * create/update-team, invite-player, scoring-system dialogs) is exactly that
 * shape: a fixed-position overlay that locks body scroll.
 *
 * `/chat` is not that shape. It is a normal routed page in ordinary document
 * flow (see routes/__root.tsx: sticky header, `<Outlet/>`, footer, no fixed
 * wrapper, no scroll lock), so the page itself scrolls normally and this
 * `sticky bottom-0` footer sticks within that ordinary scrolling document —
 * the same CSS mechanism board entry's footer uses, just without a bounded,
 * `overflow-hidden` ancestor to clip it against, because nothing here plays
 * the Sheet's role. Reproducing the Sheet's fix for this page would mean
 * wrapping the whole route in a viewport-bound, clipped flex column —
 * a page-layout change well past "add a composer", and not what any of the
 * design doc's four visualViewport call sites actually did. Left as a
 * follow-up if the on-device spike this task unblocks shows the composer
 * getting hidden behind the keyboard on iPhone.
 *
 * The length cap is imported rather than retyped: the server refuses anything
 * over MAX_BODY_LENGTH with INVALID_MESSAGE, and a client that disagreed with
 * it would let someone type a message that can only fail.
 */
export function Composer({ onSend, disabled }: Props) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const trimmed = body.trim()
  const tooLong = trimmed.length > MAX_BODY_LENGTH

  async function submit() {
    if (trimmed.length === 0 || tooLong || sending) return
    setSending(true)
    try {
      await onSend(trimmed)
      // ONLY on success. A failed send keeps the typed text — see onSend's
      // contract on chat.tsx's handleSend: it rethrows after toasting, and
      // that rejection is what stops this line from running.
      setBody('')
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      className="sticky bottom-0 flex gap-2 border-t bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <textarea
        className="min-h-10 flex-1 resize-none rounded border p-2"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message your team"
        disabled={disabled || sending}
        data-testid="chat-composer"
      />
      <Button type="submit" disabled={disabled || sending || trimmed.length === 0 || tooLong}>
        Send
      </Button>
    </form>
  )
}
