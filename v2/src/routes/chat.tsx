import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  beforeForOlder,
  chatHeading,
  mergeOlder,
  nextOlderOutcome,
  useChatMessages,
  useChatPointer,
} from '#/components/chat/use-chat-sync.ts'
import type { ChatMessage } from '#/components/chat/use-chat-sync.ts'
import { MessageList } from '#/components/chat/message-list.tsx'
import { Composer } from '#/components/chat/composer.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
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

/**
 * THE WAY OUT, AND THE ANSWER TO "WHICH TEAM AM I IN". Until this, /chat
 * rendered the global header, the message list and the composer, and nothing
 * else: no route back to the app but the browser's own button, and no mention
 * anywhere of whose conversation was on screen. The push notification's body is
 * "New messages in TEAMNAME", so the one visitor most likely to arrive here
 * cold was the one given the least to orient by.
 *
 * THE SHAPE IS routes/team.tsx'S, NOT A NEW ONE. That is the app's other
 * team-scoped page and it already answers this exact problem — a ghost
 * icon-Button wrapping a Link with an ArrowLeft and an `aria-label`, then the
 * page's `h1` beside it. Copied down to the label wording ("Back to
 * dashboard"), because two team-scoped pages that go back differently is a
 * worse outcome than either shape on its own.
 *
 * `search={{ team: teamId }}` IS THE POINT OF THE CONTROL. A bare `to="/app"`
 * would land on whatever team the dashboard defaults to, which for someone who
 * followed a notification into a SECOND team is the wrong one — and silently
 * so, since /app's own search sync would then rewrite the URL to match.
 *
 * THE HEADING RENDERS IN ALL THREE OF `chatHeading`'S STATES and asserts a
 * name in only one of them. `pending` gets a Skeleton — the app's own idiom
 * everywhere else — plus screen-reader-only text, so the page still has a
 * named `h1` rather than an empty one for the few hundred milliseconds before
 * getMyTeams answers. `unnamed` gets the generic "Team chat": that is the
 * outsider case as well as the stale-link one, and the team whose messages
 * someone may not read is a team whose NAME they may not have either.
 */
function ChatHeader({
  teamId,
  heading,
}: {
  teamId: Id<'teams'>
  heading: ReturnType<typeof chatHeading>
}) {
  return (
    <div className="flex items-center gap-2 border-b p-3">
      <Button variant="ghost" size="icon" aria-label="Back to dashboard" asChild>
        <Link to="/app" search={{ team: teamId }}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
      {/* `truncate` FOR THE SAME REASON TeamPicker'S LABEL HAS IT: a team name
          is someone's data, not a fixed string, and a long one on a 390px
          phone would otherwise push this row wider than the viewport. */}
      <h1 className="truncate text-xl font-bold">
        {heading.kind === 'named' ? (
          heading.name
        ) : heading.kind === 'unnamed' ? (
          'Team chat'
        ) : (
          <>
            <Skeleton className="h-6 w-40" />
            <span className="sr-only">Loading team name</span>
          </>
        )}
      </h1>
    </div>
  )
}

/**
 * The app bar's height on a phone, in CSS pixels, used for exactly one frame.
 *
 * MEASURED, NOT CHOSEN: 65px, in headless chromium at 390x844 against the
 * built stylesheet — Header.tsx's `py-3` around a 40px control row, plus its
 * 1px bottom border. It is only ever the SSR guess and the value React
 * hydrates with; `useChatShellHeight` replaces it with the real offset in a
 * layout effect, which runs before the browser paints, so a stale guess is
 * never seen. It exists so the server renders a shell of roughly the right
 * size rather than one a whole app bar too tall.
 */
const HEADER_ESTIMATE_PX = 65

/**
 * Binds the chat shell's height to the viewport, so the PAGE never scrolls and
 * the message list inside it does.
 *
 * WHY A MEASUREMENT AND NOT `h-[calc(100dvh-3.5rem)]`. The height this needs is
 * "the viewport minus whatever chrome is above me", and that chrome is
 * Header.tsx, whose height changes at `sm` (py-3 -> py-4) and again at `md`
 * (text-2xl -> text-3xl wordmark). A hardcoded number would be right on one
 * phone and leave a scrolling page or a clipped composer everywhere else, and
 * it would go quietly wrong the next time the bar gains a control. Reading the
 * shell's OWN document offset asks the question directly and does not care
 * what is above it.
 *
 * `100dvh`, NOT `100vh` OR `100svh`. `dvh` tracks the viewport as mobile
 * browser chrome retracts, which is the only one of the three that is never
 * larger than the space actually available — `100vh` overflows behind Safari's
 * toolbar and puts the composer under it, and `100svh` leaves a strip of dead
 * page when the toolbar is away.
 *
 * IT DOES NOT WATCH THE KEYBOARD, DELIBERATELY. See composer.tsx: the
 * composer stays above the mobile keyboard because the page is in ordinary
 * document flow with nothing scroll-locked and nothing fixed, which lets iOS
 * move the visual viewport to bring the focused field into view. Binding this
 * height to `visualViewport` instead would be the `position: fixed` treatment
 * board entry's Sheet needs, and this page is not that shape.
 */
function useChatShellHeight() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [chrome, setChrome] = useState(HEADER_ESTIMATE_PX)

  // useLayoutEffect for scores-table.tsx's reason and with its known cost: it
  // runs before paint, so the estimate above is corrected without a visible
  // frame at the wrong height, and React logs its "does nothing on the server"
  // notice during SSR. `resize` covers both a rotation and crossing one of
  // Header's breakpoints; nothing else moves this offset, since the element
  // above it is the app bar and the page does not scroll.
  useLayoutEffect(() => {
    const measure = () => {
      const node = ref.current
      if (!node) return
      setChrome(node.getBoundingClientRect().top + window.scrollY)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  return { ref, height: `calc(100dvh - ${chrome}px)` }
}

function ChatPanel({ teamId }: { teamId: Id<'teams'> }) {
  const shell = useChatShellHeight()
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

  // OPENING THE CONVERSATION IS WHAT CLEARS ITS BADGE. `markRead` writes one
  // small row (`chatReads.lastReadAt`) and reads no messages — see markReadFor
  // in convex/chat.ts, which exists as its own call precisely so that the
  // common case, opening a chat, costs almost nothing. `UnreadBadge` is a
  // comparison against that timestamp, so without this the dot would never go
  // out and the badge would be permanent furniture.
  //
  // ON OPEN, NOT ON EVERY ARRIVING MESSAGE, AND THAT IS A DELIBERATE LIMIT
  // RATHER THAN AN OVERSIGHT. Depending this on the pointer's `lastMessageAt`
  // would advance the cursor for each message that lands while the tab is
  // open — a write per message per connected client, on the row that
  // `sendMessageFor`, `markReadFor` and `olderMessagesFor` already contend on.
  // The visible cost of not doing it is narrow: a teammate posting while you
  // are sitting in the conversation leaves a dot on a team you are already
  // looking at, until the next time you open it. Cheap to fix later by adding
  // the pointer to these deps if it turns out to annoy anyone; not worth a
  // per-message write up front.
  //
  // ERRORS ARE SWALLOWED, unlike `handleSend` and `handleLoadOlder` above,
  // because the user did not ask for this. It is a side effect of navigating,
  // and a toast reading "Could not mark read" reports a failure with no action
  // behind it against something nobody requested. A failed call just leaves
  // the dot up, which is the pre-existing state rather than a broken one.
  //
  // `useConvexMutation` is memoised on the client and the function name (see
  // convex/react's useMutation), so it is stable across renders and belongs in
  // the dep array rather than being suppressed out of it.
  const markRead = useConvexMutation(api.chat.markRead)
  useEffect(() => {
    markRead({ teamId }).catch(() => {})
  }, [markRead, teamId])

  // RESOLVED ABOVE THE EARLY RETURNS, NOT BELOW THEM, so the header can render
  // in the pending and error branches too. Those two were the deadest ends of
  // the lot: "Loading…" and "Could not load chat." on a page with no way back
  // and nothing naming the team, which is exactly what an outsider following a
  // stale link saw.
  const team = teams?.find((candidate) => candidate.id === teamId)
  const header = <ChatHeader teamId={teamId} heading={chatHeading(teams, teamId)} />

  /*
    THE SHELL, AND WHY EVERY BRANCH GOES THROUGH IT. This route used to render
    a header, a message list and a composer straight into the document, so the
    PAGE scrolled: the composer sat below however many messages there were and
    scrolled away with them, and the site footer sat below that again. On the
    owner's phone the composer was simply not on screen. Bounding the route to
    the viewport and letting only the message list scroll is the whole of the
    layout change; __root.tsx drops the footer for the same reason
    (`hidesSiteFooter`).

    NO `overflow-hidden` HERE, DELIBERATELY. Nothing can overflow this box —
    MessageList is `min-h-0 flex-1` and the composer is `shrink-0` — so the
    class would buy nothing, and it would make this a scroll container between
    the composer and the document, which is the ingredient that stops iOS
    bringing a focused field above the keyboard. See composer.tsx.

    THE PENDING AND ERROR BRANCHES GET IT TOO, so the two deadest ends on the
    route do not silently reintroduce a scrolling page — and so the header they
    already render sits where it does in the loaded state rather than jumping
    when the pointer resolves.
  */
  const frame = (children: ReactNode) => (
    <div ref={shell.ref} style={{ height: shell.height }} className="flex flex-col">
      {header}
      {children}
    </div>
  )

  if (pointer.isPending) return frame(<p className="p-4">Loading…</p>)
  if (pointer.error) return frame(<p className="p-4">Could not load chat.</p>)

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

  return frame(
    <>
      <MessageList
        messages={shown}
        nameFor={nameFor}
        // THE SAME `undefined` BRANCH `canDelete` GUARDS, handed on rather than
        // resolved here: getMyPlayerId resolves independently of the messages,
        // and `messageRows` reads "not loaded" as "no bubble is mine yet".
        myPlayerId={myPlayerId}
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
        // `messages`, NOT `shown`. This is the LIVE window's size, and its
        // whole job is to answer "did recentMessages come back full" — a short
        // window is proof there is no history behind it, which is what stops
        // the first pointless, metered scrollback request from ever going out.
        // `shown` has scrollback merged into it and crosses RECENT_WINDOW the
        // moment anyone loads a page, so it would answer a different question
        // and always say yes.
        windowLength={messages.length}
      />
      <Composer onSend={handleSend} />
    </>,
  )
}
