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
 * THE EFFECT DOES NOT DEPEND ON `messages`. The sketch this was built from
 * did, and that is a re-render loop: the effect calls `setMessages`, which
 * changes `messages`, which is a dependency of the very effect that just ran.
 * `heldRef` carries the newest-held timestamp across renders instead, updated
 * by its own effect that depends only on `messages` — so the sync effect can
 * read the current holdings without depending on them. `previousPointer`
 * plays the same role for the last-seen pointer value.
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
 */
export function useChatMessages(teamId: Id<'teams'>) {
  const pointer = useChatPointer(teamId)
  const [messages, setMessages] = useState<Array<ChatMessage>>([])
  const heldRef = useRef<Array<ChatMessage>>(messages)
  const previousPointer = useRef<ChatPointerValue | null>(null)
  const previousTeamId = useRef(teamId)
  const requestId = useRef(0)
  const queryClient = useQueryClient()

  useEffect(() => {
    heldRef.current = messages
  }, [messages])

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
        if (!isCurrentRequest(mine, requestId.current)) return
        setMessages(result)
      })
      return
    }

    void loadSince(queryClient, teamId, action.since).then((result) => {
      if (!isCurrentRequest(mine, requestId.current)) return
      // A gap means the server refused to send a truncated list rather than one
      // a caller could mistake for complete — the recovery is a window refetch.
      if (result.gap) {
        void loadWindow(queryClient, teamId).then((windowResult) => {
          // Re-checked: this second, chained fetch can itself be superseded
          // by a new dispatch while it is in flight, same as the first.
          if (!isCurrentRequest(mine, requestId.current)) return
          setMessages(windowResult)
        })
        return
      }
      setMessages((held) => [...held, ...result.messages])
    })
    // `queryClient` is stable across renders (the same instance the provider
    // hands out) and `loadWindow`/`loadSince` are plain module-level functions
    // closing over nothing from this render, so neither belongs in this list.
    // `messages` is deliberately excluded — see the doc comment above.
  }, [pointer.data, teamId, queryClient])

  return { messages, degraded: pointer.data?.degraded ?? false, isPending: pointer.isPending }
}
