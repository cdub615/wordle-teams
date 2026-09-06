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
 */
export function MessageList({ messages, nameFor, onDelete, canDelete }: Props) {
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
            <button
              type="button"
              className="self-start text-xs text-muted-foreground underline"
              onClick={() => onDelete(message._id)}
            >
              Delete
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
