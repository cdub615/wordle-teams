import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ConfirmPopover } from '#/components/confirm-popover.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { clockTime } from '#/lib/clock-time.ts'
import { useReducedMotion } from '#/lib/use-reduced-motion.ts'
import {
  anchoredScrollTop,
  dragAxis,
  isAtTop,
  isNearBottom,
  isTouchGesture,
  LONG_PRESS_MS,
  messageRows,
  movedOffPress,
  opensMenuFromKey,
  revealOffset,
  revealSnapBackMs,
  shouldShowLoadOlder,
} from './use-chat-sync.ts'
import type { ChatMessage, DragAxis, MessageRow } from './use-chat-sync.ts'
import type { PointerEvent as ReactPointerEvent } from 'react'
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
 * DELETE IS A LONG PRESS OR A RIGHT-CLICK NOW, NOT A LINK UNDER EVERY BUBBLE —
 * see MessageBubble below, which owns the whole affordance. What is left here
 * is the rule about WHICH bubbles get one: `canDelete`, unchanged, decided by
 * routes/chat.tsx against the same author-or-owner rule the server enforces in
 * deleteMessageFor.
 *
 * THE SWIPE-LEFT TIMESTAMP REVEAL LIVES ON THIS ELEMENT, not on the bubbles.
 * Dragging the list left translates the whole `<ol>` and uncovers a column of
 * per-message times down the right edge — iMessage's gesture, and the reason
 * the list is one transform rather than a hundred is that a conversation that
 * slid bubble by bubble would not read as one sheet of paper moving.
 *
 * IT IS DRIVEN BY REFS AND A DIRECT STYLE WRITE, NOT BY STATE, and that is the
 * same call `followRef` above makes for the same reason: a pointer move fires
 * once per animation frame, and putting the offset in `useState` would
 * re-render every bubble in the conversation on every one of those frames to
 * move one element. Nothing paints the offset except the `<ol>`'s own
 * transform, so nothing needs to re-render for it.
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

  /*
    THE SWIPE-LEFT REVEAL, WHICH IS THREE REFS AND NO STATE.

    `dragRef` HOLDS THE AXIS ONCE IT IS DECIDED, AND THAT IS THE POINT OF
    KEEPING IT AT ALL. `dragAxis` answers about a displacement, not about a
    gesture; asking it again on every move would let a swipe that curls
    downwards at the end turn into a scroll halfway through, and a scroll that
    drifts sideways turn into a swipe. The first unambiguous answer is the
    answer for the rest of the gesture.

    A VERTICAL VERDICT ABANDONS THE DRAG OUTRIGHT rather than being remembered
    and ignored. There is nothing left to do with it: the browser owns the
    scroll from that point (`touch-action: pan-y pinch-zoom` on the list says
    so), and the conversation never moved, so there is nothing to snap back.

    `transition: none` GOES ON AT THE START OF EVERY DRAG, not just after one.
    A finger that lands during the snap-back of the previous swipe would
    otherwise chase a transition it is also fighting, which is the difference
    between a list that follows a thumb and one that lags behind it.
  */
  const listRef = useRef<HTMLOListElement | null>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; axis: DragAxis } | null>(null)
  const reducedMotion = useReducedMotion()

  const slideTo = (offset: number) => {
    const list = listRef.current
    if (!list) return
    // Cleared rather than set to `translate3d(0,...)`: an element with no
    // transform is not a containing block and gets no compositing layer, which
    // is the state the list spends all but a second of its life in.
    list.style.transform = offset === 0 ? '' : `translate3d(${-offset}px, 0, 0)`
  }

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    // THE SAME PORTAL HAZARD `fromTheBubbleItself` GUARDS, one level up: a
    // bubble's menu and its confirmation are React children of this element and
    // DOM children of `document.body`, so a press inside either one arrives
    // here as though the reader had put a finger on the conversation. Asking
    // the DOM rather than comparing targets, because a drag that starts on a
    // bubble IS meant to reach this handler — it is only the portalled
    // subtrees that are not.
    const target = event.target
    if (!(target instanceof Node) || !scrollerRef.current?.contains(target)) return
    if (!isTouchGesture(event.pointerType)) return
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      axis: 'undecided',
    }
    if (listRef.current) listRef.current.style.transition = 'none'
  }

  const trackDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    // The pointer id is checked because a second finger landing mid-gesture
    // reports its own coordinates against the first finger's origin, which
    // would jump the list by the distance between two thumbs.
    if (drag === null || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (drag.axis === 'undecided') {
      drag.axis = dragAxis(dx, dy)
      if (drag.axis === 'vertical') {
        dragRef.current = null
        return
      }
      if (drag.axis === 'undecided') return
    }
    slideTo(revealOffset(dx))
  }

  const endDrag = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag === null || drag.axis !== 'horizontal') return
    const list = listRef.current
    if (!list) return
    const duration = revealSnapBackMs(reducedMotion)
    list.style.transition = duration === 0 ? 'none' : `transform ${duration}ms ease-out`
    slideTo(0)
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
    // `overflow-x-hidden` IS WHAT THE SWIPE REVEAL NEEDS AND IT IS NOT THE
    // `overflow: hidden` PARTS 1 AND 2 REFUSED. That refusal was about the
    // SHELL (routes/chat.tsx) and the document: a scroll container between the
    // composer and the page is what stops iOS lifting a focused field above the
    // keyboard. This element was already a scroll container — it is the one
    // part of the route that scrolls — so clipping its other axis changes
    // nothing about that. What it does change is that the timestamps parked at
    // `left-full`, and the list translated left over them, are CLIPPED rather
    // than turned into horizontal overflow: without it a box with
    // `overflow-y: auto` computes `overflow-x: auto`, and a 390px phone would
    // grow a horizontal scrollbar over content nobody can reach.
    <div
      ref={scrollerRef}
      onScroll={readPosition}
      onPointerDown={beginDrag}
      onPointerMove={trackDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      data-scroll-container
      className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
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
        //
        // `touch-action: pan-y pinch-zoom` IS THE AXIS LOCK'S OTHER HALF, AND
        // IT IS DECLARED HERE RATHER THAN NEGOTIATED IN JAVASCRIPT. It tells
        // the browser that a touch starting in the conversation may scroll it
        // vertically and may pinch it, and may do nothing else — so a
        // horizontal drag is never claimed for a native scroll and the pointer
        // events keep arriving for `trackDrag` to read. Without it the browser
        // decides on its own heuristic and fires `pointercancel` partway
        // through a swipe it has mistaken for a scroll. `pinch-zoom` is spelled
        // out because `pan-y` alone would also switch OFF zooming, and this
        // list is text somebody may need to enlarge; the app's viewport meta
        // allows zoom everywhere else and this must not be the exception.
        <ol
          ref={listRef}
          className="mt-auto flex flex-col p-4 [touch-action:pan-y_pinch-zoom]"
          data-testid="chat-messages"
        >
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
              {/*
                THE BUBBLE GETS A ROW OF ITS OWN, WHICH IS WHAT THE TIMESTAMP
                HANGS OFF. `w-full` makes this row span the whole list, so the
                label below anchors to the CONVERSATION'S right edge rather than
                to the bubble's — the times line up in a column instead of
                stepping in and out with each message's length. That anchor is
                the list's CONTENT edge, one padding short of the edge the
                scroller clips at, which is what the label's own `ml-4` closes.
                The
                `justify-*` reproduces exactly the alignment the `<li>`'s own
                `items-*` gave the bubble, and `max-w-[75%]` now resolves
                against a box the same width as the one it did before, so
                nothing about part 2's layout moves. This is the same
                `flex w-full justify-end|justify-start` shape the delete row
                that used to sit here had.
              */}
              <div className={`relative flex w-full ${row.mine ? 'justify-end' : 'justify-start'}`}>
                <MessageBubble
                  row={row}
                  nameFor={nameFor}
                  // WITHHELD RATHER THAN PASSED WITH A FLAG BESIDE IT: a bubble
                  // with no `onDelete` renders as a plain div with no gesture,
                  // no tab stop and no menu, so "may not delete" is the absence
                  // of the affordance rather than a disabled version of it.
                  // `canDelete` is routes/chat.tsx's, unchanged and not
                  // re-derived here.
                  onDelete={onDelete && canDelete(row.message) ? onDelete : undefined}
                />
                {/*
                  THE REVEALED TIMESTAMP, PARKED EXACTLY ON THE CLIP BOUNDARY.

                  `ml-4` IS THE WHOLE BUG FIX AND IT MUST EQUAL THE `<ol>`'s
                  `p-4`. `left-full` alone anchors this to the ROW's right edge,
                  and the row lives inside the list's 16px padding — so the
                  label started 16px INSIDE the scroller's clip edge and 4px of
                  its first digit was on screen at rest, under no drag at all.
                  The owner read those digits off a real phone. The margin
                  pushes the anchor out to the clip edge, where zero pixels of
                  it can show however wide the formatted time happens to be:
                  "12:00 AM" is 21px wider than "14:05", and the resting state
                  must not depend on which one a reader's locale produces. The
                  two numbers are one number written twice; the 390x844
                  measurement asserts the overhang is 0 for the widest label the
                  formatter can emit, so they cannot drift apart silently.

                  NO `pl-3` ANY MORE. The gap between the bubble and its time is
                  the list's own padding, for free: at full reveal the bubble's
                  right edge is 16px further left than the label's, by
                  construction. Padding here would only eat into TIME_REVEAL_PX.

                  IT IS IN THE DOM AT ALL TIMES AND NEVER TOGGLED, because the
                  reveal is a transform on the `<ol>` and nothing here
                  re-renders while a finger is moving — see the drag handlers.

                  `whitespace-nowrap` IS LOAD-BEARING. An absolutely positioned
                  box with `left: 100%` and no `right` has zero available width,
                  so a wrapping label would break after every character into a
                  vertical strip of digits.

                  `aria-hidden`, DELIBERATELY. It is the same instant part 2's
                  separators already announce, duplicated for a gesture a screen
                  reader user has no way to perform; announcing a time after
                  every bubble would double the length of the conversation to
                  no one's benefit.
                */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-full ml-4 flex items-center whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
                >
                  {clockTime(row.message.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * Whether an event actually happened on the bubble, rather than inside the menu
 * or the confirmation the bubble owns.
 *
 * THIS IS NOT DEFENSIVE TIDINESS; WITHOUT IT THE KEYBOARD PATH IS BROKEN, and
 * it was found broken in a browser rather than reasoned about here. Radix
 * renders its menu and its popover through `createPortal` into `document.body`,
 * and React propagates synthetic events up the REACT tree, not the DOM tree —
 * so a keydown on the confirmation's Delete button, which is nowhere near this
 * element in the document, still reaches this element's `onKeyDown`. The
 * bubble's handler answered `Enter` by calling `preventDefault()`, which is
 * exactly the default action Chromium uses to turn Enter on a focused button
 * into a click: the confirm button took the keystroke and did nothing, so a
 * keyboard user could open the menu, reach the confirmation, and never be able
 * to complete the delete. A mouse click was unaffected, which is what made it
 * invisible until the whole path was driven from the keyboard.
 *
 * IT GUARDS THE THREE HANDLERS THAT START SOMETHING — the context menu, the
 * key, and the press timer — for the same reason each: a right-click inside the
 * open menu would reopen it, and a press inside the confirmation would arm a
 * long press on the bubble underneath it.
 */
function fromTheBubbleItself(event: { target: EventTarget | null; currentTarget: EventTarget }) {
  return event.target === event.currentTarget
}

/**
 * One bubble, and — when the caller may delete it — the whole of the iMessage
 * delete affordance: long-press on touch, right-click on a mouse, Enter/Space/
 * ArrowDown from a keyboard, then a menu, then the confirmation.
 *
 * IT REPLACES A VISIBLE "Delete" LINK UNDER EVERY DELETABLE BUBBLE, which the
 * owner asked for: a permanent underlined control below a third of the messages
 * in a conversation is a row of clutter that says "delete" far more often than
 * anyone wants to. The cost of hiding an affordance is that it can become
 * unreachable, which is why the KEYBOARD PATH IS NOT OPTIONAL HERE — see below.
 *
 * A CONTROLLED RADIX DropdownMenu, WITH AN INVISIBLE TRIGGER, AND BOTH HALVES
 * OF THAT ARE DELIBERATE.
 *
 * WHY DropdownMenu AND NOT ContextMenu. Radix ships a ContextMenu whose trigger
 * already handles right-click and its own touch long-press, and this repo can
 * reach it (the `radix-ui` meta-package is a dependency and re-exports it). It
 * was not used, for two reasons. It has NO KEYBOARD PATH — Radix documents
 * this — and it positions its content at the pointer's coordinates, so an
 * open it did not receive from a pointer has no point to open at; a menu
 * summoned from the keyboard would appear in the corner of the viewport.
 * DropdownMenu anchors to an element instead, and its trigger already answers
 * Enter, Space and ArrowDown, restores focus on close, and traps and cycles
 * focus inside the menu. It is also the primitive this app already uses three
 * times over (app-menu.tsx, team-picker.tsx, month-picker.tsx) with a wrapper
 * already in components/ui — so this is the app's existing menu, not a fourth
 * one. What DropdownMenu does not do is open on a long press or a right-click,
 * and that is exactly the part that is cheap to add.
 *
 * WHY THE TRIGGER IS AN INVISIBLE ANCHOR RATHER THAN THE BUBBLE ITSELF. Making
 * the bubble the trigger is the obvious shape and it costs text selection:
 * DropdownMenuTrigger calls `preventDefault()` on any left `pointerdown` that
 * would open it, which is precisely the event that begins a mouse drag-select,
 * so the messages a desktop reader most wants to copy would be the ones they
 * could not. It would also open the menu on an ordinary TAP, which on a phone
 * means every mis-aimed scroll ends in a delete menu. A zero-height button
 * pinned across the bubble's bottom edge anchors the menu to the bubble
 * without owning any of its events; `tabIndex={-1}` keeps it out of the tab
 * order (a bare `<button>` would be a stop of its own, and an empty one at
 * that) and `aria-hidden` keeps it out of the accessibility tree, where it
 * would otherwise be an unlabelled button.
 *
 * THE BUBBLE IS THE FOCUSABLE THING INSTEAD, AND `onCloseAutoFocus` IS WHAT
 * MAKES THAT HOLD. Radix would return focus to its own trigger — the invisible
 * anchor — on close, which is a legal place for focus and a useless one to
 * look at; preventing that and focusing the bubble puts the reader back on the
 * message they were acting on. `aria-haspopup="menu"` with a live
 * `aria-expanded` is what tells a screen reader the gesture exists at all;
 * `role="button"` is deliberately NOT set, because the element's content is a
 * message and flattening it to a control's label would cost more than the
 * role buys.
 *
 * THE LONG PRESS CANCELS ON MOVEMENT, WHICH IS THE ONE BUG THIS PATTERN ALWAYS
 * HAS. Scrolling a conversation is, mechanically, a press on a bubble that
 * lasts far longer than the timer; without `movedOffPress` every scroll ends
 * with a menu over whichever message the thumb landed on. The timer is armed
 * only for touch and pen (`isTouchGesture`) — a mouse resting on a bubble for
 * half a second is somebody reading — and a mouse has `contextmenu` instead,
 * which is also what the keyboard's own ContextMenu key and Shift+F10 deliver.
 *
 * iOS'S OWN CALLOUT IS SUPPRESSED, or it races this one. A long press on text
 * in Safari selects a word and raises the system callout, so
 * `-webkit-touch-callout: none` and a coarse-pointer-only `select-none` get out
 * of the way of the menu. The `select-none` is scoped to coarse pointers on
 * purpose: it is only iOS's press that conflicts, and turning selection off for
 * mice would take away copying to fix a problem mice do not have.
 *
 * THE CONFIRMATION IS UNCHANGED IN THE ONLY WAY THAT MATTERS. `onDelete`
 * rejects on failure (routes/chat.tsx's `handleDelete` rethrows after its
 * toast, deliberately), and that rejection is still the only thing that stops
 * the popover closing as though the delete had worked. `pending` still disables
 * the confirm button while the mutation is in flight, because a second
 * `deleteMessage` for a message already gone comes back NOT_A_MEMBER and
 * reports a SUCCESSFUL delete as failed. Both of those now live per bubble
 * rather than as an id in the list's state, which is the same behaviour with
 * one fewer thing to keep in sync.
 */
function MessageBubble({
  row,
  nameFor,
  onDelete,
}: {
  row: MessageRow
  nameFor: (playerId: Id<'players'>) => string
  onDelete?: (id: Id<'chatMessages'>) => Promise<void>
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const press = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null)
  /*
    "THE MENU IS CLOSING BECAUSE THE CONFIRMATION IS OPENING", WHICH IS NOT THE
    SAME EVENT AS "THE MENU IS CLOSING".

    Radix's non-modal Popover dismisses itself on a `focusin` anywhere outside
    its own content, and the menu's close hands focus back to the bubble —
    which IS outside it. Both happen in the commit that swaps one for the
    other, so returning focus unconditionally opened the confirmation and shut
    it again in the same frame: the menu item did nothing at all, which is what
    this was found doing in a browser rather than reasoned about here.

    On the hand-off the menu returns focus to nobody and the popover's own
    focus scope takes it, landing on the confirm button — which is where a
    keyboard user needs to be anyway. Every other way of closing the menu
    (Escape, a click outside, choosing nothing) still puts focus back on the
    message it belonged to.
  */
  const handingOffToConfirm = useRef(false)

  const cancelPress = useCallback(() => {
    if (press.current === null) return
    window.clearTimeout(press.current.timer)
    press.current = null
  }, [])

  // A message can leave under a finger: a teammate's delete slides the live
  // window while somebody is pressing on it. Without this the timer survives
  // the unmount and fires into a component that no longer exists.
  useEffect(() => cancelPress, [cancelPress])

  /*
    THE BUBBLE'S OWN LOOK IS PART 2'S, MOVED RATHER THAN CHANGED — see the note
    on the list above for why `bg-accent-solid` and not `bg-primary`, why the
    other side is `bg-muted`, why the tail is a flattened corner rather than a
    pointer, and why the width is capped at 75%.
  */
  const bubble = `max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
    row.mine
      ? `bg-accent-solid text-accent-solid-foreground ${row.endsRun ? 'rounded-br-sm' : ''}`
      : `bg-muted text-foreground ${row.endsRun ? 'rounded-bl-sm' : ''}`
  }`

  // NO GESTURE, NO TAB STOP, NO MENU for a message this reader may not delete.
  // The affordance is absent rather than inert, so nothing offers an action
  // that would be refused.
  if (onDelete === undefined) return <div className={bubble}>{row.message.body}</div>

  const handleConfirm = async () => {
    setPending(true)
    try {
      await onDelete(row.message._id)
      setConfirmOpen(false)
    } catch {
      // Left open deliberately: the caller already surfaced a toast, and
      // closing here would tell the user the delete succeeded when it may
      // not have.
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      ref={bubbleRef}
      tabIndex={0}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      className={`${bubble} relative [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [@media(pointer:coarse)]:select-none`}
      onContextMenu={(event) => {
        if (!fromTheBubbleItself(event)) return
        // Both the mouse's right-click and the keyboard's ContextMenu key and
        // Shift+F10 arrive here. `preventDefault` is what replaces the
        // browser's own menu with this one.
        event.preventDefault()
        cancelPress()
        setMenuOpen(true)
      }}
      onKeyDown={(event) => {
        if (!fromTheBubbleItself(event)) return
        if (!opensMenuFromKey(event.key)) return
        // Space would otherwise scroll the conversation out from under the
        // menu it just opened.
        event.preventDefault()
        setMenuOpen(true)
      }}
      onPointerDown={(event) => {
        if (!fromTheBubbleItself(event)) return
        if (!isTouchGesture(event.pointerType)) return
        cancelPress()
        const timer = window.setTimeout(() => {
          press.current = null
          setMenuOpen(true)
        }, LONG_PRESS_MS)
        press.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          timer,
        }
      }}
      onPointerMove={(event) => {
        const held = press.current
        if (held === null || held.pointerId !== event.pointerId) return
        if (movedOffPress(held, { x: event.clientX, y: event.clientY })) cancelPress()
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
    >
      {row.message.body}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 block h-0"
        />
        <DropdownMenuContent
          align={row.mine ? 'end' : 'start'}
          // Radix labels its content by the trigger, and this trigger is an
          // aria-hidden anchor with no text, so the menu would open unnamed.
          // Naming it after the message's author is what tells a screen-reader
          // user WHICH bubble the menu belongs to, which is the one thing the
          // removed "Delete message from X" button did that a bare "Delete"
          // item does not.
          aria-label={`Message from ${nameFor(row.message.playerId)}`}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (handingOffToConfirm.current) {
              handingOffToConfirm.current = false
              return
            }
            bubbleRef.current?.focus()
          }}
        >
          {/*
            NOT TINTED `text-destructive`, WHICH IS THE OBVIOUS THING TO DO AND
            IS A CONTRAST FAILURE HERE. `--destructive` is `--danger`, #dc2626
            in BOTH themes, and the menu paints on `--popover`: that is 4.83:1
            in light and 3.88:1 in dark, dropping to 3.53:1 on the focused
            item's `bg-accent`. Two of those three are under AA's 4.5, and this
            repo measures its pairings in styles.test.ts precisely because a
            ratio nobody checked has gone wrong three times already. The icon
            carries the meaning instead, and the confirmation behind it is the
            actual guard.
          */}
          <DropdownMenuItem
            onSelect={() => {
              handingOffToConfirm.current = true
              setConfirmOpen(true)
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmPopover
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open)
          // BACK TO THE MESSAGE, NOT TO `<body>`. Radix's Popover hands focus
          // to its own trigger on close, and this trigger is a span it cannot
          // focus, so cancelling the confirmation dropped focus to the document
          // — measured, not assumed: a keyboard reader who backed out of a
          // delete lost their place in the conversation entirely and had to tab
          // in from the top. Radix's handler runs after this one and its
          // no-op leaves this focus standing.
          if (!open) bubbleRef.current?.focus()
        }}
        // A SPAN, NOT A BUTTON, AND NOT FOCUSABLE. It exists only so the
        // confirmation has something to anchor to under the bubble; Radix's
        // close handler focuses its trigger, and a span it cannot focus is a
        // no-op, which leaves the focus scope to restore the element that had
        // focus when the popover opened — the bubble.
        trigger={
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 block h-0"
          />
        }
        message="Delete this message? This can't be undone."
        confirmLabel="Delete"
        pending={pending}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  )
}
