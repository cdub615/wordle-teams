import { createFileRoute, redirect } from '@tanstack/react-router'
import { convexQuery } from '@convex-dev/react-query'
import { useChatPointer } from '#/components/chat/use-chat-sync.ts'
import { pageTitle } from '#/lib/seo'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

type ChatSearch = { team?: string }

export const Route = createFileRoute('/chat')({
  head: () => ({ meta: [{ title: pageTitle('Chat') }] }),
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    team: typeof search.team === 'string' ? search.team : undefined,
  }),
  /**
   * WITHOUT THIS, THE ROUTE WAS REACHABLE AND BROKEN, not merely unguarded.
   * `useChatPointer` calls `api.chat.pointer`, which calls `requirePlayer` on
   * the server — and that throws for two different visitors this route would
   * otherwise let through: someone with no session at all, and someone
   * signed in but without a player row yet (mid sign-up, before
   * complete-profile). Both landed on `ChatPanel`'s bare "Could not load
   * chat." — a dead end, not a path anywhere. Every sibling that touches
   * player-scoped Convex data (`/app`, `/team`) already redirects both cases
   * before rendering; this route is not exempt from that just because it
   * predates the rest of chat.
   */
  beforeLoad: async ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: '/login' })
    const needsProfile = await context.queryClient.ensureQueryData(
      convexQuery(api.players.needsProfile, {}),
    )
    if (needsProfile) throw redirect({ to: '/complete-profile' })
  },
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
