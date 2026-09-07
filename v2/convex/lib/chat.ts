import { accessError } from '../access.ts'
import { monthOf, toPuzzleDay } from './puzzleDay.ts'
import {
  BUDGET_THRESHOLD_BYTES,
  BYTES_PER_DELETE_WAKE,
  BYTES_PER_SCROLL_PAGE,
  BYTES_PER_WAKE,
  MAX_BODY_LENGTH,
  RATE_LIMIT_MESSAGES,
  RATE_LIMIT_SCROLLS,
  RATE_LIMIT_WINDOW_MS,
} from './chatLimits.ts'

/**
 * SERVER-ONLY. This module imports accessError, which reaches ../access.ts and
 * on to ./auth.ts, whose module scope throws without process.env.SITE_URL.
 * Importing it from the frontend ships that throw into a browser chunk — it
 * did exactly that once, and broke the /chat route while every other route
 * stayed perfectly healthy. The numbers the client needs live in
 * ./chatLimits.ts, which imports nothing. Import from there instead.
 */
export * from './chatLimits.ts'

/**
 * The rules of team chat that need no database.
 *
 * Everything here is a plain function over plain values, which is what lets it
 * be tested without convex-test and reasoned about without a ctx. The database
 * work lives in ../chat.ts. Same split as lib/scoring.ts and scores.ts.
 */


/** Twenty messages a minute, per player per team. See the note on the limit. */

/** How many messages a client loads when it opens a conversation. */

/**
 * What one client's wake costs us, in bytes, as a round upper bound: roughly
 * 200B for the pointer read (chatMeta plus the month's chatDegraded row, both
 * small) and ~250B for the one new message it then fetches.
 */
/**
 * One message document, as a round estimate. THE SINGLE PLACE THIS NUMBER
 * LIVES: BYTES_PER_WAKE, BYTES_PER_DELETE_WAKE and BYTES_PER_SCROLL_PAGE are
 * all built from it, and two of those were previously separate copies of the
 * same literal expression. Change it here and every cost in the meter moves
 * together, which is the only way they stay comparable to each other.
 */


/**
 * 700MB of Convex's 1GB monthly database-I/O allowance, leaving headroom for
 * every other query in the app. Crossing it degrades chat, never the app.
 */

/**
 * A message body, trimmed, or a refusal.
 *
 * Emoji need no special handling — they are Unicode and travel in the string,
 * which is why they are the whole of v1's rich content and cost nothing.
 */
export function requireBody(raw: string): string {
  const body = raw.trim()
  // `throw` is redundant with accessError's internal throw, but every other
  // call site in this repo writes it anyway — see the comment on accessError
  // in access.ts recording that a bare call was once a silent bypass, under a
  // signature that no longer exists. Keeping the shape uniform means a reader
  // never has to check which signature is in play before trusting the line.
  if (body.length === 0) throw accessError('INVALID_MESSAGE')
  if (body.length > MAX_BODY_LENGTH) throw accessError('INVALID_MESSAGE')
  return body
}

export type PostWindow = {
  postWindowStartedAt?: number
  postsInWindow?: number
}

/**
 * The player's next rate-limit window, or `null` if this message is refused.
 *
 * THIS IS AN AVAILABILITY CONTROL, NOT POLITENESS, and it carries no upgrade
 * messaging — see section 11 of the design, which records why chat is not
 * monetized. On a hard-capped free tier a runaway client (a loop, a stuck key,
 * a bad retry) can exhaust database I/O and make mutations start failing
 * APP-WIDE, not just in chat. Twenty a minute is set high enough that a real
 * conversation never meets it.
 *
 * Both fields are optional because a player's first message has no window yet;
 * absent is treated as an expired window, which opens a fresh one.
 *
 * Returns `null` rather than throwing, unlike requireBody: the caller (Task
 * 4's send path) has to sequence this against the membership and budget
 * checks before it knows what to throw, or whether to throw at all. This
 * function reports the refusal; it does not own the decision of what happens
 * next.
 */
export function nextPostWindow(current: PostWindow, now: number): Required<PostWindow> | null {
  const startedAt = current.postWindowStartedAt
  const count = current.postsInWindow ?? 0

  // Undefined (never posted) is treated the same as an expired window: both
  // open a fresh one at `now`. Checked explicitly rather than defaulting
  // startedAt to 0, because that default only reads as "expired" while `now`
  // is large — true of real timestamps, false of the small values tests use.
  // Correctness here should not depend on how big the clock happens to be.
  if (startedAt === undefined || now - startedAt >= RATE_LIMIT_WINDOW_MS) {
    return { postWindowStartedAt: now, postsInWindow: 1 }
  }
  if (count >= RATE_LIMIT_MESSAGES) return null

  return { postWindowStartedAt: startedAt, postsInWindow: count + 1 }
}

/**
 * Ten pages a minute, per player per team — a deliberately different number
 * from RATE_LIMIT_MESSAGES, because a scroll page and a post are not the same
 * shape of cost. A post is priced per team member (budgetIncrementFor) but
 * cheap per call; a scrollback page is priced once, for the one client that
 * asked, but at a full RECENT_WINDOW of messages — see budgetIncrementForScroll.
 * Ten a minute is generous for a human paging through history (a deliberate
 * "load everything" session covers 300 messages, ten times the initial
 * window, inside one minute) while still bounding what a scroll loop can cost:
 * at ten pages a minute one runaway client can charge at most
 * 10 * BYTES_PER_SCROLL_PAGE (75KB) a minute against the shared budget, the
 * same order of magnitude as the send limit's worst case for a small team —
 * see the note on RATE_LIMIT_MESSAGES for why that control exists at all.
 */

export type ScrollWindow = {
  scrollWindowStartedAt?: number
  scrollsInWindow?: number
}

/**
 * The player's next scroll-rate-limit window, or `null` if this page is
 * refused. Same fixed-window algorithm as nextPostWindow, over a distinct
 * field pair and a distinct limit — see RATE_LIMIT_SCROLLS for why the count
 * differs. Kept as a separate function rather than a shared generic: this
 * file already prefers one small named thing per concern (see
 * budgetIncrementFor vs. budgetIncrementForDelete) over parameterising one
 * function two ways, so a reader never has to ask "which limit does this
 * call use" before trusting a line.
 */
export function nextScrollWindow(current: ScrollWindow, now: number): Required<ScrollWindow> | null {
  const startedAt = current.scrollWindowStartedAt
  const count = current.scrollsInWindow ?? 0

  if (startedAt === undefined || now - startedAt >= RATE_LIMIT_WINDOW_MS) {
    return { scrollWindowStartedAt: now, scrollsInWindow: 1 }
  }
  if (count >= RATE_LIMIT_SCROLLS) return null

  return { scrollWindowStartedAt: startedAt, scrollsInWindow: count + 1 }
}

/**
 * The `createdAt` to stamp on a team's next message: `now`, unless that would
 * tie or trail the newest message the team already has, in which case one
 * millisecond past it.
 *
 * THIS IS WHAT MAKES A SCALAR CURSOR SOUND (wordle-teams-isw5). Both paging
 * reads compare a client-held timestamp with a STRICT inequality —
 * olderMessagesFor's `.lt('createdAt', before)`, messagesSinceFor's
 * `.gt('createdAt', since)` — and both cursors are taken from a message the
 * client already holds. If a second message shares that timestamp, the strict
 * comparison excludes it, and the exclusion is PERMANENT rather than transient:
 * the backwards cursor only ever moves older and the forwards cursor only ever
 * moves newer, so no later page can pick the skipped message up. It is simply
 * never displayed. Two writes inside one millisecond is the whole of the
 * precondition.
 *
 * SO UNIQUENESS IS ESTABLISHED ON THE WRITE SIDE, WHERE IT COSTS NOTHING,
 * rather than by teaching both reads to break ties. The alternatives were a
 * `(createdAt, _id)` tuple cursor and a separate per-team sequence number, and
 * both are worse here:
 *
 *   - A TUPLE CURSOR CANNOT BE EXPRESSED. Convex will not index `_id` at all —
 *     an index field path is a document field or `_creationTime`, and nothing
 *     else — so the only available tiebreaker is `_creationTime`, which every
 *     index already carries implicitly as its final field. But a Convex index
 *     range is equalities followed by ONE bound, so "everything before
 *     (T, C)" is two queries, not one: the tail of the tie group at T, plus
 *     everything strictly older than T. That is a second read on the hot path,
 *     a `_creationTime` on the wire that ChatMessage deliberately drops, and a
 *     cursor the client must carry as a pair through nextSyncAction,
 *     nextSinceOutcome and beforeForOlder.
 *   - A PER-TEAM SEQUENCE NUMBER is this function with an extra field, an extra
 *     index and a backfill: `seq` would have to be optional to stay additive,
 *     and every row written before it would sort together under `undefined` —
 *     which is the same tie, over the whole of history, until a migration
 *     removes it.
 *
 * This needs no schema change, no index change, no client change and no extra
 * document read: sendMessageFor already has the team's `chatMeta` row in hand
 * to bump it.
 *
 * IT RESTS ON sendMessageFor BEING THE ONLY WRITER of chatMessages, the same
 * invariant bumpChatMeta already depends on and states. A seed script or a
 * migration that inserts messages directly must stamp them the same way, or it
 * reintroduces exactly this bug in the rows it writes.
 *
 * THE DRIFT FROM THE WALL CLOCK IS AT MOST ONE MILLISECOND PER COLLIDING
 * MESSAGE, and only while a team is writing faster than the clock ticks. A
 * displayed time is a minute-resolution string (clockTime), and both rate-limit
 * windows are computed from the real `Date.now()`, not from this — so nothing a
 * user sees or is refused by moves.
 */
export function nextMessageTime(lastMessageAt: number | undefined, now: number): number {
  return Math.max(now, (lastMessageAt ?? 0) + 1)
}

/**
 * What to charge the monthly budget for one message.
 *
 * DELIBERATELY CONSERVATIVE: every member is billed as though they were
 * connected and watching, which is rarely true. Over-counting makes the meter
 * trip early, and tripping early is the safe direction — the failure it exists
 * to prevent is Convex refusing mutations across the whole app.
 */
export function budgetIncrementFor(teamSize: number): number {
  return teamSize * BYTES_PER_WAKE
}

/**
 * What a DELETE costs a connected client, which is not what a message costs.
 *
 * A delete bumps `revision` without moving `lastMessageAt`, and a client seeing
 * that must refetch its whole window rather than append — it cannot know WHICH
 * message vanished. So it pays RECENT_WINDOW messages at the same ~250B
 * per-message estimate BYTES_PER_WAKE is built from, not one. That makes a
 * delete roughly 17x a send, and it is the single most expensive operation in
 * the feature.
 */

export function budgetIncrementForDelete(teamSize: number): number {
  return teamSize * BYTES_PER_DELETE_WAKE
}

/**
 * What a scrollback page costs: one RECENT_WINDOW read, at the same ~250B
 * per-message estimate BYTES_PER_WAKE and BYTES_PER_DELETE_WAKE are built
 * from — numerically the same figure as BYTES_PER_DELETE_WAKE, because both
 * are "one client reads a full window," just reached by different paths.
 *
 * NOT MULTIPLIED BY TEAM SIZE, unlike budgetIncrementFor (a send, felt by
 * every connected client on the next wake) and budgetIncrementForDelete (a
 * forced refetch, also felt by every connected client). Scrollback is a
 * one-shot fetch the caller asked for; nobody else's client does any work
 * because of it, so nobody else is charged for it.
 */

export function budgetIncrementForScroll(): number {
  return BYTES_PER_SCROLL_PAGE
}

export function isOverBudget(estimatedBytes: number): boolean {
  return estimatedBytes >= BUDGET_THRESHOLD_BYTES
}

/**
 * The 'YYYY-MM' key for a timestamp, via toPuzzleDay — so the budget month
 * matches every other month in this product rather than introducing a second,
 * UTC notion of when a month turns over. A counter that resets a few hours
 * early or late is harmless; two disagreeing definitions of "September" are
 * not.
 */
export function budgetMonthFor(now: number): string {
  return monthOf(toPuzzleDay(new Date(now)))
}
