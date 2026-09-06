import { createFileRoute, redirect } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  beforeForOlder,
  mergeOlder,
  nextOlderOutcome,
  useChatMessages,
  useChatPointer,
} from '#/components/chat/use-chat-sync.ts'
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

  // SCROLLBACK IS HELD HERE, DELIBERATELY APART FROM `useChatMessages`. That
  // hook's `window` action replaces its whole array on every delete and on
  // every coalesced update, so history merged into it would be thrown away by
  // the next refetch — the user's loaded pages vanishing for a reason they
  // cannot see. `mergeOlder` puts the two halves back together at render time
  // and drops the one message that can legitimately appear in both.
  const [olderPages, setOlderPages] = useState<Array<ChatMessage>>([])
  const [atStart, setAtStart] = useState(false)
  const loadOlder = useMutation({ mutationFn: useConvexMutation(api.chat.olderMessages) })

  // Scrollback belongs to ONE team, and `teamId` is a prop, not a remount:
  // `/chat?team=<id>` is a search param, so navigating between two teams
  // re-renders this component rather than replacing it, and team A's history
  // would otherwise stay on screen under team B's live window.
  // `useChatMessages` resets its own refs for exactly this reason; this is the
  // same hazard on the half of the state it does not own.
  //
  // THE REF IS THE OTHER HALF OF THE SAME RESET, and it is not redundant with
  // clearing the state. A scrollback page already in flight when the switch
  // happens resolves AFTER this has run, and its `setOlderPages` would then
  // splice team A's history into team B's list — the emptied array does
  // nothing to stop a later write to it. `handleLoadOlder` reads this ref on
  // resolve and drops a page that no longer belongs to the team on screen,
  // the same job `requestId` does for a superseded fetch inside
  // `useChatMessages`.
  const shownTeamId = useRef(teamId)
  useEffect(() => {
    shownTeamId.current = teamId
    setOlderPages([])
    setAtStart(false)
  }, [teamId])

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

  const shown = mergeOlder(olderPages, messages)
  const before = beforeForOlder(shown)

  // DOES NOT RETHROW, unlike handleDelete and handleSend above, and the
  // difference is the caller rather than the policy: `onLoadOlder` is a plain
  // `() => void`, so nothing awaits this. Rethrowing would only raise an
  // unhandled rejection. There is also nothing for a child to decide here —
  // the composer keeps its text and the confirm popover stays open on a
  // rejection, but a page that did not arrive simply leaves the list as it was.
  //
  // ON SCROLL_RATE_LIMITED IT DOES NOT RETRY. `mutationErrorMessage` maps that
  // code to its own copy ("You're scrolling back very quickly…") rather than
  // the generic fallback, and an automatic retry would spend another of the
  // ten pages a minute the caller has just run out of.
  const handleLoadOlder = async (): Promise<void> => {
    if (before === null) return
    try {
      const page = await loadOlder.mutateAsync({ teamId, before })
      if (shownTeamId.current !== teamId) return
      const outcome = nextOlderOutcome(olderPages, page)
      if (outcome.kind === 'start') setAtStart(true)
      else setOlderPages(outcome.pages)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not load older messages'))
    }
  }

  return (
    <>
      <MessageList
        messages={shown}
        nameFor={nameFor}
        canDelete={canDelete}
        onDelete={(messageId) => handleDelete(messageId)}
        // WITHHELD, NOT DISABLED, once history runs out or before anything is
        // held to page back from — MessageList renders no control at all
        // without it. A greyed-out button would claim there is more history
        // behind a rate limit.
        onLoadOlder={atStart || before === null ? undefined : () => void handleLoadOlder()}
        // TanStack's own in-flight flag rather than a second copy of it in
        // useState: it is set before the request goes out and cleared however
        // the promise settles, which is exactly the window the button must be
        // disabled for and one fewer try/finally to get wrong.
        loadingOlder={loadOlder.isPending}
      />
      <Composer onSend={handleSend} />
    </>
  )
}
