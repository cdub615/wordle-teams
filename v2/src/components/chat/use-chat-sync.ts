import { convexQuery } from '@convex-dev/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
// convex/lib/chatLimits.ts AND NOTHING ELSE FROM convex/lib. That file imports
// nothing, deliberately; lib/chat.ts reaches access.ts -> auth.ts, which throws
// at module scope without SITE_URL and cannot be tree-shaken out of a browser
// bundle. See chatLimits.ts's own header.
import { RECENT_WINDOW } from '../../../convex/lib/chatLimits.ts'

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
 * Whether a route replaces the site footer with its own full-height layout.
 *
 * ONLY /chat, AND ONLY BECAUSE /chat IS NOT A DOCUMENT. Every other route in
 * the app is prose or cards that scroll under a footer; chat is a viewport-tall
 * column whose composer is pinned to the bottom edge and whose message list
 * scrolls inside it. A footer below that either pushes the composer off screen
 * or, worse, makes the page scroll past it — which is what it did, and what the
 * owner's phone screenshot shows.
 *
 * A PATHNAME PREDICATE RATHER THAN A FLAG ON THE ROUTE, matching what this
 * codebase already does for every other route-conditional decision it makes:
 * `cachePolicyFor` (lib/cache-policy.ts) and `isMaintenanceGated`
 * (lib/maintenance.ts) are both pure functions of a pathname, tested without a
 * router. There was NO existing idiom for route-conditional CHROME — __root.tsx
 * rendered Header, Outlet and Footer unconditionally — so this follows the
 * closest thing the repo had rather than inventing a mechanism.
 *
 * THE TRAILING SLASH IS NORMALISED for the same reason those two normalise it:
 * `/chat/` and `/chat` are the same route, and a reader who arrives on the
 * former would otherwise get the footer back and the broken layout with it.
 */
export function hidesSiteFooter(pathname: string): boolean {
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname
  return normalised === '/chat'
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

/**
 * THE ONE PLACE `api.chat.unreadTeams` IS NAMED, which is what makes "one
 * subscription for every dot on the page" a property of the code rather than a
 * habit. The dashboard, the picker's trigger and every row badge call this with
 * the same `teamIds`, so they share a query key.
 *
 * `'skip'` RATHER THAN A QUERY FOR NO TEAMS when the ids are not known yet:
 * @convex-dev/react-query turns that into `enabled: false`, leaving `data`
 * `undefined` — which `hasUnread` and `hasUnreadElsewhere` already read as "not
 * loaded, draw nothing". Passing `{ teamIds: [] }` instead would fetch a
 * genuine `[]` and let the badge claim "nothing unread" about a list it has not
 * seen.
 */
export function useUnreadTeams(teamIds: Array<Id<'teams'>> | undefined) {
  return useQuery(convexQuery(api.chat.unreadTeams, teamIds === undefined ? 'skip' : { teamIds }))
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
