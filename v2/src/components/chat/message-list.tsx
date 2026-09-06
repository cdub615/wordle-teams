import { useState } from 'react'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import type { ChatMessage } from './use-chat-sync.ts'
import type { Id } from '../../../convex/_generated/dataModel'

type Props = {
  messages: Array<ChatMessage>
  nameFor: (playerId: Id<'players'>) => string
  onDelete?: (id: Id<'chatMessages'>) => void
  canDelete: (message: ChatMessage) => boolean
}

/**
 * Messages oldest-first, newest at the bottom — the server already returns
 * them in that order, so nothing here re-sorts.
 *
 * A DEPARTED AUTHOR RENDERS AS "Former member". Messages survive their author
 * leaving a team, deliberately, so the conversation stays readable; see the
 * design's section 7. `nameFor` is what resolves that.
 *
 * DELETE IS GUARDED BY ConfirmPopover, the same shared component
 * current-team-card.tsx and my-teams-card.tsx use for their own destructive
 * actions. `deleteMessageFor` (convex/chat.ts) is a hard delete with no
 * tombstone — deliberately, since a tombstone would occupy a slot in the
 * loaded window and be re-read forever — so a misclick here is unrecoverable.
 * A bare button was not enough of a guard for that.
 *
 * STILL PRESENTATIONAL: this component owns only which row's popover is
 * open, a UI-only concern local to the list. It has no mutation of its own —
 * `onConfirm` calls the `onDelete` prop and closes the popover immediately,
 * fire-and-forget. Nothing here tracks whether that delete actually
 * succeeded; failures surface as a toast from whoever passed `onDelete` in
 * (see routes/chat.tsx), and the message itself simply stays on screen until
 * the server-confirmed window says otherwise.
 */
export function MessageList({ messages, nameFor, onDelete, canDelete }: Props) {
  const [openId, setOpenId] = useState<Id<'chatMessages'> | null>(null)

  if (messages.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No messages yet. Say something.</p>
  }
  return (
    <ol className="flex flex-col gap-3 p-4" data-testid="chat-messages">
      {messages.map((message) => (
        <li key={message._id} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{nameFor(message.playerId)}</span>
          <span className="whitespace-pre-wrap break-words">{message.body}</span>
          {onDelete && canDelete(message) ? (
            <ConfirmPopover
              open={openId === message._id}
              onOpenChange={(open) => setOpenId(open ? message._id : null)}
              trigger={
                <button
                  type="button"
                  className="self-start text-xs text-muted-foreground underline"
                >
                  Delete
                </button>
              }
              message="Delete this message? This can't be undone."
              confirmLabel="Delete"
              pending={false}
              onConfirm={() => {
                onDelete(message._id)
                setOpenId(null)
              }}
            />
          ) : null}
        </li>
      ))}
    </ol>
  )
}
