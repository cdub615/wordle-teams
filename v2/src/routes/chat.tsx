import { createFileRoute, redirect } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useChatMessages, useChatPointer } from '#/components/chat/use-chat-sync.ts'
import type { ChatMessage } from '#/components/chat/use-chat-sync.ts'
import { MessageList } from '#/components/chat/message-list.tsx'
import { Composer } from '#/components/chat/composer.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
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

function ChatPanel({ teamId }: { teamId: Id<'teams'> }) {
  const pointer = useChatPointer(teamId)
  const { messages } = useChatMessages(teamId)
  const { data: teams } = useQuery(convexQuery(api.teams.getMyTeams, {}))
  const { data: myPlayerId } = useQuery(convexQuery(api.scores.getMyPlayerId, {}))
  const deleteMessage = useMutation({ mutationFn: useConvexMutation(api.chat.deleteMessage) })
  const sendMessage = useMutation({ mutationFn: useConvexMutation(api.chat.send) })

  if (pointer.isPending) return <p className="p-4">Loading…</p>
  if (pointer.error) return <p className="p-4">Could not load chat.</p>

  const team = teams?.find((candidate) => candidate.id === teamId)

  // A PLAYER ID NOT AMONG CURRENT MEMBERS RENDERS AS "Former member" —
  // documented behaviour, not a fallback: messages deliberately outlive their
  // author leaving the team (see message-list.tsx). "Not loaded yet" is NOT
  // the same claim: `team` is undefined for the few renders before
  // getMyTeams resolves, and "Former member" is a factual statement about
  // membership, not a placeholder — saying it about a live teammate because a
  // query has not settled would be a lie the UI tells for a few hundred
  // milliseconds. That case renders an empty name instead.
  const nameFor = (playerId: Id<'players'>): string => {
    if (!team) return ''
    const member = team.members.find((candidate) => candidate.id === playerId)
    return member ? `${member.firstName} ${member.lastName}` : 'Former member'
  }

  // Mirrors the server rule in deleteMessageFor (convex/chat.ts): the author
  // may delete their own message, and the team's owner may delete any.
  //
  // `myPlayerId === undefined` GUARDS THE SAME GAP `nameFor` HAD, on the
  // other query: getMyPlayerId resolves independently of getMyTeams, and
  // TanStack leaves `data` `undefined` until it does — `null` is its real
  // "no player" answer, so comparing an unloaded `undefined` against
  // `message.playerId` would just happen to read `false` and hide a
  // non-owner's own Delete control for a moment, rather than assert
  // something false the way an unloaded `nameFor` would. Milder, but the
  // same root cause, so it gets the same explicit "not loaded yet" branch.
  const canDelete = (message: ChatMessage): boolean => {
    if (!team || myPlayerId === undefined) return false
    return team.isOwner || message.playerId === myPlayerId
  }

  // REJECTS ON FAILURE RATHER THAN SWALLOWING THE ERROR, which is what makes
  // MessageList's close-on-success behaviour possible: it is this promise's
  // rejection that tells the confirm popover to stay open instead of closing
  // as if the delete had gone through. The toast still fires here, once,
  // regardless of who is awaiting the rejection.
  const handleDelete = async (messageId: Id<'chatMessages'>): Promise<void> => {
    try {
      await deleteMessage.mutateAsync({ messageId })
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not delete that message'))
      throw error
    }
  }

  // REJECTS ON FAILURE, exactly like handleDelete above — the composer awaits
  // this and relies on the rejection to know the send failed, which is what
  // keeps the typed text in the textarea instead of clearing it.
  const handleSend = async (body: string): Promise<void> => {
    try {
      await sendMessage.mutateAsync({ teamId, body })
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not send that message'))
      throw error
    }
  }

  return (
    <>
      <MessageList
        messages={messages}
        nameFor={nameFor}
        canDelete={canDelete}
        onDelete={(messageId) => handleDelete(messageId)}
      />
      <Composer onSend={handleSend} />
    </>
  )
}
