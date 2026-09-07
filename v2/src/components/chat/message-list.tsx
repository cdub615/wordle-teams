import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import {
  anchoredScrollTop,
  isAtTop,
  isNearBottom,
  messageRows,
  shouldShowLoadOlder,
} from './use-chat-sync.ts'
import type { ChatMessage } from './use-chat-sync.ts'
import type { Id } from '../../../convex/_generated/dataModel'

type Props = {
  messages: Array<ChatMessage>
  nameFor: (playerId: Id<'players'>) => string
  // WHOSE MESSAGES GO ON THE RIGHT, IN GREEN. `undefined` is "getMyPlayerId has
  // not answered yet" and `null` is its real "no player" answer; both mean no
  // message is claimed as yours, which is a first-paint flicker rather than a
  // wrong claim. See `messageRows`.
  myPlayerId?: Id<'players'> | null
  // A PROMISE THAT REJECTS ON FAILURE, not a fire-and-forget void callback.
  // That rejection is the only signal this component has for "did the delete
  // actually happen" — see the pending/close-on-success note below. The
  // caller (routes/chat.tsx) still owns the toast; rejecting here is purely
  // this component's cue to leave the confirm open rather than a duplicate
  // error report.
  onDelete?: (id: Id<'chatMessages'>) => Promise<void>
  canDelete: (message: ChatMessage) => boolean
  // Absent — not merely inert — once there is nothing older to fetch, which is
  // how the control retires itself: the route stops passing it after a page
  // comes back empty. See nextOlderOutcome in use-chat-sync.ts.
  onLoadOlder?: () => void
  loadingOlder?: boolean
  // How many messages the LIVE window came back with, which is not
  // `messages.length` once a scrollback page has been merged in. A short
  // window is proof there is no history behind it; see shouldShowLoadOlder.
  windowLength: number
}

/**
 * Messages oldest-first, newest at the bottom — the server already returns
 * them in that order, so nothing here re-sorts.
 *
 * THIS IS THE PAGE'S SCROLL CONTAINER NOW, WHICH IS THE SHAPE CHANGE. It used
 * to be a plain block in a document that scrolled as a whole, so the composer
 * scrolled with it and the newest message sat wherever the browser had left
 * the page. routes/chat.tsx now bounds the route to the viewport and this is
 * the one part of it that gives; the composer below is fixed-size.
 *
 * IT OPENS AT THE NEWEST MESSAGE AND FOLLOWS ARRIVALS — but only from near
 * the bottom. `isNearBottom` is checked BEFORE each update is painted, so
 * someone who has scrolled up to read an hour-old exchange is left exactly
 * where they are when a teammate types. Chat had neither behaviour before
 * this: it opened at the TOP of the oldest loaded message and never moved
 * again.
 *
 * `data-scroll-container` IS LOAD-BEARING IN THE INSTALLED PWA, not decoration.
 * PullToRefresh arms on any downward drag while `window.scrollY <= 0` — and on
 * this route the page never scrolls, so `scrollY` is permanently 0. Without
 * this attribute (SCROLL_CONTAINER_SELECTOR, lib/pull-to-refresh.ts) every
 * attempt to scroll back through the conversation would reload the app
 * instead. The scores table and TeamBoards' carousel carry it for the same
 * reason.
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
 *
 * "LOAD OLDER" IS DISABLED IN FLIGHT, AND THAT IS NOT COSMETIC. `olderMessages`
 * is a MUTATION rather than a query — it is the one read that charges the
 * bandwidth meter, which a Convex query cannot do because queries cannot write
 * — and it is rate-limited to ten pages per player per team per minute. A
 * double-click spends two of those ten on one page of history. Worse, the two
 * overlapping requests contend on the caller's own `chatReads` row, which
 * `sendMessageFor`, `markReadFor` and `olderMessagesFor` all write, costing an
 * OCC retry. `disabled` is the whole guard; there is no server-side
 * de-duplication behind it.
 *
 * THE CONTROL IS ABSENT, NOT DISABLED, WHEN THERE IS NOTHING TO LOAD — the
 * route withholds `onLoadOlder` in that case — AND NOW ALSO WHEN THE READER IS
 * NOT AT THE TOP. It used to be rendered unconditionally, above the newest
 * messages, which is the part of a conversation everyone actually reads.
 * `shouldShowLoadOlder` is the whole of that rule and is tested; nothing about
 * it is decided in the JSX below.
 *
 * THE BUBBLES ARE DECIDED ENTIRELY BY `messageRows`, AND THAT IS THE POINT.
 * Which side a message sits on, whether its author is named, whether it carries
 * a tail, whether a time separator interrupts above it — every one of those is
 * the kind of decision that gets written inline in the `.map` below, and this
 * repo's suite runs on edge-runtime with no DOM and collects `*.test.ts` only,
 * so a decision made in this file is a decision asserted by nothing. Everything
 * below is a className hanging off a boolean somebody else computed.
 */
export function MessageList({
  messages,
  nameFor,
  myPlayerId,
  onDelete,
  canDelete,
  onLoadOlder,
  loadingOlder,
  windowLength,
}: Props) {
  const [openId, setOpenId] = useState<Id<'chatMessages'> | null>(null)
  const [pendingId, setPendingId] = useState<Id<'chatMessages'> | null>(null)

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  // A REF, NOT STATE, AND THAT IS THE POINT. This is read by the layout effect
  // below at the moment a new message is about to be painted, and re-rendering
  // on every scroll frame to keep a piece of state current would cost a render
  // per frame for a value nothing paints. `atTop` IS state, because the button
  // it gates is painted.
  //
  // STARTS `true`, so the first window loads scrolled to the newest message
  // rather than to the oldest one the browser happened to lay out first.
  const followRef = useRef(true)
  const [atTop, setAtTop] = useState(false)

  /*
    WHERE THE READER WAS STANDING WHEN THEY ASKED FOR HISTORY (wordle-teams-9ozu).

    CAPTURED AT THE CLICK, WHICH IS THE ONLY MOMENT THE "BEFORE" EXISTS. By the
    time the layout effect below runs, React has already committed the taller
    list into the DOM and the pre-prepend `scrollHeight` is gone — there is
    nothing left to measure. The click is also the only thing that can cause a
    prepend, so there is no case where a prepend happens with no anchor.

    THE OLDEST `_id` IS STORED WITH IT AS THE PROOF THAT A PREPEND ACTUALLY
    HAPPENED, and both halves of that check are needed. A page that comes back
    EMPTY leaves this anchor set with nothing to apply it to; the list can later
    change for unrelated reasons (a delete slides the live window, dropping its
    oldest message), and applying a stale height delta then would throw the
    reader somewhere arbitrary. So the effect requires the oldest message to
    have CHANGED and the one that was oldest to still be PRESENT — which is
    exactly the signature of "content was inserted above" and is not the
    signature of "the window slid".
  */
  const prependAnchor = useRef<{
    scrollTop: number
    scrollHeight: number
    oldestId: Id<'chatMessages'> | null
  } | null>(null)

  const readPosition = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const position = {
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    }
    followRef.current = isNearBottom(position)
    setAtTop(isAtTop(position))
  }, [])

  /*
    useLayoutEffect, NOT useEffect, AND THE DIFFERENCE IS VISIBLE. This runs
    after React has committed the new message to the DOM but BEFORE the browser
    paints, so the jump to the bottom never appears as a frame showing the old
    position. With useEffect the reader sees the list at its previous scroll
    offset for one frame and then a lurch.

    `followRef` IS ALREADY THE ANSWER FROM BEFORE THIS UPDATE, which is the
    only reason the "don't yank the reader" half works: by the time this runs,
    the taller content is committed and measuring now would say "not near the
    bottom" for everyone, follower or not. The value was recorded by the last
    scroll event, when it was still a fact about where the reader had put
    themselves.

    THE PREPEND BRANCH COMES FIRST AND RETURNS, BEATING `followRef`. The two can
    both be true at once and they want opposite things: a conversation shorter
    than its own panel is "near the bottom" by definition (`isNearBottom`'s last
    case) AND at its top, so loading history into it would otherwise scroll the
    reader to the newest message — the exact opposite of what they just asked
    for. Holding their place is the stronger claim, because they made it with a
    click.

    `readPosition()` AFTERWARDS keeps `atTop` honest across an update that
    changes the geometry without a scroll event — a delete shortening the list,
    the first window arriving into an empty panel, or the prepend above, which
    moves the reader off the top and must retire the "Load older" button until
    they scroll back up to it. None of those fires `onScroll`.
  */
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const anchor = prependAnchor.current
    if (anchor !== null && anchor.oldestId !== null) {
      const oldest = messages.length === 0 ? null : messages[0]._id
      const prepended =
        oldest !== anchor.oldestId &&
        scroller.scrollHeight > anchor.scrollHeight &&
        messages.some((message) => message._id === anchor.oldestId)
      if (prepended) {
        prependAnchor.current = null
        scroller.scrollTop = anchoredScrollTop(anchor, scroller.scrollHeight)
        readPosition()
        return
      }
    }

    if (followRef.current) scroller.scrollTop = scroller.scrollHeight
    readPosition()
  }, [messages, readPosition])

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

  const handleLoadOlder = () => {
    const scroller = scrollerRef.current
    if (scroller) {
      prependAnchor.current = {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        oldestId: messages.length === 0 ? null : messages[0]._id,
      }
    }
    onLoadOlder?.()
  }

  const showLoadOlder = shouldShowLoadOlder({
    canLoadOlder: onLoadOlder !== undefined,
    windowLength,
    atTop,
  })

  /*
    `Date.now()` AT RENDER, NOT PINNED IN STATE, so "Today" stops being today at
    midnight in a tab that has been open all evening rather than at the next
    remount.

    IT IS NOT A HYDRATION HAZARD HERE, WHICH IS THE ONLY REASON IT IS SAFE.
    `useChatMessages` starts at `[]` and fills in from an effect, so the server
    renders the empty state and no separator label is produced on that side at
    all — there is no server string for a client one to disagree with.

    THE ZONE AND THE LOCALE ARE BOTH THE HOST'S, DELIBERATELY (the two omitted
    arguments). "Today" can only honestly mean the reader's own day, and
    "2:05 PM" versus "14:05" can only honestly mean the reader's own
    convention; the parameters exist so the tests can pin them, not so the app
    can choose. Passing either explicitly here would be this file deciding
    something about a reader it knows nothing about — which is exactly the bug
    the pinned `hourCycle: 'h23'` was: it stamped 14:00 on an American phone.
  */
  const rows = messageRows(messages, myPlayerId, Date.now())

  return (
    // `min-h-0` IS WHAT MAKES `flex-1` ACTUALLY BOUND THIS BOX. A flex item's
    // default `min-height: auto` is its content, so without it this grows to
    // fit every message, the shell overflows, and the composer is pushed off
    // the bottom of the viewport — the exact layout this replaces. Same pairing
    // board-entry/form.tsx uses for its own scrolling middle.
    <div
      ref={scrollerRef}
      onScroll={readPosition}
      data-scroll-container
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {showLoadOlder ? (
        <button
          type="button"
          className="self-center p-2 text-xs underline disabled:opacity-50"
          onClick={handleLoadOlder}
          disabled={loadingOlder}
          data-testid="chat-load-older"
        >
          {loadingOlder ? 'Loading…' : 'Load older messages'}
        </button>
      ) : null}
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">No messages yet. Say something.</p>
      ) : (
        // `mt-auto` PINS A SHORT CONVERSATION TO THE BOTTOM of the panel rather
        // than leaving it stranded at the top under a screen of empty space,
        // which is where every chat client puts it and where the composer
        // expects it to grow from. It does nothing once the list is taller than
        // the panel.
        //
        // NO `gap` ANY MORE: the spacing between two bubbles is not one number.
        // Inside a run it is hairline (`mt-0.5`) so the bubbles read as one
        // utterance; between runs it is a real break (`mt-3`). A gap would add
        // itself to both.
        <ol className="mt-auto flex flex-col p-4" data-testid="chat-messages">
          {rows.map((row) => (
            <li
              key={row.message._id}
              className={`flex flex-col ${
                row.separator !== null ? 'mt-1' : row.startsRun ? 'mt-3' : 'mt-0.5'
              } ${row.mine ? 'items-end' : 'items-start'} first:mt-0`}
            >
              {/* CENTRED ACROSS THE WHOLE LIST, WHICH `w-full` IS WHAT BUYS —
                  the row it sits in is aligned to one edge or the other for the
                  bubble's sake, and a separator inherited into that alignment
                  would sit under the last bubble rather than across the
                  conversation. */}
              {row.separator !== null ? (
                <span className="w-full py-2 text-center text-xs text-muted-foreground">
                  {row.separator}
                </span>
              ) : null}
              {/* ONCE PER RUN, AND NEVER OVER YOUR OWN — see showsAuthorName.
                  `px-3` lines it up with the bubble's own padding rather than
                  with the bubble's edge, so the name sits over the first
                  character of the message. */}
              {row.showsName ? (
                <span className="px-3 pb-0.5 text-xs text-muted-foreground">
                  {nameFor(row.message.playerId)}
                </span>
              ) : null}
              {/*
                THE BUBBLE. `bg-accent-solid`, NOT `bg-primary` — the same call
                today-panel.tsx's progress fill and unread-badge.tsx's dot both
                made (wordle-teams-5jcn.21): `--primary` maps to `--text`, which
                is near-white in dark, so "my messages" painted with it would be
                a column of white slabs rather than the brand green. The
                foreground is the token minted for exactly this pairing,
                `--accent-solid-foreground`: #ffffff on #15803d is 5.00:1 in
                light and #052e16 on #22c55e is 6.54:1 in dark, both clear of
                AA, and both measured out of styles.css by styles.test.ts rather
                than quoted here and left to rot.

                THE OTHER SIDE IS `bg-muted text-foreground`, the app's neutral
                band — `--surface-sunken`, the dark grey iMessage uses for the
                other person in dark mode and the light grey it uses in light.
                That pairing is already asserted at AA by styles.test.ts's
                `--text on --surface-sunken`.

                THE TAIL IS A FLATTENED CORNER ON THE LAST BUBBLE OF A RUN, on
                the side the run is aligned to — which is what iMessage draws and
                what makes a run read as one utterance with an end rather than as
                a stack of separate arrivals. Done with a border radius rather
                than a pseudo-element on purpose: a pointer hung off the side of
                a bubble is one more thing that can stick out past a 390px
                viewport, and this route already has to be measured for
                horizontal overflow.

                `max-w-[75%]` IS THE OTHER HALF OF "THIS READS AS A
                CONVERSATION". A bubble that spans the full width has no side to
                be on, so the alignment that identifies the author disappears on
                exactly the long messages where it is most needed.
              */}
              <div
                className={`max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                  row.mine
                    ? `bg-accent-solid text-accent-solid-foreground ${row.endsRun ? 'rounded-br-sm' : ''}`
                    : `bg-muted text-foreground ${row.endsRun ? 'rounded-bl-sm' : ''}`
                }`}
              >
                {row.message.body}
              </div>
              {onDelete && canDelete(row.message) ? (
                // THE TRIGGER ITSELF IS UNTOUCHED — part 3 replaces the whole
                // affordance with a long-press menu, so changing it here would
                // be work done twice. It gains only a row to sit in, which puts
                // it under the bubble it belongs to instead of at the far side
                // of the list: the button's own `self-start` is an align-self,
                // so in a ROW it acts on the cross axis and moves nothing
                // horizontally.
                <div className={`flex w-full ${row.mine ? 'justify-end' : 'justify-start'}`}>
                  <ConfirmPopover
                    open={openId === row.message._id}
                    onOpenChange={(open) => setOpenId(open ? row.message._id : null)}
                    trigger={
                      <button
                        type="button"
                        className="self-start text-xs text-muted-foreground underline"
                        aria-label={`Delete message from ${nameFor(row.message.playerId)}`}
                      >
                        Delete
                      </button>
                    }
                    message="Delete this message? This can't be undone."
                    confirmLabel="Delete"
                    pending={pendingId === row.message._id}
                    onConfirm={() => void handleConfirm(row.message._id)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
