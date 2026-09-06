import { convexQuery } from '@convex-dev/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * The live pointer for one team's chat.
 *
 * THIS IS THE ONLY SUBSCRIPTION CHAT HOLDS. Everything else is fetched in
 * response to it changing. The pointer is two small documents; a naive
 * subscription to the message window would be ~17x more expensive per wake,
 * which is the whole argument of the design's section 4.
 */
export function useChatPointer(teamId: Id<'teams'>) {
  return useQuery(convexQuery(api.chat.pointer, { teamId }))
}

export type ChatPointerValue = {
  lastMessageAt: number
  revision: number
  degraded: boolean
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
 * Holds one team's messages and keeps them current.
 *
 * The pointer is the only subscription. Everything else runs in response to it
 * moving, which is what keeps a wake at roughly 450 bytes instead of a whole
 * window — see the design's section 4.
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
  const pointer = useChatPointer(teamId)
  const [messages, setMessages] = useState<Array<ChatMessage>>([])
  const heldRef = useRef<Array<ChatMessage>>(messages)
  const previousPointer = useRef<ChatPointerValue | null>(null)
  const previousTeamId = useRef(teamId)
  const requestId = useRef(0)
  const isMountedRef = useRef(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    heldRef.current = messages
  }, [messages])

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
    }

    const current = pointer.data
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
  }, [pointer.data, teamId, queryClient])

  return { messages, degraded: pointer.data?.degraded ?? false, isPending: pointer.isPending }
}
