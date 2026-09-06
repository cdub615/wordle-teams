import { createFileRoute } from '@tanstack/react-router'
import { useChatPointer } from '#/components/chat/use-chat-sync.ts'
import { pageTitle } from '#/lib/seo'
import type { Id } from '../../convex/_generated/dataModel'

type ChatSearch = { team?: string }

export const Route = createFileRoute('/chat')({
  head: () => ({ meta: [{ title: pageTitle('Chat') }] }),
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
  }),
  component: ChatRoute,
})

function ChatRoute() {
  const { team } = Route.useSearch()
  if (!team) return <p className="p-4">No team selected.</p>
  return <ChatPanel teamId={team as Id<'teams'>} />
}

/**
 * DELIBERATELY MINIMAL FOR NOW. Task 2 needs exactly one thing from this
 * screen: a live pointer subscription whose value is visible, so two browsers
 * can be watched side by side. The message list, composer and scrollback are
 * Tasks 3-5 and must not be built here.
 */
function ChatPanel({ teamId }: { teamId: Id<'teams'> }) {
  const pointer = useChatPointer(teamId)
  if (pointer.isPending) return <p className="p-4">Loading…</p>
  if (pointer.error) return <p className="p-4">Could not load chat.</p>
  return (
    <pre className="p-4 text-xs" data-testid="chat-pointer">
      {JSON.stringify(pointer.data, null, 2)}
    </pre>
  )
}
