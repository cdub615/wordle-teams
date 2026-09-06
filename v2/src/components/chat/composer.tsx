import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button.tsx'
import { MAX_BODY_LENGTH } from '../../../convex/lib/chatLimits.ts'

type Props = { onSend: (body: string) => Promise<void>; disabled?: boolean }

/**
 * STICKY, so it pins above the mobile keyboard — the same treatment board
 * entry's footer gets (form.tsx, `sticky bottom-0 ... bg-background`), for the
 * same reason.
 *
 * THE STICKY IS UNCHANGED BY THE VIEWPORT-HEIGHT SHELL routes/chat.tsx now
 * wraps this in, AND THAT IS DELIBERATE. What makes iOS Safari put a focused
 * input above the keyboard is that the page is in ordinary document flow with
 * nothing scroll-locked and nothing `position: fixed` — the keyboard does not
 * shrink the layout viewport, so Safari moves the VISUAL viewport to bring the
 * focused element into view, and only a fixed or scroll-locked element can
 * defeat that. The shell bounds the page's HEIGHT (so the message list scrolls
 * instead of the document); it adds no `overflow: hidden` to html or body, no
 * scroll lock, and no fixed positioning. Every ingredient of the behaviour that
 * works today is still here.
 *
 * WHY THIS STILL DOES NOT REACH FOR `useVisualViewport`, THE OTHER HALF OF
 * BOARD ENTRY'S FIX. That hook (`src/lib/use-visual-viewport.ts`) binds a
 * `position: fixed` Radix Sheet/Dialog's `height`/`top` to the visual
 * viewport, because such an overlay does not reflow and Radix's body-scroll
 * lock leaves no way to scroll to its lower content. Every existing call site
 * (board-entry's Sheet, and the create/update-team, invite-player,
 * scoring-system dialogs) is exactly that shape. `/chat` still is not: it is a
 * routed page in normal flow, with no overlay and no scroll lock. Adopting the
 * hook here would mean adopting the `position: fixed` that makes it necessary.
 *
 * THE INPUT IS ONE LINE TALL UNTIL IT NEEDS MORE, WHICH IS THE VISIBLE FIX.
 * It was a bare `<textarea>` — two rows by browser default — beside an `h-10`
 * Button, so the composer read as a form field with a small button stuck to
 * it rather than as a message box. `min-h-10` matches the Button exactly at
 * rest; `useLayoutEffect` below grows it with the text, and `max-h-32` caps it
 * at roughly five lines, past which it scrolls internally instead of eating
 * the conversation above it.
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  /*
    AUTO-GROW, IN A LAYOUT EFFECT RATHER THAN AN onChange HANDLER. It has to run
    on every change to `body`, and `body` is set by two things: typing, and
    `submit` clearing it on a successful send. An onChange-only version would
    leave a five-line box standing empty after the message went.

    `height = '0px'` FIRST IS NOT A FLICKER. `scrollHeight` reports the
    element's CURRENT height when the content is shorter than it, so measuring
    without collapsing first makes the box grow and never shrink — delete three
    lines and it stays three lines tall. Layout effects run before paint, so
    the collapse is never on screen.

    THE CAP AND THE FLOOR ARE CSS, NOT ARITHMETIC HERE. `min-h-10`/`max-h-32`
    clamp the inline height the browser is handed, so there is no second copy of
    either number in JS to drift from the class that paints it — and nothing in
    this effect is a decision worth a test it cannot have.

    `offsetHeight - clientHeight` IS THE BORDER, AND WITHOUT IT THE BOX CLIPS
    ITS OWN LAST LINE BY EXACTLY THAT MUCH. Tailwind's preflight makes every
    element `border-box`, so an assigned `height` has to cover the borders —
    but `scrollHeight` is content plus padding and counts no border at all.
    Assigning it straight across therefore under-sizes the box by the border on
    every single line, which is invisible at one line (the `min-h-10` floor
    hides it) and shaves the descenders off the bottom line at two or more.
    Read rather than hardcoded as `2`, so the class list owns the border width
    the same way it owns the floor and the cap.
  */
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = '0px'
    input.style.height = `${input.scrollHeight + (input.offsetHeight - input.clientHeight)}px`
  }, [body])

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
    // `items-end` so the Button stays on the composer's BOTTOM edge as the
    // input grows upward, which is where a send control belongs; `shrink-0`
    // because this is the fixed-size end of chat.tsx's flex column and the
    // message list above it is the part that gives.
    <form
      className="sticky bottom-0 flex shrink-0 items-end gap-2 border-t bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <textarea
        ref={inputRef}
        rows={1}
        // `rounded-full` AT ONE LINE, which is what makes it read as a message
        // field rather than a form input; it squares off on its own as the text
        // wraps, since the radius cannot exceed half the height.
        // `text-base` IS NOT A STYLE CHOICE: iOS Safari zooms the whole page in
        // when a focused field's font-size is under 16px, and it does not zoom
        // back out. `leading-5` with `py-2` and a 1px border is what lands one
        // line on exactly 40px — the `h-10` of the Button beside it.
        //
        // `rounded-full` AT ONE LINE, which is what makes it read as a message
        // field rather than a form input; it squares off on its own as the text
        // wraps, since the radius cannot exceed half the height.
        className="max-h-32 min-h-10 flex-1 resize-none overflow-y-auto rounded-full border bg-background px-4 py-2 text-base leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
