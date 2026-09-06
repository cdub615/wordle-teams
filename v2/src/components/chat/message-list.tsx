import { useState } from 'react'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import type { ChatMessage } from './use-chat-sync.ts'
import type { Id } from '../../../convex/_generated/dataModel'

type Props = {
  messages: Array<ChatMessage>
  nameFor: (playerId: Id<'players'>) => string
  // A PROMISE THAT REJECTS ON FAILURE, not a fire-and-forget void callback.
  // That rejection is the only signal this component has for "did the delete
  // actually happen" — see the pending/close-on-success note below. The
  // caller (routes/chat.tsx) still owns the toast; rejecting here is purely
  // this component's cue to leave the confirm open rather than a duplicate
  // error report.
  onDelete?: (id: Id<'chatMessages'>) => Promise<void>
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
 * STILL PRESENTATIONAL, BUT NOW WITH REAL PENDING STATE — following
 * current-team-card.tsx's own contract for its ConfirmPopover uses, not the
 * lighter one this file started with. The first version closed the popover
 * immediately on click and hardcoded `pending={false}`, which meant nothing
 * disabled the confirm button while the mutation was in flight: a fast
 * double-click fired `deleteMessage` twice, the second call found the
 * message already gone, and the resulting NOT_A_MEMBER error reported a
 * SUCCESSFUL delete as failed — worse than either outcome alone, since it
 * tells the user their action didn't work when it did. `pendingId` disables
 * the trigger for the row in flight, and the popover closes only once
 * `onDelete`'s promise resolves; a rejection leaves it open, sitting next to
 * whatever toast the caller raised, exactly like current-team-card's
 * `handleRemove`.
 */
export function MessageList({ messages, nameFor, onDelete, canDelete }: Props) {
  const [openId, setOpenId] = useState<Id<'chatMessages'> | null>(null)
  const [pendingId, setPendingId] = useState<Id<'chatMessages'> | null>(null)

  if (messages.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No messages yet. Say something.</p>
  }

  const handleConfirm = async (messageId: Id<'chatMessages'>) => {
    if (!onDelete) return
    setPendingId(messageId)
    try {
      await onDelete(messageId)
      setOpenId(null)
    } catch {
      // Left open deliberately: the caller already surfaced a toast, and
      // closing here would tell the user the delete succeeded when it may
      // not have.
    } finally {
      setPendingId(null)
    }
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
                  aria-label={`Delete message from ${nameFor(message.playerId)}`}
                >
                  Delete
                </button>
              }
              message="Delete this message? This can't be undone."
              confirmLabel="Delete"
              pending={pendingId === message._id}
              onConfirm={() => void handleConfirm(message._id)}
            />
          ) : null}
        </li>
      ))}
    </ol>
  )
}
