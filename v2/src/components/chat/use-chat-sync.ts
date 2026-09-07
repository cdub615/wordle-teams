import { convexQuery } from '@convex-dev/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
// convex/lib/chatLimits.ts AND NOTHING ELSE FROM convex/lib. That file imports
// nothing, deliberately; lib/chat.ts reaches access.ts -> auth.ts, which throws
// at module scope without SITE_URL and cannot be tree-shaken out of a browser
// bundle. See chatLimits.ts's own header.
import { RECENT_WINDOW } from '../../../convex/lib/chatLimits.ts'
// clockTime AND ITS FORMATTER CACHE MOVED TO lib/ (wordle-teams-8klr): the
// notification settings tab formats a reminder hour with the same function, and
// a settings component may not import out of this module. See its header there.
import { clockTime, formatterFor } from '#/lib/clock-time.ts'

/**
 * The live pointer for one team's chat.
 *
 * THIS IS THE ONLY SUBSCRIPTION CHAT HOLDS. Everything else is fetched in
 * response to it changing. The pointer is two small documents; a naive
 * subscription to the message window would be ~17x more expensive per wake,
 * which is the whole argument of the design's section 4.
 */
export function useChatPointer(teamId: Id<'teams'>, mode: PointerMode = 'live') {
  return useQuery(convexQuery(api.chat.pointer, mode === 'live' ? { teamId } : 'skip'))
}

export type ChatPointerValue = {
  lastMessageAt: number
  revision: number
  degraded: boolean
}

/* ---------------------------------------------------------------------------
 * THE DEGRADATION VALVE, CLIENT SIDE (wordle-teams-vd1j).
 *
 * The server has metered bytes and published `degraded` since Part 1; nothing
 * consumed it, so crossing 700MB changed nothing a client did and the first
 * real symptom would have been Convex's hard 1GB cap — at which point
 * MUTATIONS FAIL APP-WIDE and board entry goes down with chat. Design section 6
 * is explicit that degrading chat is always the better outcome. These are the
 * decisions that degrade it, all pure, because this suite is edge-runtime with
 * no DOM and picks up `*.test.ts` only: a rule written inline in a hook or in
 * JSX is a rule nothing asserts, and this one guards the whole app.
 * ------------------------------------------------------------------------ */

export type PointerMode = 'live' | 'manual'

/**
 * A pointer value together with the team it was read for.
 */
export type SeenPointer = { teamId: Id<'teams'>; value: ChatPointerValue }

/**
 * The last pointer seen FOR THE TEAM ON SCREEN, or `null` when the newest one
 * held belongs to a different conversation.
 *
 * THE TEAM IS CARRIED WITH THE VALUE BECAUSE THE VALUE IS NOW OUR OWN STATE.
 * It used to be read straight off `useQuery`, which re-keys the instant
 * `teamId` changes and so could never hand back another team's answer. Holding
 * the last pointer ourselves — the thing that lets a manual refresh feed the
 * same sync path a subscription does — gives that guarantee up, and a pointer
 * is entirely team-specific: `revision` and `lastMessageAt` compared across two
 * teams produce a confidently wrong sync action, not a stale one.
 *
 * IT MAKES A STALE VALUE INERT RATHER THAN NEEDING IT CLEARED, which is what
 * makes the switch safe in the awkward order it actually happens in: the new
 * team's pointer can already be in TanStack's cache (a team visited before), so
 * it is adopted in the SAME commit the switch is noticed in, and an effect that
 * cleared the old value could just as easily clear the new one.
 */
export function pointerFor(seen: SeenPointer | null, teamId: Id<'teams'>): ChatPointerValue | null {
  if (seen === null || seen.teamId !== teamId) return null
  return seen.value
}

/**
 * Whether chat should be holding its live subscription, given the last pointer
 * value it saw from anywhere.
 *
 * DERIVED FROM THE LAST POINTER, NOT LATCHED IN STATE, AND THAT IS WHAT MAKES
 * THE WHOLE MECHANISM SELF-HEALING. Dropping the subscription costs the client
 * the only channel that could ever tell it degradation ENDED — the
 * chicken-and-egg this design has to answer. It answers it by making the mode a
 * function of the newest pointer the client holds, whatever read produced it: a
 * manual refresh carries the current `degraded`, so a refresh that comes back
 * clean puts the client back on the live subscription with nothing to reset and
 * no second code path to get wrong.
 *
 * A MONTH BOUNDARY RECOVERS THROUGH THAT SAME PATH, with no calendar anywhere
 * on the client. `chatDegraded` is keyed by month and chatPointerFor reads an
 * absent row as `false` (see publishDegraded), so the first refresh after
 * midnight on the 1st answers `degraded: false` and the client resumes. A
 * reload recovers instantly for the same reason — `null` here means live.
 *
 * `null` IS LIVE, WHICH IS THE ONLY POSSIBLE ANSWER. `degraded` arrives ON the
 * pointer, so a client that has read no pointer has to open the subscription to
 * learn whether it should be holding one. The exposure is one wake wide.
 *
 * IT TAKES ANYTHING CARRYING `degraded`, NOT A `ChatPointerValue`
 * (wordle-teams-pnhe). The dashboard's unread-badge answer carries the same
 * flag for the same purpose, and there are exactly two live subscriptions in
 * the app to decide about. One rule, applied twice, is what keeps them
 * degrading together; a second copy of `seen?.degraded === true` is the copy
 * that would be left behind by the next change to what degradation means.
 */
export function pointerMode<T extends { degraded: boolean }>(seen: T | null): PointerMode {
  return seen?.degraded === true ? 'manual' : 'live'
}

/**
 * Whether the held subscription must be torn out of the query cache, given the
 * mode this render moved from and to.
 *
 * THIS IS THE DIFFERENCE BETWEEN DROPPING THE SUBSCRIPTION AND MERELY IGNORING
 * IT, and it is the entire point of the valve — the bandwidth goes to holding
 * the socket open, not to reading the value. Passing `'skip'` to `convexQuery`
 * only sets `enabled: false`, which removes the OBSERVER; @convex-dev/
 * react-query unsubscribes its Convex watch on the query cache's `removed`
 * event and, in as many words, deliberately NOT on `observerRemoved` ("don't
 * clean up yet, after gcTime a 'removed' event will notify"). So skipping alone
 * leaves the websocket subscription live for a full gcTime — five minutes by
 * default — per degraded client. The caller answers this by removing the query
 * outright, which fires `removed` immediately.
 *
 * ON THE TRANSITION, NOT ON THE STATE. The one-shot refresh fetches under that
 * same query key and removes it again when it settles; a rule that removed on
 * every render while manual would be tearing the key out from under a read in
 * flight.
 */
export function shouldDropSubscription(previous: PointerMode, next: PointerMode): boolean {
  return previous === 'live' && next === 'manual'
}

/**
 * Whether the one-shot pointer read may drop its own cache entry when it
 * settles — i.e. whether anybody is still watching that key.
 *
 * THE INTERLOCK FOR A RACE THE REFRESH CAN LOSE. `readPointerOnce` fetches
 * under the live subscription's OWN query key and removes it afterwards so no
 * websocket watch is left behind. Almost always nothing else is watching that
 * key, because the client is only ever refreshing while degraded and degraded
 * means skipped. The exception is narrow and real: switch teams away and back
 * while a read is in flight, and the returning render re-opens a genuine live
 * subscription under that same key before the read settles. Removing it then
 * would tear down a subscription that has an observer — the one failure mode
 * worse than not cleaning up, because the client would go quiet with no notice
 * that it had.
 *
 * ZERO, NOT "NOT MINE". A one-shot `fetchQuery` registers no observer at all
 * (that is what makes it one-shot), so the count is exactly the number of
 * `useQuery` callers holding this key live.
 */
export function shouldReleaseAfterRead(observers: number): boolean {
  return observers === 0
}

export type RefreshDecision = { kind: 'fetch' } | { kind: 'skip'; reason: 'live' | 'in-flight' }

/**
 * Whether a refresh request should actually go and read the pointer.
 *
 * REFUSING IN LIVE MODE IS AN INTERLOCK RATHER THAN TIDINESS. The one-shot read
 * shares its query key with the live subscription and removes that key when it
 * settles, so a refresh dispatched while live would tear down the subscription
 * that makes refreshing unnecessary — and leave nothing to re-open it, since
 * the mode never changed.
 *
 * REFUSING A SECOND CONCURRENT READ IS THE SAME HAZARD FROM THE OTHER SIDE: two
 * in flight means the first one's teardown lands underneath the second one's
 * fetch. It is also what a double tap on the button produces, which is the
 * ordinary case rather than a rare one.
 */
export function refreshDecision(state: { mode: PointerMode; inFlight: boolean }): RefreshDecision {
  if (state.mode === 'live') return { kind: 'skip', reason: 'live' }
  if (state.inFlight) return { kind: 'skip', reason: 'in-flight' }
  return { kind: 'fetch' }
}

/**
 * What a degraded reader is told, or `null` when there is nothing to say.
 *
 * THE COPY IS HERE RATHER THAN IN JSX SO IT IS ASSERTED. Design section 6 asks
 * for "an honest notice that live updates are paused", and honesty is a
 * property of specific words: this names what stopped (live updates), why (this
 * month's usage), and what still works (sending, which the server never gates —
 * see sendMessageFor). It does not apologise, does not warn, and does not put
 * the reader at fault for a shared app-wide budget they did not spend.
 *
 * "PAUSED", NOT "OFFLINE" OR "DISCONNECTED". Chat is fully working: messages
 * send, history pages, nothing is lost. The single thing that changed is that
 * new messages arrive when asked for instead of on their own.
 */
export function pausedNotice(mode: PointerMode): string | null {
  if (mode === 'live') return null
  return (
    'Live updates are paused to stay within this month’s usage limit. ' +
    'Sending still works — refresh to see new messages.'
  )
}

/**
 * The refresh control's label, which is also its accessible name.
 *
 * IT CHANGES IN FLIGHT because the button is disabled while reading and a
 * disabled control that still says "Refresh" reads as a broken one. This is the
 * same shape MessageList gives "Load older messages".
 */
export function refreshLabel(inFlight: boolean): string {
  return inFlight ? 'Refreshing…' : 'Refresh'
}

export type ChatLoadState = 'pending' | 'error' | 'ready'

/**
 * Which of the route's three branches to render.
 *
 * THIS EXISTS BECAUSE A SKIPPED QUERY IS PENDING FOREVER. The route used to
 * read `pointer.isPending` and `pointer.error` off the subscription directly,
 * which is correct exactly while there IS a subscription — `enabled: false`
 * leaves TanStack reporting `status: 'pending'` with no data under a query key
 * that will never be fetched, so a degraded client would sit on "Loading…"
 * with a whole conversation already in hand.
 *
 * THE HELD POINTER WINS OVER BOTH FLAGS, and that also decides a second case
 * worth being deliberate about: a refresh that fails after a conversation is on
 * screen leaves the conversation on screen. Replacing it with "Could not load
 * chat." would throw away more than it reports; the route toasts instead, the
 * way it already does for a failed scrollback page.
 *
 * THE ERROR BRANCH STILL BEHAVES AS IT DID FOR THE VISITOR IT MATTERS FOR: an
 * outsider's `chat.pointer` throws on the first read, so nothing is ever seen
 * and this answers `error` — which is what e2e/chat.spec.ts drives at.
 */
export function chatLoadState(state: {
  seen: ChatPointerValue | null
  isPending: boolean
  hasError: boolean
}): ChatLoadState {
  if (state.seen !== null) return 'ready'
  if (state.hasError) return 'error'
  return 'pending'
}

/**
 * Whether a successful send should be followed by a manual refresh.
 *
 * WITHOUT THIS, THE SENDER IS THE ONE PERSON WHO CANNOT SEE THEIR OWN MESSAGE.
 * Design section 6 keeps sending working "so a conversation is never cut off",
 * and with no subscription held nothing else would ever bring the sent message
 * back onto the sender's screen — they would type into a list that does not
 * change, which is the cut-off conversation the rule exists to prevent.
 *
 * ALREADY PAID FOR. sendMessageFor charges the meter teamSize x BYTES_PER_WAKE
 * for wakes that, while degraded, nobody receives; one pointer read by the
 * sender is inside what was already charged, and it is the cheapest read in the
 * feature.
 *
 * FALSE WHILE LIVE, because the subscription delivers the sender's own message
 * along with everyone else's and a second read would be pure duplication.
 */
export function shouldRefreshAfterSend(mode: PointerMode): boolean {
  return mode === 'manual'
}

export type SyncAction =
  | { kind: 'none' }
  | { kind: 'since'; since: number }
  | { kind: 'window' }

/**
 * What to do when the pointer changes. Pure on purpose: this is the whole of
 * the sync reasoning, and it is the part worth testing.
 *
 * THE THREE CASES, and why the third is not an append:
 *   lastMessageAt advanced by exactly one revision  -> fetch since our newest
 *   revision advanced alone                         -> a DELETE; refetch
 *   revision jumped more than one                   -> updates coalesced
 *
 * A delete does not move lastMessageAt, so a client watching only the
 * timestamp would keep showing a message that is gone — which is why the
 * server bumps `revision` on every history change (see bumpChatMeta).
 *
 * COALESCING IS WHY THE THIRD CASE EXISTS. Convex delivers the latest value,
 * not every intermediate one, so a send and a delete can arrive as a single
 * change. Appending would then miss the deletion silently. Refetching a
 * 30-message window is the more expensive branch and it is deliberately the
 * fallback: correctness first, and it is rare.
 */
export function nextSyncAction(
  previous: ChatPointerValue | null,
  current: ChatPointerValue,
  newestHeld: number,
): SyncAction {
  if (previous === null) return { kind: 'window' }
  if (current.revision === previous.revision) return { kind: 'none' }

  const revisionsMoved = current.revision - previous.revision
  const gotNewer = current.lastMessageAt > previous.lastMessageAt

  if (gotNewer && revisionsMoved === 1) return { kind: 'since', since: newestHeld }
  return { kind: 'window' }
}

/**
 * Whether a dispatched fetch (`mine`) is still the one whose result should be
 * applied, given the request counter's current value (`latest`). Pure, and
 * tested alongside `nextSyncAction` for the same reason: it is the whole of a
 * second piece of reasoning this file depends on, not incidental plumbing.
 *
 * THE POINTER FIRES ON EVERY MESSAGE IN THE TEAM, so in a live conversation
 * overlapping fetches are the normal case, not a rare race: a `window` or
 * `since` fetch dispatched behind an earlier one can resolve first over the
 * network, since network order does not have to match dispatch order. Without
 * this check, whichever response's PROMISE resolves last would win — not
 * whichever one was dispatched last — which lets an older answer overwrite
 * state a newer one already set: a deleted message reappearing, or a message
 * flickering back out after being appended.
 */
export function isCurrentRequest(mine: number, latest: number): boolean {
  return mine === latest
}

export type ChatMessage = {
  _id: Id<'chatMessages'>
  playerId: Id<'players'>
  body: string
  createdAt: number
}

/**
 * The client's own mirror of convex/chat.ts's `MessagesSince`. Not imported
 * from there directly — this file follows the repo convention of importing
 * types only from convex/lib/*.ts into frontend code, never from a convex
 * function-definition file — but structurally identical, which is all that
 * matters for values crossing the `fetchQuery` boundary.
 */
export type MessagesSinceResult = { gap: true } | { gap: false; messages: Array<ChatMessage> }

export type SinceOutcome = { kind: 'window' } | { kind: 'messages'; messages: Array<ChatMessage> }

/**
 * What to do with a `since` fetch's result: refetch the window, or move on to
 * the next array of held messages to show.
 *
 * PURE, AND TESTED ALONGSIDE `nextSyncAction` AND `isCurrentRequest`. This
 * used to live inline in the effect's `.then`, which is exactly the "wiring,
 * not reasoning" boundary this file otherwise holds to — the design (§4)
 * calls the gap case out by name as needing coverage, and a decision asserted
 * by nothing is not covered just because the server side is.
 *
 * A GAP MEANS THE SERVER REFUSED TO SEND A TRUNCATED LIST rather than one a
 * caller could mistake for complete (see messagesSinceFor's own comment) —
 * the correct recovery is the window, not a partial append.
 *
 * RETURNS `held` UNCHANGED — THE SAME REFERENCE — WHEN THERE IS NOTHING NEW,
 * rather than a freshly spread array with identical contents. That is not
 * merely tidy: handing `setMessages` the identical reference is what lets
 * React's `Object.is` bail-out skip the re-render entirely.
 */
export function nextSinceOutcome(
  held: Array<ChatMessage>,
  result: MessagesSinceResult,
): SinceOutcome {
  if (result.gap) return { kind: 'window' }
  if (result.messages.length === 0) return { kind: 'messages', messages: held }
  return { kind: 'messages', messages: [...held, ...result.messages] }
}

export type OlderOutcome =
  | { kind: 'start' }
  | { kind: 'pages'; pages: Array<ChatMessage> }

/**
 * The `before` argument for the next scrollback page, or `null` when there is
 * nothing to page back from.
 *
 * THE NULL IS NOT DEFENSIVE TIDINESS. `olderMessages` is the one read that is
 * a MUTATION rather than a query — it has to write to charge the bandwidth
 * meter, which a Convex query cannot do — and it is rate-limited to ten pages
 * per player per team per minute (RATE_LIMIT_SCROLLS). Firing it with a
 * made-up `before` of 0 spends one of those ten on a request that can only
 * come back empty.
 *
 * THE OLDEST HELD, NOT THE NEWEST: olderMessagesFor takes messages strictly
 * `lt` this timestamp, so anything newer re-reads a page we already have and
 * charges the meter for it.
 */
export function beforeForOlder(shown: Array<ChatMessage>): number | null {
  return shown.length === 0 ? null : shown[0].createdAt
}

/**
 * What to do with a scrollback page's result — the backwards twin of
 * `nextSinceOutcome`, and pure for the same reason.
 *
 * AN EMPTY PAGE MEANS THE START OF HISTORY, PERMANENTLY. History only ever
 * grows newer, so nothing can later appear before a point the server has
 * already said it has nothing before. That is what lets the route retire the
 * button entirely rather than leave it there to spend rate-limit budget
 * re-asking a settled question.
 *
 * PAGES GO IN FRONT, AND THIS IS THE ONLY PLACE THAT ORDER IS DECIDED. Each
 * page is strictly older than everything held when it was requested, and the
 * server already returns it oldest-first, so a plain prepend keeps the whole
 * array oldest-first across any number of pages.
 */
export function nextOlderOutcome(
  held: Array<ChatMessage>,
  page: Array<ChatMessage>,
): OlderOutcome {
  if (page.length === 0) return { kind: 'start' }
  return { kind: 'pages', pages: [...page, ...held] }
}

/**
 * The messages to render: scrollback pages ahead of the live window.
 *
 * DEDUPES BY `_id`, AND THAT IS THE POINT OF THE FUNCTION. The two arrays are
 * kept apart on purpose — a `window` action replaces the live half wholesale
 * (see `useChatMessages`), and merging scrollback into that state would let
 * every refetch throw the user's loaded history away. Keeping them separate
 * costs one overlap: the live window is the newest RECENT_WINDOW messages, so
 * deleting one of them pulls the next-oldest message INTO the window — and
 * that message may already be sitting in a scrollback page fetched earlier.
 * Rendered as-is that is the same `_id` twice in one `<ol>`: a duplicate React
 * key and a message shown twice. The LIVE copy wins, because it is the one the
 * pointer keeps current.
 *
 * RETURNS `live` UNCHANGED — THE SAME REFERENCE — WHEN NO PAGE IS HELD, for
 * the reason `nextSinceOutcome` does: this runs on every render of the list,
 * and before anyone presses "load older" that is every render there is.
 */
export function mergeOlder(
  pages: Array<ChatMessage>,
  live: Array<ChatMessage>,
): Array<ChatMessage> {
  if (pages.length === 0) return live
  const liveIds = new Set(live.map((message) => message._id))
  return [...pages.filter((message) => !liveIds.has(message._id)), ...live]
}

/**
 * The three numbers any scroll decision below needs, named so a test can hand
 * them over as a plain object.
 *
 * STRUCTURAL, LIKE pull-to-refresh.ts's `ClosestTarget`, AND FOR THE SAME
 * REASON: this suite runs on edge-runtime with NO DOM, so an `HTMLElement`
 * parameter would make every one of these functions untestable — which is
 * exactly how they would end up inline in JSX instead.
 */
export type ScrollPosition = { scrollTop: number; scrollHeight: number; clientHeight: number }

/**
 * How far from an edge still counts as being at it, in CSS pixels.
 *
 * NOT ZERO, AND THAT IS NOT A TOLERANCE FOR SLOPPINESS. Browsers report
 * `scrollTop` fractionally on a zoomed or non-integer-DPR display, and
 * `scrollHeight` is rounded while `scrollTop + clientHeight` is not — so a
 * reader sitting exactly at the bottom routinely measures a pixel or two
 * short of it. An exact comparison would then read "not at the bottom" and
 * silently stop following the conversation, which is the failure this whole
 * mechanism exists to avoid.
 *
 * THE BOTTOM SLACK IS THE LARGER OF THE TWO, deliberately. It answers "is the
 * reader still following along", where being one short line adrift is still
 * following; the top one answers "has the reader reached the start of what is
 * loaded", which is a place you arrive at rather than hover near.
 */
export const NEAR_BOTTOM_SLACK_PX = 64
export const AT_TOP_SLACK_PX = 8

/**
 * Whether the reader is close enough to the newest message that a new one
 * arriving should scroll them to it.
 *
 * THE WHOLE POINT IS THE CASE WHERE THIS IS FALSE. Auto-scrolling on every
 * arrival is easy and wrong: someone who has scrolled up to read what was said
 * an hour ago gets yanked to the bottom the moment anyone types, and there is
 * no way to hold their place. Following only from near the bottom is what makes
 * "jump to the newest" and "leave me where I am" the same rule rather than two
 * modes with a control to switch between them.
 *
 * A LIST SHORTER THAN ITS OWN VIEWPORT IS ALWAYS "NEAR THE BOTTOM"
 * (`scrollHeight <= clientHeight`, so the distance is at most 0). That is the
 * state a freshly opened conversation with four messages in it is in, and
 * treating it as "scrolled away" would leave the first arrival unfollowed.
 */
export function isNearBottom(
  position: ScrollPosition,
  slack: number = NEAR_BOTTOM_SLACK_PX,
): boolean {
  return position.scrollHeight - position.scrollTop - position.clientHeight <= slack
}

/**
 * Whether the reader has scrolled to the top of what is loaded — the point at
 * which asking for older messages is the thing they are trying to do.
 *
 * A LIST THAT DOES NOT SCROLL AT ALL IS AT ITS TOP, which matters: with fewer
 * messages than fill the panel there is no gesture that could ever report
 * arriving there, so a rule that waited for one would hide "Load older"
 * permanently in exactly the case where it is the only way to see anything
 * more.
 */
export function isAtTop(position: ScrollPosition, slack: number = AT_TOP_SLACK_PX): boolean {
  return position.scrollTop <= slack
}

/**
 * Whether "Load older messages" should be on screen.
 *
 * IT USED TO BE UNCONDITIONAL, which is two separate problems wearing one
 * button. It sat above the newest messages — the part of a conversation
 * everyone actually reads — announcing history nobody had asked for; and it
 * offered to spend a metered, rate-limited page (`olderMessages` is the one
 * read that charges the bandwidth meter, ten pages a minute per player per
 * team) on conversations that provably have nothing behind them.
 *
 * `windowLength` IS THE PROOF THERE IS NOTHING BEHIND THEM, AND IT COSTS
 * NOTHING TO ASK. `recentMessagesFor` `.take(RECENT_WINDOW)`s, so a window
 * that came back SHORT is the whole of that team's history — there is no
 * older page, and the only way to discover that without this check is to
 * spend one of the ten. A window that came back full may or may not have more;
 * `canLoadOlder` is what retires the button once an empty page has settled it
 * (see `nextOlderOutcome`), and this is what stops the first pointless request
 * from ever going out.
 *
 * `canLoadOlder` IS THE CALLER'S EXISTING WITHHOLDING RULE, not a new one:
 * routes/chat.tsx already declines to pass `onLoadOlder` once `atStart` is set
 * or there is nothing to page back from. Taking it as a boolean keeps that
 * decision where its state lives and this one where the scroll position does.
 *
 * ORDER IS NOT LOAD-BEARING here — all three terms are already-computed
 * booleans and numbers, with nothing to short-circuit — so this is written as
 * the plain conjunction the rule reads as.
 */
export function shouldShowLoadOlder(state: {
  canLoadOlder: boolean
  windowLength: number
  atTop: boolean
}): boolean {
  return state.canLoadOlder && state.windowLength >= RECENT_WINDOW && state.atTop
}

/**
 * WHERE THE READER'S PLACE IS RESTORED TO AFTER A SCROLLBACK PAGE IS PREPENDED
 * (wordle-teams-9ozu).
 *
 * THE BUG THIS FIXES IS THE ONLY ONE IN CHAT THAT PUNISHES SUCCESS. "Load older
 * messages" inserts a page of history ABOVE everything on screen while the
 * browser holds `scrollTop` constant — and `scrollTop` is measured from the top
 * of the CONTENT, not from what the reader is looking at. So the moment the
 * page lands, the thing under the reader's eyes is thrown DOWN the viewport by
 * the full height of the inserted page: they asked for older messages and were
 * shown a different part of the conversation than the one they were reading,
 * with no indication of where they went. On a full page that is roughly a
 * screen and a half of displacement.
 *
 * THE CORRECTION IS THE HEIGHT DELTA, AND IT IS EXACT RATHER THAN AN ESTIMATE.
 * Everything inserted goes above the reader's position, so the content that was
 * above them grew by exactly `after - before` — and adding that to `scrollTop`
 * puts the same pixel of content back under the same pixel of viewport. No
 * per-message measurement, no anchor element, nothing that has to agree with
 * the layout.
 *
 * `before` IS CAPTURED AT THE CLICK, NOT IN THE LAYOUT EFFECT, and that is the
 * whole reason this is a two-argument function rather than a one-argument one.
 * By the time an effect runs, React has already committed the taller list, so
 * there is no "before" left in the DOM to read. See message-list.tsx.
 *
 * CLAMPED AT ZERO because a NEGATIVE scrollTop is silently coerced to 0 by the
 * browser anyway, and a caller reading this value back would then disagree with
 * the element. It only arises if content shrank across the same commit, which a
 * prepend cannot cause on its own — a delete arriving in the same frame can.
 */
export function anchoredScrollTop(
  before: { scrollTop: number; scrollHeight: number },
  afterScrollHeight: number,
): number {
  return Math.max(0, before.scrollTop + (afterScrollHeight - before.scrollHeight))
}

/**
 * HOW LONG A PAUSE BREAKS A RUN OF BUBBLES, and how long a pause earns a time
 * separator above the next one. Two numbers, deliberately an order of magnitude
 * apart, because they answer two different questions.
 *
 * RUN_GAP_MS IS "IS THIS STILL THE SAME UTTERANCE": someone typing three
 * sentences as three messages is one thought, and drawing three separately
 * tailed bubbles with a name over each turns a conversation into a list. Five
 * minutes is long enough to cover typing and a re-read, short enough that
 * coming back after making a coffee starts a new bubble group.
 *
 * SEPARATOR_GAP_MS IS "HAS TIME PASSED WORTH TELLING THE READER ABOUT". An hour
 * is the interval iMessage uses, and the reason it is not five minutes is that
 * a separator is a full-width interruption of the conversation: at the run
 * threshold every pause for a phone call would stamp a timestamp across the
 * thread.
 *
 * A DAY BOUNDARY OVERRIDES THE HOUR (see `separatorBefore`). Two messages six
 * minutes apart across midnight are six minutes apart and a day apart, and it
 * is the second fact that a reader scrolling back needs.
 */
export const RUN_GAP_MS = 5 * 60_000
export const SEPARATOR_GAP_MS = 60 * 60_000

/**
 * The locale the app's own WORDS are written in, and the one every formatter
 * here uses except the clock.
 *
 * PINNED, matching lib/format-day.ts, which pins it for the same reason: the
 * strings these produce are asserted character for character, and a suite that
 * inherited the host's locale would pass in one place and fail in another. The
 * separator's own vocabulary ("Today", "Yesterday") is English regardless, so a
 * German weekday beside an English "Yesterday" would be half a translation.
 */
export const CHAT_LABEL_LOCALE = 'en-US'


/**
 * Which calendar day a timestamp falls on, as a whole number of days, in the
 * zone the reader is actually in.
 *
 * A NUMBER RATHER THAN A `Date`, AND THE SUBTRACTION IS WHY. "Yesterday" is a
 * question about calendar days, not about elapsed milliseconds: 00:30 and 23:30
 * are an hour apart and on different days, and a `now - then > 86_400_000`
 * rule calls the first "Today" until half past midnight and then calls it
 * "Yesterday" without the message having moved. Converting each side to a day
 * index first makes the comparison exact.
 *
 * IT GOES THROUGH `Date.UTC` ON PARTS THAT WERE ALREADY RESOLVED IN THE TARGET
 * ZONE, which is the part that survives DST. The parts come out of Intl, so
 * they are the local calendar date; re-composing them as UTC gives a day index
 * on a grid where every day is exactly 24 hours long, so the difference between
 * two of them is a count of calendar days even across the 23- and 25-hour ones.
 * Stepping back `n * 86_400_000` from `now` instead — the obvious version —
 * lands on the wrong day twice a year.
 *
 * `timeZone` UNDEFINED MEANS THE HOST'S ZONE, which is what the app wants: the
 * reader's own idea of "today" is the only one the label can mean. Tests pass
 * an explicit zone so that "today" is a fact about the fixture rather than
 * about the machine running it.
 *
 * THE LOCALE IS PINNED HERE AND TAKES NO PARAMETER, WHICH IS THE ONE PLACE IN
 * THIS FILE THAT IS TRUE. Everything else formats a string for a reader;
 * this PARSES the parts back out with `Number`, and a locale whose default
 * numbering system is not `latn` — `ar-EG`, `fa-IR`, `ne-NP` — writes those
 * digits in a script `Number` reads as `NaN`. The day index would then be
 * `NaN` for every message and every separator would read "Today". This asks a
 * calendar question, not a presentation one, so it asks it in a fixed locale.
 */
export function chatDayIndex(timestamp: number, timeZone?: string): number {
  const parts = formatterFor(
    'day',
    { year: 'numeric', month: 'numeric', day: 'numeric' },
    timeZone,
    CHAT_LABEL_LOCALE,
  ).formatToParts(new Date(timestamp))
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return Date.UTC(value('year'), value('month') - 1, value('day')) / 86_400_000
}

/**
 * The text of a time separator: how long ago, plus the clock time.
 *
 * FOUR SHAPES, NARROWING AS THE MESSAGE GETS OLDER — `Today 2:05 PM`,
 * `Yesterday 11:58 PM`, `Thursday 9:12 AM`, `Aug 12, 2026 9:12 AM` for an
 * American reader; the same four with `14:05`, `23:58`, `09:12` for a British
 * one. The weekday band stops at seven days for the reason weekday names exist
 * at all: "Thursday" means one specific day only while there is exactly one
 * Thursday in living memory, and a nine-day-old message labelled "Thursday" is
 * a lie a reader has no way to detect.
 *
 * THE CLOCK IS THE READER'S, THE WORDS ARE THE APP'S. `clockTime` asks CLDR
 * whether this locale writes 2:05 PM or 14:05 and passes no opinion of its
 * own; the weekday and the date stay on `CHAT_LABEL_LOCALE` beside "Today" and
 * "Yesterday", which are English because the app is. Localising `Aug 12` into
 * `12. Aug.` under an English "Yesterday" would be half a translation, and
 * lib/format-day.ts already pins the same locale for the same date shapes.
 *
 * A FUTURE TIMESTAMP FALLS THROUGH TO THE FULL DATE. Clock skew between a
 * sender's device and the reader's is real and small, so same-day skew still
 * reads "Today"; anything further ahead is strange enough that naming the date
 * is more honest than "Yesterday" arithmetic run backwards.
 */
export function separatorLabel(
  timestamp: number,
  now: number,
  timeZone?: string,
  locale?: string,
): string {
  const when = new Date(timestamp)
  const time = clockTime(timestamp, timeZone, locale)

  const days = chatDayIndex(now, timeZone) - chatDayIndex(timestamp, timeZone)
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Yesterday ${time}`
  if (days > 1 && days < 7) {
    return `${formatterFor('weekday', { weekday: 'long' }, timeZone, CHAT_LABEL_LOCALE).format(when)} ${time}`
  }
  return `${formatterFor('date', { month: 'short', day: 'numeric', year: 'numeric' }, timeZone, CHAT_LABEL_LOCALE).format(when)} ${time}`
}

/**
 * The separator to draw above a message, or `null` for the ordinary case of one
 * message following another in the same breath.
 *
 * THE FIRST MESSAGE ON SCREEN ALWAYS GETS ONE. It is the oldest thing loaded,
 * so there is nothing above it to date it by — and after a scrollback page
 * lands, the message that used to be first no longer is, which means the
 * separator moves up with the history rather than being duplicated.
 *
 * THE DAY BOUNDARY IS A SECOND, INDEPENDENT TRIGGER, not a consequence of the
 * hour. Two messages at 23:58 and 00:03 are five minutes apart and on different
 * days; without this the reader scrolling back through a long night sees one
 * unbroken column and no indication that the date changed under them.
 */
export function separatorBefore(
  message: ChatMessage,
  previous: ChatMessage | undefined,
  now: number,
  timeZone?: string,
  locale?: string,
): string | null {
  if (
    previous !== undefined &&
    message.createdAt - previous.createdAt < SEPARATOR_GAP_MS &&
    chatDayIndex(message.createdAt, timeZone) === chatDayIndex(previous.createdAt, timeZone)
  ) {
    return null
  }
  return separatorLabel(message.createdAt, now, timeZone, locale)
}

/**
 * Whether a message opens a new run of bubbles.
 *
 * THREE THINGS BREAK A RUN, and the third is the one that is easy to miss. A
 * different author, obviously; a pause longer than RUN_GAP_MS, obviously; and a
 * TIME SEPARATOR, because a separator is a horizontal rule through the
 * conversation and a run whose bubbles are split across one is not a run — the
 * tail would sit on the last bubble ABOVE the separator and the name above the
 * first bubble below it would be missing. That is why this takes the separator
 * as an argument rather than recomputing a gap: there is exactly one rule for
 * when a separator appears (`separatorBefore`, which also fires on a day
 * boundary at five minutes' distance) and this must agree with it by
 * construction rather than by coincidence.
 */
export function startsRun(
  message: ChatMessage,
  previous: ChatMessage | undefined,
  afterSeparator: boolean,
): boolean {
  if (previous === undefined || afterSeparator) return true
  if (previous.playerId !== message.playerId) return true
  return message.createdAt - previous.createdAt > RUN_GAP_MS
}

/**
 * Whether the author's name is drawn above a bubble.
 *
 * NEVER OVER YOUR OWN MESSAGES, which is not a space saving — it is what makes
 * the two columns mean something. Your messages are the ones on the right in
 * green; labelling them with your own name is the UI telling you something you
 * cannot fail to know, and it costs the visual asymmetry that identifies the
 * other column as someone else's.
 *
 * ONCE PER RUN, at the top. A name over every bubble turns four consecutive
 * messages from one person into four separate arrivals.
 */
export function showsAuthorName(startsRun: boolean, mine: boolean): boolean {
  return startsRun && !mine
}

/**
 * Everything the list needs to know about one message's PLACE in the
 * conversation. The component reads these; it decides none of them.
 */
export type MessageRow = {
  message: ChatMessage
  mine: boolean
  startsRun: boolean
  endsRun: boolean
  showsName: boolean
  separator: string | null
}

/**
 * The whole of the bubble layout, as data.
 *
 * THIS EXISTS BECAUSE THE ALTERNATIVE IS UNTESTABLE BY CONSTRUCTION. Every
 * decision here — which side a bubble sits on, whether it carries a tail,
 * whether a name goes above it, whether a separator interrupts — is the kind of
 * thing that gets written inline in a `.map` in JSX, and this suite runs on
 * edge-runtime with no DOM and picks up `*.test.ts` only, so a decision made in
 * a `.tsx` file is a decision asserted by nothing. Returning rows instead means
 * message-list.tsx contains no conditional that is not a className.
 *
 * `endsRun` IS READ FROM THE NEXT MESSAGE, WHICH IS WHY THIS TAKES THE WHOLE
 * ARRAY. "Is this the last bubble of its run" cannot be answered while looking
 * at one message and its predecessor — it is exactly "does the NEXT message
 * start a new run" — and it is the flag the tail hangs off. A per-message
 * helper would have had to look forwards anyway, one element at a time, and
 * would have recomputed the whole `startsRun` chain to do it.
 *
 * `myPlayerId` MAY BE `undefined`, AND THAT IS A LOADED-STATE BRANCH RATHER
 * THAN DEFENSIVENESS — the same one routes/chat.tsx's `canDelete` carries.
 * getMyPlayerId resolves independently of the messages, and `undefined` there
 * would compare unequal to every author, so the first paint would put EVERY
 * bubble in the left-hand column and then re-lay them out. Reading it as "no
 * message is mine yet" is what that produces; it is a visible flicker rather
 * than a wrong claim, and there is nothing better available until the id lands.
 *
 * `now` IS A PARAMETER, NOT `Date.now()` READ INSIDE. It is what makes "Today"
 * a fact about the arguments — the same reason `timeZone` is threaded through
 * rather than left to the host.
 */
export function messageRows(
  messages: Array<ChatMessage>,
  myPlayerId: Id<'players'> | null | undefined,
  now: number,
  timeZone?: string,
  locale?: string,
): Array<MessageRow> {
  const rows = messages.map((message, index) => {
    const previous = index === 0 ? undefined : messages[index - 1]
    const separator = separatorBefore(message, previous, now, timeZone, locale)
    const opens = startsRun(message, previous, separator !== null)
    const mine = myPlayerId !== undefined && myPlayerId !== null && message.playerId === myPlayerId
    return {
      message,
      mine,
      startsRun: opens,
      // Filled in below, once the next row's `startsRun` is known.
      endsRun: true,
      showsName: showsAuthorName(opens, mine),
      separator,
    }
  })

  for (let index = 0; index < rows.length - 1; index++) {
    rows[index].endsRun = rows[index + 1].startsRun
  }
  return rows
}

/* ---------------------------------------------------------------------------
 * The two iMessage gestures (wordle-teams-qix.26, part 3).
 *
 * EVERYTHING BELOW IS A DECISION, AND EVERY ONE OF THEM WOULD OTHERWISE LIVE
 * INSIDE A POINTER HANDLER IN message-list.tsx. This suite runs on
 * edge-runtime with no DOM and collects `*.test.ts` only, so a threshold
 * compared inline in an `onPointerMove` is a threshold asserted by nothing —
 * the same argument `messageRows` is built on. The component keeps the timers,
 * the refs and the element it writes a transform onto; it decides none of the
 * numbers.
 * ------------------------------------------------------------------------ */

/**
 * BOTH GESTURES ARE TOUCH GESTURES, AND THAT IS THE DESKTOP ANSWER.
 *
 * A mouse has a right button, so the delete menu has a real desktop
 * affordance: `contextmenu` opens the same menu the long press does, and no
 * press timer is ever armed for a mouse (a mouse press that sits still for
 * half a second is someone reading, not someone asking for anything).
 *
 * THE TIMESTAMP REVEAL GETS NO DESKTOP EQUIVALENT AT ALL, deliberately. There
 * is no drag-to-reveal idiom on a mouse; a horizontal drag across a message
 * list means "select this text", which is the one thing a desktop reader
 * actually does in a chat log, and consuming it to slide the conversation
 * sideways would trade a real interaction for a decorative one. A trackpad's
 * two-finger horizontal swipe arrives as a `wheel` event and would not reach a
 * pointer handler regardless. The information is not withheld: part 2's time
 * separators already stamp the conversation at every hour-long pause and every
 * day boundary, which is where a desktop reader finds a message's time.
 */
export function isTouchGesture(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen'
}

/**
 * How long a finger must rest on a bubble before its menu opens, and how far
 * it may stray in the meantime.
 *
 * 500ms IS THE BRIEF'S NUMBER AND IT IS FASTER THAN RADIX'S OWN CONTEXT-MENU
 * TIMER (700ms). iOS opens its own callout at roughly this point, so a longer
 * press is a press that has already been answered by something else.
 *
 * THE SLOP IS THE WHOLE BUG THIS PATTERN IS FAMOUS FOR. A list is scrolled by
 * putting a finger on a message and moving it, which is a press on a bubble
 * that lasts far longer than half a second; without a movement threshold every
 * scroll of a conversation ends with a delete menu over whichever bubble the
 * finger happened to land on. 10 CSS pixels is under a finger's own resting
 * jitter but far under the 8px at which this file commits a drag to an axis,
 * so a gesture that has been recognised as a swipe has already cancelled the
 * press it started as.
 */
export const LONG_PRESS_MS = 500
export const LONG_PRESS_SLOP_PX = 10

export type PressPoint = { x: number; y: number }

/**
 * Whether a pointer has wandered far enough since it went down to mean
 * something other than a long press.
 *
 * STRAIGHT-LINE DISTANCE, NOT PER-AXIS. A diagonal drag of 9px across and 9px
 * down is 12.7px of movement and is plainly a drag; a rule comparing each axis
 * against the slop separately would call it a stationary press.
 */
export function movedOffPress(
  start: PressPoint,
  current: PressPoint,
  slop: number = LONG_PRESS_SLOP_PX,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > slop
}

/**
 * Which keys open a bubble's menu.
 *
 * THIS EXISTS BECAUSE THE VISIBLE DELETE LINK IS GONE. Replacing a control
 * anyone could tab to with a gesture only a pointer can perform would put
 * deletion out of reach of a keyboard entirely, so the bubble is focusable and
 * these three keys open the same menu the long press does. They are the three
 * Radix's own menu triggers answer to, which is what makes this consistent
 * with every other menu in the app (the app menu, the team picker, the month
 * picker) rather than a fourth convention.
 *
 * `ContextMenu`/`Shift+F10` IS NOT LISTED AND IS STILL HANDLED: browsers fire
 * a `contextmenu` event for those on the focused element, which is the same
 * event a right-click delivers, so the menu's `onContextMenu` already answers
 * them.
 */
export function opensMenuFromKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'ArrowDown'
}

/**
 * How far the conversation slides left at a full reveal, in CSS pixels.
 *
 * THIS IS A WIDTH BUDGET, NOT A FEEL. The label's LEFT edge is parked exactly
 * on the clip boundary (see the stamp's `left-full ml-4` in message-list.tsx),
 * so the slide is the only thing that uncovers it and this number is the whole
 * of how much of it can be uncovered. A label wider than this would have its
 * tail clipped at full reveal.
 *
 * 72px IS THE WIDEST LABEL PLUS ROOM. Measured in the page's own font — Inter
 * at `text-[11px]` with `tabular-nums`, in headless chromium against the built
 * stylesheet — the formatter's widest output is en-US `12:00 AM` at 52px;
 * `10:38 PM` and `11:58 PM` are 51px, and every 24-hour locale is 31px. At 72px
 * of travel the widest lands 20px clear of the viewport's right edge and the
 * narrowest 41px.
 *
 * IT WAS 56px AND THAT WAS TOO TIGHT, which is the second half of the bug this
 * number is now sized against: 56 left the widest label 4px from the edge, and
 * a margin of four pixels is not a margin. The first half was that the label
 * was not parked on the clip boundary at all — see message-list.tsx.
 */
export const TIME_REVEAL_PX = 72

/**
 * How far the pointer must move before the gesture is committed to an axis.
 *
 * UNDER THE LONG-PRESS SLOP, DELIBERATELY, so the two thresholds resolve in
 * the order they have to: by the time a drag is a drag, the press it began as
 * is already cancelled.
 */
export const AXIS_LOCK_SLOP_PX = 8

export type DragAxis = 'undecided' | 'horizontal' | 'vertical'

/**
 * Which way a drag has committed, given how far it has travelled.
 *
 * THE LOCK IS THE WHOLE REASON THE REVEAL DOES NOT FIGHT THE SCROLL. A finger
 * never moves on exactly one axis, so a reveal driven by raw horizontal
 * displacement slides the conversation sideways during every vertical scroll.
 * Answering `undecided` until the movement is unambiguous, and then answering
 * the SAME thing for the rest of the gesture (the caller keeps the answer), is
 * what makes a scroll a scroll and a swipe a swipe.
 *
 * `undecided` IS NOT `vertical`, AND THE DIFFERENCE MATTERS. Until the slop is
 * cleared nothing has been decided, so nothing moves and nothing is refused;
 * collapsing the two would make the first eight pixels of every swipe a
 * scroll, which is what a reveal that "feels sticky" is made of.
 *
 * TIES GO TO VERTICAL. `>` rather than `>=` on the horizontal comparison means
 * a perfectly diagonal drag scrolls, which is the safer failure: a reveal that
 * did not open costs a reader nothing, and a scroll that did not happen is the
 * app refusing to move.
 */
export function dragAxis(dx: number, dy: number, slop: number = AXIS_LOCK_SLOP_PX): DragAxis {
  if (Math.abs(dx) <= slop && Math.abs(dy) <= slop) return 'undecided'
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
}

/**
 * How far the conversation is translated left, for a horizontal drag of `dx`.
 *
 * LEFTWARD ONLY. `dx >= 0` is a drag to the RIGHT, and there is nothing on the
 * left of a message to reveal — sliding the conversation the other way would
 * open a strip of empty background and drag the bubbles off their own edge.
 *
 * CLAMPED AT THE STRIP'S WIDTH RATHER THAN TRACKING THE FINGER FOREVER. The
 * timestamp is fully visible at `TIME_REVEAL_PX`; every pixel past that moves
 * the conversation off screen to show something already on screen. A hard
 * clamp also means the release always animates the same distance, so the
 * snap-back reads as one motion rather than as a variable-length rewind.
 */
export function revealOffset(dx: number, max: number = TIME_REVEAL_PX): number {
  if (dx >= 0) return 0
  return Math.min(-dx, max)
}

/**
 * How long the snap-back takes when the finger lifts.
 *
 * ZERO UNDER `prefers-reduced-motion`, WHICH IS THE HONEST ANSWER RATHER THAN
 * A SHORTER ANIMATION. The drag itself is not animation — it is the
 * conversation following a finger, one-to-one, and stopping that would be
 * removing the gesture rather than damping it. The release is the only part
 * the app animates on its own, so the release is the only part the preference
 * governs.
 *
 * ASKED IN JAVASCRIPT, per this repo's rule (lib/use-reduced-motion.ts): a
 * `@media (prefers-reduced-motion: reduce)` block in styles.css is a rule no
 * gate here can observe, because vitest has no CSSOM. This is a number a test
 * can read.
 */
export function revealSnapBackMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 180
}

/**
 * The argument `unreadTeams` takes: the caller's team ids, sorted.
 *
 * WHY THE QUERY TAKES IDS AT ALL (wordle-teams-w7g2). It used to take none and
 * work the list out server-side, which meant a full scan of the `teams` table
 * on every execution — and, far worse, a read set covering that whole table, so
 * ANY team write anywhere in the app re-fired this subscription for EVERY
 * connected player. The client already holds its own teams (routes/app.tsx has
 * them from `api.teams.getMyTeams`), so handing them over turns an app-wide
 * fan-out into three small documents per team. Membership is still checked
 * per id on the server — see unreadTeamsFor — because an argument is not a
 * permission.
 *
 * SORTED, AND THAT IS THE WHOLE REASON THIS IS A FUNCTION RATHER THAN AN INLINE
 * `.map`. The TanStack query key hashes the arguments, so the ids ARE the key:
 * two callers building the same set in a different order would open two
 * subscriptions and run the query twice for one answer. Sorting makes the key a
 * function of the SET. (routes/app.tsx derives it once and passes it down,
 * which is belt and braces — this is the braces.)
 *
 * COPIES BEFORE SORTING. `.sort()` mutates in place, and the array it is given
 * is derived from the `teams` list the picker renders IN CREATED ORDER; `.map`
 * already returns a fresh array, and that is load-bearing rather than
 * incidental.
 *
 * `undefined` IN, `undefined` OUT, WHICH IS NOT `[]`. An unresolved teams list
 * is not an empty one: `[]` is a real question with the real answer "nothing
 * unread", and `hasUnread` would settle on it. `undefined` skips the query
 * instead and leaves `hasUnread` in its not-loaded branch — see useUnreadTeams.
 */
export function unreadTeamIds(
  teams: Array<{ id: string }> | undefined,
): Array<Id<'teams'>> | undefined {
  if (teams === undefined) return undefined
  return teams.map((team) => team.id as Id<'teams'>).sort()
}

/** What `api.chat.unreadTeams` answers — see unreadBadgeFor in convex/chat.ts. */
export type UnreadAnswer = { unread: Array<Id<'teams'>>; degraded: boolean }

/**
 * The arguments the badge subscription may be opened with, or `'skip'`.
 *
 * TWO REASONS NOT TO OPEN IT, AND THEY ARE DELIBERATELY ONE ANSWER.
 *
 * The first is the older one: the ids are not known yet.
 * @convex-dev/react-query turns `'skip'` into `enabled: false`, leaving `data`
 * `undefined` — which `hasUnread` and `hasUnreadElsewhere` already read as "not
 * loaded, draw nothing". Passing `{ teamIds: [] }` instead would fetch a
 * genuine `[]` and let the badge claim "nothing unread" about a list it has not
 * seen.
 *
 * The second is wordle-teams-pnhe: while the month is degraded this
 * subscription is the one the valve has to shed, and it is the one with the
 * wider reach — held on /app by essentially every authenticated session, with
 * `chatMeta` for every team the caller is on in its read set, so a send in any
 * of their teams re-fired it while chat was supposedly quiet.
 *
 * `'skip'` IS ONLY HALF OF SHEDDING, AND THE HOOK OWES THE OTHER HALF. Setting
 * `enabled: false` removes the observer; @convex-dev/react-query closes its
 * Convex watch on the query cache's `removed` event and, in as many words,
 * deliberately NOT on `observerRemoved`. So this alone leaves the websocket
 * alive for a full gcTime — five minutes by default — per degraded client. See
 * `shouldDropSubscription`, which is the same rule the pointer uses, and
 * use-unread-teams.hook.test.ts, which proves the socket actually closes.
 */
export function unreadArgs(
  teamIds: Array<Id<'teams'>> | undefined,
  mode: PointerMode,
): { teamIds: Array<Id<'teams'>> } | 'skip' {
  if (teamIds === undefined || mode === 'manual') return 'skip'
  return { teamIds }
}

/**
 * THE ONE PLACE `api.chat.unreadTeams` IS NAMED, AND NOW THE ONE PLACE IT IS
 * CALLED. routes/app.tsx holds it and hands the answer down to TeamPicker and
 * to every UnreadBadge, rather than each of them calling this for itself.
 *
 * THAT STOPPED BEING A STYLE PREFERENCE WHEN THE HOOK LEARNED TO SHED
 * (wordle-teams-pnhe). Sharing a query key was always enough to share one
 * subscription; it is NOT enough to remove one. `queryClient.removeQueries`
 * tears the entry out of the cache, and an observer still watching that key
 * simply rebuilds it and refetches — so a second caller would either re-open
 * the socket the first one just closed, or (worse) have its own subscription
 * removed out from under it. The pointer met the same constraint from the other
 * side, and routes/chat.tsx dropped its own `useChatPointer` call for it: ONE
 * OBSERVER IS THE PRECONDITION FOR REMOVING A QUERY. Here it is guaranteed by
 * there being one caller, not by effect ordering between components.
 *
 * THE ANSWER IS HELD IN STATE RATHER THAN READ OFF THE QUERY, for the reason
 * `useChatMessages` holds `seen`: the query is gone once shed, so `data` would
 * be `undefined` and every dot on the dashboard would VANISH the instant chat
 * degraded — reporting something false where the honest answer is "the last
 * thing we heard". It also makes the mode self-healing in the one way that is
 * available here: a fresh mount starts with nothing seen, so a load or a
 * navigation re-opens the subscription and learns whether the flag has cleared.
 *
 * THERE IS NO REFRESH BUTTON, AND THAT IS THE DIFFERENCE FROM THE POINTER. A
 * conversation that stops updating needs an affordance; a dot does not, and
 * adding one would be a control whose entire job is to spend the bandwidth the
 * valve just saved. Design §6 asks for chat to degrade, not for it to keep its
 * liveness by another route.
 */
export function useUnreadTeams(teamIds: Array<Id<'teams'>> | undefined): {
  unread: Array<Id<'teams'>> | undefined
  degraded: boolean
} {
  const [seen, setSeen] = useState<UnreadAnswer | null>(null)
  const mode = pointerMode(seen)
  const query = useQuery(convexQuery(api.chat.unreadTeams, unreadArgs(teamIds, mode)))
  const previousMode = useRef<PointerMode>(mode)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (query.data) setSeen(query.data)
  }, [query.data])

  // WHERE THE SOCKET IS ACTUALLY CLOSED. By the time this runs, `useQuery` has
  // already moved this render's observer onto the `'skip'` key — its own
  // `setOptions` effect is registered above this one, so it flushes first —
  // which leaves the real query in the cache with NO observers and its watch
  // still open. Removing it fires `removed`, which is the only event
  // @convex-dev/react-query unsubscribes on.
  //
  // ON THE TRANSITION, NOT ON THE STATE, exactly as the pointer does it: a rule
  // that removed on every degraded render would be removing a key nothing is
  // holding, over and over, on every unrelated re-render of the dashboard.
  useEffect(() => {
    const from = previousMode.current
    previousMode.current = mode
    if (!shouldDropSubscription(from, mode)) return
    // Guarded because the key has to be the one that was actually opened. With
    // no ids there was never a real query — `unreadArgs` answered `'skip'` for
    // that reason too — and `{ teamIds: undefined }` would name a key nothing
    // has ever subscribed to.
    if (teamIds === undefined) return
    queryClient.removeQueries({
      queryKey: convexQuery(api.chat.unreadTeams, { teamIds }).queryKey,
      exact: true,
    })
  }, [mode, teamIds, queryClient])

  return { unread: seen?.unread, degraded: mode === 'manual' }
}

/**
 * Whether a team should show an unread dot, given the whole cross-team answer.
 *
 * `undefined` IS "NOT LOADED YET" AND MUST READ AS "NO DOT" — the same
 * deliberate branch `nameFor` and `canDelete` carry in routes/chat.tsx, for
 * the same reason. TanStack leaves `data` `undefined` until `unreadTeams`
 * resolves, and an empty array is its real "nothing unread" answer. Collapsing
 * the two would be harmless in one direction and a lie in the other: showing
 * no dot for a moment is invisible, whereas defaulting the unknown state to a
 * dot would flash a badge on every team on every page load.
 *
 * THE ARRAY IS THE WHOLE ANSWER, not a per-team query. Every badge on a page
 * calls `useUnreadTeams` with the SAME ids, so they share one TanStack query
 * key and therefore one Convex subscription — rendering ten badges costs one
 * read, not ten. That is only true while nothing parameterises this by a single
 * team; see `unreadTeamIds` for what keeps the shared argument shared.
 */
export function hasUnread(
  unread: Array<Id<'teams'>> | undefined,
  teamId: Id<'teams'>,
): boolean {
  if (unread === undefined) return false
  return unread.includes(teamId)
}

/**
 * Whether any team OTHER than the one on screen has unread messages.
 *
 * WHY A SECOND QUESTION EXISTS AT ALL. The per-team dots live inside
 * TeamPicker's DropdownMenuContent, and Radix UNMOUNTS that content when the
 * menu is closed — so at rest, which is almost always, they render nowhere.
 * They only appear once the menu is already open, which is precisely when
 * nobody still needs a signal telling them to open it. The trigger dot this
 * feeds is what makes the row dots reachable; without it the whole badge only
 * ever answers about the team you are already looking at.
 *
 * "OTHER THAN", NOT "ANY". The selected team's own unread is already shown by
 * the "Team chat" button beside the picker, so counting it here would draw two
 * dots for one fact — and worse, would leave the trigger lit while you sit
 * reading that very conversation, which teaches a reader to ignore it.
 *
 * BUILT ON `hasUnread` RATHER THAN RE-DERIVING ITS LOADED CHECK, which is the
 * `undefined`-versus-`[]` distinction: TanStack leaves `data` `undefined` until
 * the query resolves, and reading that as "unread" would flash a dot on every
 * page load. Here `unread?.length ?? 0` counts an unresolved query as nothing
 * unread, and `hasUnread` — the one place that rule is written down — decides
 * the only other term. A team appears in `unreadTeams` at most once —
 * unreadTeamsFor DEDUPES the ids it is handed before walking them, precisely so
 * this subtraction stays honest now that the list comes from the client — so
 * subtracting the selected team is subtracting exactly one entry, never a
 * range.
 *
 * `selected` MAY BE `undefined`, and that is a real state rather than
 * defensiveness: routes/app.tsx renders TeamPicker for the renders before
 * useDashboardSearchSync has filled `?team=` in, and a stale param can name a
 * team the player is no longer on. With nothing selected, every unread team is
 * an "other" one, which is the honest answer.
 */
export function hasUnreadElsewhere(
  unread: Array<Id<'teams'>> | undefined,
  selected: Id<'teams'> | undefined,
): boolean {
  const total = unread?.length ?? 0
  const selectedIsUnread = selected !== undefined && hasUnread(unread, selected)
  return total - (selectedIsUnread ? 1 : 0) > 0
}

/**
 * The accessible name for TeamPicker's trigger — the SAME shape it has always
 * had, plus a clause when some other team has unread.
 *
 * IT LIVES HERE, BESIDE `chatEntryLabel`, BECAUSE THE ONLY REASON IT VARIES IS
 * CHAT. The two are the whole of how unread state is announced, and they are
 * worth reading together; team-picker.tsx keeps the label's other decision (the
 * FULL team name, never the truncated one the trigger paints) in its own
 * comment where the truncation is.
 *
 * THE CLAUSE IS APPENDED TO THE NAME RATHER THAN LEFT TO THE DOT. `aria-label`
 * replaces an element's content in the accessibility tree, so a dot rendered
 * inside the trigger is silent no matter what it says about itself — the same
 * constraint `chatEntryLabel` exists for. Appending is also why the clause has
 * to be about OTHER teams explicitly: a bare "unread messages" tacked onto
 * "Team: Alpha" would read as a claim about Alpha, which is the one team it is
 * guaranteed not to be about.
 *
 * THE UNREAD-FREE NAME IS BYTE-FOR-BYTE WHAT IT WAS, which two e2e specs
 * depend on: teams.spec.ts and billing.spec.ts locate this trigger by its
 * exact accessible name (`Team: E2E Team`), and Playwright's `name` option
 * matches the whole string. Their seeds post no chat messages, so no team is
 * ever unread there and the clause never appears — but a spec that did seed a
 * message would need to expect it, and that is a property of this function
 * rather than a coincidence of the markup.
 */
export function teamPickerLabel(name: string, unreadElsewhere: boolean): string {
  return unreadElsewhere ? `Team: ${name}, other teams have unread messages` : `Team: ${name}`
}

/**
 * The accessible name for the dashboard's "Team chat" control, which changes
 * with the unread state rather than staying "Team chat" and leaving the dot to
 * speak for itself.
 *
 * IT HAS TO CHANGE, BECAUSE THE DOT CANNOT BE HEARD THERE. That control is a
 * Button rendered `asChild` around a Link, and it carries an `aria-label` for
 * an unrelated reason: below `sm` its text label is `hidden`, so without one
 * the accessible name would be empty. But `aria-label` REPLACES the element's
 * content in the accessibility tree — every descendant of it, `UnreadBadge`'s
 * own `role="img"` / `aria-label="Unread messages"` included. So the badge is
 * decoration inside this particular button no matter what it says about
 * itself, and the only place the unread state can be announced is the button's
 * own name.
 *
 * DIFFERENT FROM THE TEAM PICKER, DELIBERATELY. A `DropdownMenuRadioItem`
 * takes its name FROM its content, so the badge's own label is read there and
 * nothing extra is needed — which is why this is a function about one control
 * and not a rule applied to both.
 *
 * PURE, AND TESTED, FOR `hasUnread`'S REASON: it is a decision (what a screen
 * reader is told) rather than wiring, and routes/app.tsx is a `.tsx` file that
 * this suite — edge-runtime, no DOM, `*.test.ts` only — cannot render.
 */
export function chatEntryLabel(unread: boolean): string {
  return unread ? 'Team chat, unread messages' : 'Team chat'
}

export type ChatHeadingState =
  | { kind: 'pending' }
  | { kind: 'named'; name: string }
  | { kind: 'unnamed' }

/**
 * What the chat page's heading may claim, given `getMyTeams` and the team in
 * the URL.
 *
 * THE PAGE NEVER NAMED THE CONVERSATION AT ALL BEFORE THIS, which matters most
 * for the visitor it was least able to help: the push notification's body is
 * "New messages in TEAMNAME", and tapping it landed someone on a route that
 * showed a message list and a composer and nothing that confirmed WHICH team
 * they had opened.
 *
 * THREE STATES, BECAUSE TWO WOULD LIE IN ONE OF THEM. `teams` is `undefined`
 * until getMyTeams resolves and an ARRAY WITHOUT THIS TEAM when the visitor is
 * not on it — a stale link, a team they have left, or the outsider
 * e2e/chat.spec.ts drives at this route deliberately. Collapsing those two into
 * "no name" would be harmless; collapsing either into a NAME is the bug
 * routes/chat.tsx's `nameFor` comment describes, one heading up: a claim
 * asserted from data that has not arrived. So the caller gets to render a
 * placeholder for one and a generic title for the other.
 *
 * `unnamed` IS ALSO A PRIVACY BOUNDARY, not only a correctness one. The team
 * whose chat an outsider cannot read is a team whose NAME they should not be
 * handed either, and this returns the same answer for "not a member" as for
 * "no such team" — the caller has nothing to leak.
 */
export function chatHeading(
  teams: Array<{ id: string; name: string }> | undefined,
  teamId: Id<'teams'>,
): ChatHeadingState {
  if (teams === undefined) return { kind: 'pending' }
  const team = teams.find((candidate) => candidate.id === teamId)
  return team === undefined ? { kind: 'unnamed' } : { kind: 'named', name: team.name }
}

/**
 * Fetch `recentMessages` fresh, bypassing TanStack's cache.
 *
 * `convexQuery` sets `staleTime: Infinity` (see @convex-dev/react-query's
 * source) so that a LIVE `useQuery` subscription never treats its own
 * pushed updates as stale. But `queryClient.fetchQuery` is not a
 * subscription — it is a one-shot imperative call — and `fetchQuery` honours
 * that same `staleTime` by skipping the network entirely and handing back
 * whatever is already cached under this exact query key
 * (`query-core`'s `fetchQuery`: `isStaleByTime(staleTime) ? query.fetch(...)
 * : Promise.resolve(query.state.data)`). `recentMessages`'s args are always
 * just `{ teamId }`, so every call after the first would share one cache
 * entry and — with the default `staleTime: Infinity` — every call after the
 * first would silently return the FIRST window ever fetched, forever. That
 * is exactly the bug this hook exists to avoid: a delete would bump
 * `revision`, trigger a `window` action, and re-render the same stale list
 * with the deleted message still in it. Overriding `staleTime: 0` here is
 * what makes each `window` action actually re-read the database.
 */
function loadWindow(queryClient: ReturnType<typeof useQueryClient>, teamId: Id<'teams'>) {
  return queryClient.fetchQuery({
    ...convexQuery(api.chat.recentMessages, { teamId }),
    staleTime: 0,
  })
}

/**
 * Fetch `messagesSince` fresh, for the same reason `loadWindow` overrides
 * `staleTime`. `since` normally advances on every call, so this mostly would
 * not hit the cache anyway — but "mostly" is not a guarantee, and a stale
 * `since` result would silently drop messages rather than merely re-show one.
 */
function loadSince(queryClient: ReturnType<typeof useQueryClient>, teamId: Id<'teams'>, since: number) {
  return queryClient.fetchQuery({
    ...convexQuery(api.chat.messagesSince, { teamId, since }),
    staleTime: 0,
  })
}

/**
 * Read the pointer ONCE, and leave no subscription behind.
 *
 * THE `finally` IS THE HALF THAT MATTERS. `fetchQuery` puts the result in the
 * query cache under the pointer's own key, and @convex-dev/react-query opens a
 * Convex watch on the cache's `added` event — so a refresh that merely fetched
 * would re-open, for a full gcTime, exactly the subscription degradation just
 * dropped. Removing the query fires `removed`, which is where that library
 * unsubscribes. The read costs one wake; the socket is not held.
 *
 * `staleTime: 0` FOR loadWindow'S REASON, and it is not optional here either:
 * `convexQuery` sets `staleTime: Infinity` so a live subscription never treats
 * its own pushed updates as stale, and `fetchQuery` honours that by returning
 * cached data without going to the network. A refresh that returned the value
 * it already had would leave a degraded client permanently unable to learn
 * anything — including that degradation had ended.
 */
async function readPointerOnce(
  queryClient: ReturnType<typeof useQueryClient>,
  teamId: Id<'teams'>,
): Promise<ChatPointerValue> {
  const options = convexQuery(api.chat.pointer, { teamId })
  try {
    return await queryClient.fetchQuery({ ...options, staleTime: 0 })
  } finally {
    const cached = queryClient.getQueryCache().find({ queryKey: options.queryKey, exact: true })
    if (cached && shouldReleaseAfterRead(cached.getObserversCount())) {
      queryClient.removeQueries({ queryKey: options.queryKey, exact: true })
    }
  }
}

/**
 * Holds one team's messages and keeps them current.
 *
 * The pointer is the only subscription. Everything else runs in response to it
 * moving, which is what keeps a wake at roughly 450 bytes instead of a whole
 * window — see the design's section 4.
 *
 * AND WHILE THE MONTH IS DEGRADED IT HOLDS NO SUBSCRIPTION AT ALL (design §6,
 * wordle-teams-vd1j). `seen` is the last pointer from EITHER source — the live
 * subscription or `refresh`'s one-shot read — and `pointerMode` turns it into
 * the decision to subscribe or not, which is why a refresh is all it takes to
 * both catch up on messages and, when the flag has cleared, resume live. What
 * the effect below does with a pointer is identical in both modes; the only
 * difference is what delivered it.
 *
 * THE EFFECT DOES NOT DEPEND ON `messages`, UNLIKE THE SKETCH THIS WAS BUILT
 * FROM. That sketch is not a runaway loop — `previousPointer.current` is
 * already advanced synchronously by the time `setMessages` triggers the
 * extra invocation, so `nextSyncAction` sees the same pointer twice, returns
 * `{kind:'none'}`, and nothing further changes. But it is still a bounded
 * wasted effect invocation on every single state update: one extra pass
 * through this whole effect for nothing. Dropping `messages` from the deps
 * avoids that reinvocation entirely rather than merely bounding it. `heldRef`
 * carries the current holdings across renders instead, updated by its own
 * effect that depends only on `messages` — so the sync effect can read them
 * without depending on them. `previousPointer` plays the same role for the
 * last-seen pointer value.
 *
 * A TEAM SWITCH RESETS BOTH REFS. This component has no team switcher today
 * — `/chat?team=<id>` is set once per navigation — but the hook does not get
 * to assume that stays true, and `teamId` already has to be an effect
 * dependency so the pointer resubscribes. Without the reset, switching teams
 * without an unmount would compare team B's pointer against team A's last
 * value and compute `since` against team A's held timestamps: wrong actions,
 * not merely stale ones. The reset also bumps `requestId` (see below) so a
 * still-in-flight fetch from the old team cannot land after the switch.
 *
 * `requestId` GUARDS AGAINST OUT-OF-ORDER RESOLUTION. The pointer can fire
 * again before a fetch it already triggered has resolved — a live
 * conversation does this routinely, not rarely — and `fetchQuery` promises
 * are not guaranteed to settle in dispatch order. Every dispatch stamps
 * itself with the counter's new value and every resolve checks
 * `isCurrentRequest` before touching state, so a response that arrives after
 * being superseded is discarded rather than applied over newer data. The
 * gap-triggered window refetch stamps itself again with the SAME `mine`
 * rather than allocating a new id: it is still answering the one dispatch
 * that triggered it, so a third dispatch happening while it is in flight
 * must invalidate it exactly the same way.
 *
 * `isMountedRef` GUARDS AGAINST A DIFFERENT FAILURE THAN `requestId`.
 * `requestId`/`isCurrentRequest` answer "has a newer dispatch superseded this
 * one" — `isMountedRef` answers "does the component this is updating still
 * exist." A `window` or `since` fetch can resolve after the user has already
 * navigated away from `/chat`, and being the most recent dispatch does
 * nothing to stop `setMessages` from firing on a torn-down component.
 *
 * DELIBERATELY NOT A PER-INVOCATION `cancelled` FLAG RETURNED FROM THIS
 * EFFECT'S OWN CLEANUP — that is the obvious version, and it is wrong. Strict
 * Mode double-invokes this effect, firing the first run's cleanup before the
 * second run starts. This effect already handles that double-invocation
 * correctly for an unrelated reason: `previousPointer.current` advances
 * synchronously inside run 1, so run 2 sees the same pointer, `nextSyncAction`
 * returns `{kind:'none'}`, and nothing redispatches. That means run 1's
 * promise is the ONLY one that will ever deliver the first window — there is
 * no second dispatch waiting to pick up the work if it gets cancelled. A
 * `cancelled` flag set by run 1's own cleanup would cancel that one and only
 * fetch, silently dropping the initial load in dev with nothing left to
 * redispatch it. `isMountedRef` lives in its own effect with an empty
 * dependency array instead, so Strict Mode's synthetic unmount-and-remount
 * nets back to `true` before anything checks it, and it only goes `false` on
 * a genuine unmount.
 */
export function useChatMessages(teamId: Id<'teams'>) {
  // THE LAST POINTER SEEN, WHEREVER IT CAME FROM — the live subscription or a
  // manual refresh. Everything below reads this rather than `pointer.data`,
  // which is what lets the two sources drive one sync path instead of two, and
  // what makes `mode` self-healing (see `pointerMode`).
  const [seen, setSeen] = useState<SeenPointer | null>(null)
  // THE POINTER FOR THIS TEAM, or null while the newest one held is another
  // team's — see `pointerFor`, which is what makes a team switch safe without
  // an effect racing to clear this.
  const held = pointerFor(seen, teamId)
  const mode = pointerMode(held)
  const pointer = useChatPointer(teamId, mode)
  const [refreshing, setRefreshing] = useState(false)
  // A REF AS WELL AS STATE: the second tap of a double tap happens in the same
  // tick as the first, before any re-render has published `refreshing`, and it
  // is the ref that `refreshDecision` can actually see in time.
  const refreshingRef = useRef(false)
  const [messages, setMessages] = useState<Array<ChatMessage>>([])
  const heldRef = useRef<Array<ChatMessage>>(messages)
  const previousPointer = useRef<ChatPointerValue | null>(null)
  const previousTeamId = useRef(teamId)
  const previousMode = useRef<PointerMode>(mode)
  const requestId = useRef(0)
  const isMountedRef = useRef(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    heldRef.current = messages
  }, [messages])

  // THE LIVE SUBSCRIPTION'S ONLY JOB IS TO FEED `seen`. While degraded the
  // query is skipped, so `data` is `undefined` and this does nothing — the
  // refresh writes the same state instead.
  useEffect(() => {
    if (pointer.data) setSeen({ teamId, value: pointer.data })
  }, [pointer.data, teamId])

  // WHERE THE SUBSCRIPTION IS ACTUALLY DROPPED, rather than merely stopped
  // being read. `useChatPointer` has already moved this render's observer onto
  // the `'skip'` key, which leaves the real query in the cache with no
  // observers — and @convex-dev/react-query keeps its websocket watch until the
  // cache says `removed`, deliberately not on `observerRemoved` (a full gcTime
  // later, five minutes by default). Removing it here is what makes degrading
  // cost nothing instead of costing five more minutes per client.
  //
  // ONE OBSERVER IS THE PRECONDITION, and it is why routes/chat.tsx no longer
  // calls `useChatPointer` on its own: two components observing this key would
  // mean removing a query somebody else is still watching.
  useEffect(() => {
    const from = previousMode.current
    previousMode.current = mode
    if (!shouldDropSubscription(from, mode)) return
    queryClient.removeQueries({
      queryKey: convexQuery(api.chat.pointer, { teamId }).queryKey,
      exact: true,
    })
  }, [mode, teamId, queryClient])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    // Checked, and the counter bumped, BEFORE the `!current` guard below: the
    // new team's own pointer can still be loading when this runs, and an old
    // team's fetch dispatched before the switch must not be allowed to land
    // just because nothing has dispatched for the new team yet.
    if (previousTeamId.current !== teamId) {
      previousTeamId.current = teamId
      previousPointer.current = null
      heldRef.current = []
      setMessages([])
      requestId.current += 1
      // `seen` IS NOT CLEARED HERE, AND MUST NOT BE. The new team's pointer may
      // already have been adopted in this same commit (its value can be in
      // TanStack's cache from an earlier visit), so clearing would throw away
      // the right answer as often as the wrong one. `pointerFor` below makes
      // the old team's value inert instead — including for `mode`, which reads
      // `live` again through the same route, putting a client that was degraded
      // on the old team back on a subscription for the new one.
    }

    const current = pointerFor(seen, teamId)
    if (!current) return

    const held = heldRef.current
    const newestHeld = held.length === 0 ? 0 : held[held.length - 1].createdAt
    const action = nextSyncAction(previousPointer.current, current, newestHeld)
    previousPointer.current = current

    if (action.kind === 'none') return

    const mine = ++requestId.current

    if (action.kind === 'window') {
      void loadWindow(queryClient, teamId).then((result) => {
        if (!isCurrentRequest(mine, requestId.current) || !isMountedRef.current) return
        setMessages(result)
      })
      return
    }

    void loadSince(queryClient, teamId, action.since).then((result) => {
      if (!isCurrentRequest(mine, requestId.current) || !isMountedRef.current) return

      const outcome = nextSinceOutcome(heldRef.current, result)
      if (outcome.kind === 'window') {
        void loadWindow(queryClient, teamId).then((windowResult) => {
          // Re-checked: this second, chained fetch can itself be superseded
          // by a new dispatch, or outlive the component, while it is in
          // flight — same as the first.
          if (!isCurrentRequest(mine, requestId.current) || !isMountedRef.current) return
          setMessages(windowResult)
        })
        return
      }
      setMessages(outcome.messages)
    })
    // `queryClient` is stable across renders (the same instance the provider
    // hands out) and `loadWindow`/`loadSince` are plain module-level functions
    // closing over nothing from this render, so neither belongs in this list.
    // `messages` is deliberately excluded — see the doc comment above.
  }, [seen, teamId, queryClient])

  /**
   * READ THE POINTER ONCE AND SYNC FROM IT — the whole of what replaces the
   * subscription while degraded.
   *
   * IT NEEDS NO SYNC LOGIC OF ITS OWN. Writing `seen` re-runs the effect above,
   * which runs the same `nextSyncAction` a pushed pointer would have: nothing
   * when the revision has not moved, `since` for new messages, a window for a
   * delete. And because `mode` is derived from `seen`, a refresh that comes back
   * clean re-opens the live subscription on the next render without this
   * function knowing that degradation can end.
   *
   * REJECTS RATHER THAN SWALLOWING, like handleSend and handleDelete in
   * routes/chat.tsx: the reader ASKED for this, so a failure has to be visible.
   * The route toasts it.
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (refreshDecision({ mode, inFlight: refreshingRef.current }).kind === 'skip') return
    refreshingRef.current = true
    setRefreshing(true)
    try {
      const value = await readPointerOnce(queryClient, teamId)
      if (!isMountedRef.current) return
      // STAMPED WITH THE TEAM IT WAS READ FOR, so a read that lands after a
      // team switch is inert rather than wrong — the same job `requestId` does
      // for a superseded message fetch.
      setSeen({ teamId, value })
    } finally {
      refreshingRef.current = false
      if (isMountedRef.current) setRefreshing(false)
    }
  }, [mode, teamId, queryClient])

  return {
    messages,
    degraded: mode === 'manual',
    mode,
    // NOT `pointer.isPending` STRAIGHT THROUGH — a skipped query is pending for
    // ever. See `chatLoadState`.
    loadState: chatLoadState({
      seen: held,
      isPending: pointer.isPending,
      hasError: pointer.error !== null,
    }),
    refresh,
    refreshing,
  }
}
