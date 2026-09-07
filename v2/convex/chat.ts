import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, requirePlayer, requireTeamMemberFor, requireTeamOwnerFor } from './access'
import {
  RECENT_WINDOW,
  budgetIncrementFor,
  budgetIncrementForDelete,
  budgetIncrementForScroll,
  budgetMonthFor,
  isOverBudget,
  nextMessageTime,
  nextPostWindow,
  nextScrollWindow,
  requireBody,
} from './lib/chat.ts'
import type { Doc, Id } from './_generated/dataModel'
import type { ReaderCtx, WriterCtx } from './winners.ts'

/**
 * Team chat (wordle-teams-qix). Phase 7.5.
 *
 * Design: docs/superpowers/specs/2026-09-05-team-chat-design.md.
 *
 * EVERY FUNCTION IN HERE CHECKS MEMBERSHIP, READS INCLUDED. Part 2's route
 * guard exists so nobody is shown a screen that cannot load; it is not the
 * security boundary, because these functions are callable directly.
 *
 * requireTeamMemberFor throws NOT_A_MEMBER for a nonexistent team as well as
 * for someone else's, so chat cannot be used to probe whether a team id exists.
 * Do not "improve" that into a more specific error.
 *
 * ONLY ONE OF THE FOUR READS IS METERED AND RATE-LIMITED: olderMessagesFor. It
 * is a `mutation`, not a `query`, and that is not a style choice — a Convex
 * query's `ctx.db` is a GenericDatabaseReader with no write methods, so a
 * query cannot charge chargeBudget's `chatBudget` row or spend a rate-limit
 * counter on `chatReads`. Both are structurally impossible to add to a
 * `query` without another mechanism entirely. The other three reads
 * (chatPointerFor, recentMessagesFor, messagesSinceFor) stay queries and stay
 * unmetered, and that is a decision, not an oversight:
 *
 * - chatPointerFor IS the subscription a client holds open. It cannot be a
 *   mutation and remain what makes chat live.
 * - messagesSinceFor is the hot path on every wake, and messagesSinceFor's own
 *   comment records that its bound is enforced by Convex's per-function
 *   documents-read quota, not by argument shape.
 * - recentMessagesFor runs once on open and again only on a revision jump; its
 *   comment records the same RECENT_WINDOW bound.
 *
 * All three take a fixed-shape argument (chatPointerFor and recentMessagesFor
 * take none beyond teamId; messagesSinceFor's `since` is normally the client's
 * own last-seen timestamp) and read a bounded window. Convex caches a query's
 * result per exact (function, arguments) pair and serves repeats of the same
 * call from that cache without re-reading the database — confirmed against
 * Convex's own docs (docs.convex.dev/functions/query-functions), which state
 * plainly that identical arguments are what the cache keys on, and that
 * distinct arguments each execute fresh. So hammering one of these three with
 * the SAME arguments is free after the first call; hammering them with
 * VARYING arguments (a moving `since`) is bounded the same way it already is
 * today, at RECENT_WINDOW(+1) per call. olderMessagesFor is the one read whose
 * whole job is walking `before` backwards — a different argument on every
 * call, by design, which is exactly what defeats that cache. That is what
 * makes it the one read worth metering rather than a reason the other three
 * need it too.
 */

/** A team's pointer row, or null if it has never had a message. */
async function chatMetaFor(ctx: ReaderCtx, teamId: Id<'teams'>) {
  return await ctx.db
    .query('chatMeta')
    .withIndex('by_team', (q) => q.eq('teamId', teamId))
    .unique()
}

/**
 * Advance a team's pointer, which is what wakes every connected client.
 *
 * REVISION BUMPS ON EVERY HISTORY CHANGE, not only on new messages. A delete
 * does not move lastMessageAt, so a client watching the timestamp alone would
 * go on showing a message that is gone.
 *
 * TAKES THE ALREADY-FETCHED ROW, for the same reason upsertReadCursor does:
 * sendMessageFor has to read it BEFORE the insert now — nextMessageTime needs
 * the team's newest timestamp to stamp the message with one that cannot tie it
 * — so fetching it again in here would be a second read of a document the
 * caller already paid for. `null` means the team has never chatted.
 */
async function bumpChatMeta(
  ctx: WriterCtx,
  existing: Doc<'chatMeta'> | null,
  teamId: Id<'teams'>,
  now: number,
  movesLastMessage: boolean,
): Promise<void> {
  if (existing === null) {
    // movesLastMessage is ignored here, and that is safe only by an invariant
    // worth stating: `false` is passed on a delete (see deleteMessageFor), a
    // delete requires the message to exist, and every message is written by
    // sendMessageFor — which creates this row. So `false` never reaches this
    // branch. The invariant is NOT enforced by a type; it rests on nothing
    // else inserting into chatMessages. If you are adding a seed script or a
    // migration that does, this insert needs to honour the flag — and its rows
    // need nextMessageTime's per-team-unique stamp too, for the reason
    // schema.ts records on chatMessages.
    await ctx.db.insert('chatMeta', { teamId, lastMessageAt: now, revision: 1 })
    return
  }

  await ctx.db.patch(existing._id, {
    revision: existing.revision + 1,
    ...(movesLastMessage ? { lastMessageAt: now } : {}),
  })
}

/**
 * Charge the month's bandwidth budget `bytes`, and PUBLISH `degraded` when
 * crossing the threshold changes the answer.
 *
 * TWO ROWS, AND THE SPLIT IS THE FIX FOR wordle-teams-0lg2. `chatBudget` is the
 * counter: it changes on every charge, which makes it the one hot document in
 * this schema and therefore poison in any subscription's read set.
 * `chatDegraded` is the signal chatPointerFor reads, and it is written ONLY
 * when the boolean actually flips — so a month that never crosses the line
 * never writes it, never creates it, and never disturbs a single pointer.
 * Absent means not degraded.
 *
 * BOTH FLAGS COME FROM ONE isOverBudget CALL IN ONE TRANSACTION, so they cannot
 * disagree. The one on the counter row is read by nothing and kept only
 * because dropping a required field would need a data migration (see schema.ts);
 * the published one is the answer.
 *
 * RECOMPUTED, NOT LATCHED. chatPointerFor used to derive `degraded` from the
 * byte count precisely so a stored flag could not go stale against a moved
 * threshold. That property is preserved here rather than given up: every charge
 * re-evaluates isOverBudget against the CURRENT threshold and republishes, so
 * raising the ceiling clears a set flag on the next chat write anywhere in the
 * app instead of leaving it set for the rest of the month. The staleness that
 * remains is one chat write wide, app-wide — not one write per team, which is
 * what putting the flag on a team's own chatMeta row would have cost, and which
 * would have left exactly the idle-but-connected clients the valve exists to
 * shed as the ones who never heard about it.
 *
 * CHARGED FROM THREE CALLERS, and this function only accumulates and persists
 * — it does not know which operation it is pricing:
 *   sendMessageFor      budgetIncrementFor       teamSize x one wake
 *   deleteMessageFor    budgetIncrementForDelete teamSize x a WHOLE window
 *   olderMessagesFor    budgetIncrementForScroll one window, ONE client
 *
 * Those differ for real reasons. A delete costs roughly 17x a send, because
 * every connected client refetches its window rather than appending one
 * message. A scroll costs a window too, but for the asking client alone —
 * nobody else does any work because somebody paged back, so nobody else is
 * charged. Charging only sends would leave the meter blind to both.
 *
 * ALL THREE WRITE THE SAME ROW, which makes chatBudget the one hot document
 * in this schema (see below). Scroll writes are bounded by RATE_LIMIT_SCROLLS
 * at ten per player per team per minute, so the added contention is small,
 * but it is a third writer where this comment previously named two.
 *
 * WHY A METER AT ALL. The modelled worst case is ~7% of Convex's free-tier
 * database-I/O allowance, which is a large margin and not a guarantee. This
 * turns it into one. When it trips, chat stops opening live subscriptions and
 * falls back to manual refresh — SENDING KEEPS WORKING, because the failure
 * this exists to prevent is Convex refusing mutations app-wide and taking board
 * entry down along with chat. An unmetered 17x path would quietly invalidate
 * that ~7% model.
 *
 * DELIBERATELY A HOT DOCUMENT — unlike every other table this module touches,
 * which are keyed per team. Design §4 rejects a denormalised per-team blob
 * for exactly this shape, citing write contention on one hot document. Here
 * it is accepted rather than avoided: at current volume (~70 active players
 * across ~149 teams) the contention is negligible, and Convex resolves OCC
 * conflicts on a hot row by retrying transparently rather than failing the
 * mutation. Revisit if message volume ever climbs by an order of magnitude.
 */
async function chargeBudget(ctx: WriterCtx, bytes: number, now: number): Promise<void> {
  const month = budgetMonthFor(now)
  const row = await ctx.db
    .query('chatBudget')
    .withIndex('by_month', (q) => q.eq('month', month))
    .unique()

  const estimatedBytes = (row?.estimatedBytes ?? 0) + bytes
  const degraded = isOverBudget(estimatedBytes)

  if (row === null) {
    await ctx.db.insert('chatBudget', { month, estimatedBytes, degraded })
  } else {
    await ctx.db.patch(row._id, { estimatedBytes, degraded })
  }

  await publishDegraded(ctx, month, degraded)
}

/**
 * Record `degraded` for `month` where chatPointerFor can read it, WITHOUT
 * WRITING ANYTHING WHEN THE ANSWER HAS NOT CHANGED.
 *
 * THE NO-OP IS THE WHOLE FUNCTION. This row sits in the read set of every
 * connected client's pointer subscription, so a write here is an app-wide wake.
 * Writing it on every charge would reproduce wordle-teams-0lg2 exactly, one
 * table over. Reading it first to decide costs one small document inside a
 * mutation, where read sets do not create subscriptions and where the caller is
 * already paying for several.
 *
 * NOT CREATED WHILE FALSE, which is why the common case — a month that never
 * degrades — writes nothing here at all rather than churning a row between two
 * identical values. chatPointerFor reads an absent row as not degraded.
 */
async function publishDegraded(ctx: WriterCtx, month: string, degraded: boolean): Promise<void> {
  const published = await ctx.db
    .query('chatDegraded')
    .withIndex('by_month', (q) => q.eq('month', month))
    .unique()

  if (published === null) {
    if (degraded) await ctx.db.insert('chatDegraded', { month, degraded })
    return
  }
  if (published.degraded !== degraded) await ctx.db.patch(published._id, { degraded })
}

/** The caller's read cursor for a team, created on first use. */
async function readCursorFor(ctx: WriterCtx, playerId: Id<'players'>, teamId: Id<'teams'>) {
  return await ctx.db
    .query('chatReads')
    .withIndex('by_player_team', (q) => q.eq('playerId', playerId).eq('teamId', teamId))
    .unique()
}

/** The subset of a `chatReads` row that a caller may write. */
type ReadCursorFields = {
  lastReadAt?: number
  postWindowStartedAt?: number
  postsInWindow?: number
  scrollWindowStartedAt?: number
  scrollsInWindow?: number
}

/**
 * Insert-or-patch the caller's read cursor with exactly `fields` — nothing more.
 *
 * TAKES THE ALREADY-FETCHED `cursor`, RATHER THAN FETCHING ITS OWN: both call
 * sites (sendMessageFor, markReadFor) already had to read the cursor before
 * this runs — sendMessageFor to compute the rate-limit window, markReadFor to
 * decide insert vs. patch is even in question — so re-querying here would be
 * a second document read paying for something the caller already paid for.
 * See sendMessageFor's own comment on why that read is not repeated.
 *
 * `ctx.db.patch` MERGES; IT DOES NOT REPLACE. That is what makes this safe to
 * share between two callers who write different field sets from the same row:
 * sendMessageFor passes `lastReadAt` AND the rate-limit window
 * (postWindowStartedAt/postsInWindow), because sending both reads the
 * conversation and spends the window in one transaction; markReadFor passes
 * ONLY `lastReadAt`. A narrower `fields` object here leaves whatever is
 * already on the row alone — in particular it leaves the window fields
 * untouched — rather than clearing them to `undefined`. Get this wrong (e.g.
 * switch `patch` for `replace`, or default the omitted fields to `undefined`
 * before merging) and opening a conversation would silently reset every
 * player's rate limit on every read. Pinned in chat.test.ts: "markReadFor
 * leaves the rate-limit window alone."
 *
 * `lastReadAt` IS OPTIONAL HERE, unlike on the `chatReads` schema, for
 * olderMessagesFor's sake: paging through history is not the same claim as
 * "you have seen everything up to now" that sendMessageFor and markReadFor
 * make, so a scroll-only write must not invent one. On insert, where the
 * schema's required field has to come from somewhere, an omitted
 * `lastReadAt` defaults to 0 — "never read" — the same honest zero
 * chatPointerFor already returns for a team that has never chatted.
 */
async function upsertReadCursor(
  ctx: WriterCtx,
  cursor: Doc<'chatReads'> | null,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  fields: ReadCursorFields,
): Promise<void> {
  if (cursor === null) {
    await ctx.db.insert('chatReads', { playerId, teamId, lastReadAt: fields.lastReadAt ?? 0, ...fields })
    return
  }
  await ctx.db.patch(cursor._id, fields)
}

export async function sendMessageFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  rawBody: string,
): Promise<Id<'chatMessages'>> {
  const team = await requireTeamMemberFor(ctx, playerId, teamId)
  const body = requireBody(rawBody)
  const now = Date.now()

  // THE RATE CHECK COMES BEFORE THE INSERT. Refusing after writing would let a
  // runaway client spend the I/O it is being refused for.
  //
  // Read once here, reused for the write below: enforcing the limit costs no
  // extra document read. Counting recent messages instead would pay I/O to
  // protect I/O.
  const cursor = await readCursorFor(ctx, playerId, teamId)
  const window = nextPostWindow(cursor ?? {}, now)
  // `throw` is redundant — accessError throws internally, and a bare call
  // narrows fine, because TypeScript treats a call to a `never`-returning
  // function as terminating control flow. It is kept purely for uniformity
  // with the repo's other call sites, for the reason requireBody's own comment
  // in lib/chat.ts gives: a bare call was once a silent bypass under an older
  // signature, and no reader should have to work out which signature applies.
  if (window === null) throw accessError('RATE_LIMITED')

  // NOT `now` (wordle-teams-isw5). Two messages in one team may never share a
  // `createdAt`, because both paging reads compare a client-held timestamp with
  // a STRICT inequality and would drop one of a pair forever — see
  // nextMessageTime, which is where that argument lives. The pointer row is
  // read here rather than inside bumpChatMeta because this is what it is for:
  // `lastMessageAt` IS the team's newest message time, so it is exactly the
  // value the next stamp has to clear.
  //
  // TWO CONCURRENT SENDS IN ONE TEAM CANNOT BOTH COMMIT ON THE SAME READ, which
  // is what makes this a real invariant rather than a narrowing of the window.
  // Both read this row (by index range, so an absent row counts too) and both
  // write it, so Convex's OCC conflicts and retries one of them, and the retry
  // reads the other's `lastMessageAt`. Uniqueness does not depend on the two
  // transactions being spaced apart in time.
  const meta = await chatMetaFor(ctx, teamId)
  const createdAt = nextMessageTime(meta?.lastMessageAt, now)

  const id = await ctx.db.insert('chatMessages', { teamId, playerId, body, createdAt })
  await bumpChatMeta(ctx, meta, teamId, createdAt, true)
  await chargeBudget(ctx, budgetIncrementFor(team.playerIds.length), now)

  // Sending is reading — you have seen your own message. STAMPED WITH THE
  // MESSAGE'S OWN TIME, not with `now`: chatNotify's `lastMessageAt > seen`
  // test relies on those two being exactly equal for the sender (see its
  // "STRICTLY GREATER, ON BOTH" note), and a `now` that trails a clamped
  // `createdAt` would make senders notify themselves.
  await upsertReadCursor(ctx, cursor, playerId, teamId, { lastReadAt: createdAt, ...window })

  return id
}

export type ChatPointer = {
  lastMessageAt: number
  revision: number
  degraded: boolean
}

/**
 * What a client subscribes to — and the only thing it subscribes to.
 *
 * THE READ SET IS THE CONTRACT, NOT THE RETURN VALUE. Convex re-runs a
 * subscription when any document READ during execution changes, so every
 * document touched here is a document whose next write wakes every client
 * holding this open. Keep that set to the caller's own team (the team doc, its
 * chatMeta row) plus the one deliberately low-churn document below.
 *
 * WHAT THIS COMMENT USED TO SAY WAS WRONG, and it is worth recording because it
 * is a tempting mistake. It claimed that reading the app-wide `chatBudget` row
 * HERE rather than letting clients subscribe to it directly was 'the difference
 * between waking one team and waking every connected client in the app'. It is
 * not, and there is no such difference: reactivity tracks READS, not which
 * query name did the reading. Reading that row inside the pointer had exactly
 * the fan-out that subscribing to it would have had — one send in one team
 * re-firing every connected client's pointer across the whole app
 * (wordle-teams-0lg2). Confirmed empirically before the fix: a single
 * `chat:send` produced three `chat:pointer` executions.
 *
 * THE DAMAGE WAS THE METER, NOT THE WAKE. A spuriously woken client re-ran this
 * (~200B), saw its own `revision` unchanged and correctly fetched nothing — but
 * nothing charged it, because budgetIncrementFor prices a send at
 * teamSize x BYTES_PER_WAKE, counting the sending team alone. The meter that
 * exists to keep chat inside the free tier was therefore systematically
 * optimistic by roughly the ratio of connected clients to team size, and the
 * `degraded` valve could never trip on the traffic it was missing. With the
 * read set team-scoped, teamSize is once again the true count of clients a send
 * wakes, and budgetIncrementFor is honest.
 *
 * `degraded` NOW COMES FROM chatDegraded, a separate month-keyed row written
 * only when the boolean flips — see publishDegraded. Reading it is not a
 * betrayal of the team-scoped rule above but the one exception that earns
 * itself: in a month that never degrades it is never written, so it never
 * invalidates anything, and when it IS written the wake is precisely the signal
 * every client needs. Compare the alternative of carrying `degraded` on the
 * team's own chatMeta row, which would be perfectly team-scoped and would tell
 * only teams that are actively chatting — never the idle-but-connected clients
 * whose subscriptions are the cost the valve exists to shed.
 *
 * A team that has never chatted has no pointer row; zeroes are the honest
 * answer, and they make the client's "everything after 0" first fetch correct
 * without a special case.
 */
export async function chatPointerFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<ChatPointer> {
  await requireTeamMemberFor(ctx, playerId, teamId)

  const meta = await ctx.db
    .query('chatMeta')
    .withIndex('by_team', (q) => q.eq('teamId', teamId))
    .unique()

  const published = await ctx.db
    .query('chatDegraded')
    .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
    .unique()

  return {
    lastMessageAt: meta?.lastMessageAt ?? 0,
    revision: meta?.revision ?? 0,
    // READ, NOT DERIVED — the reverse of what this line used to do, and a real
    // trade rather than an oversight. Deriving meant reading `estimatedBytes`
    // off the hot counter row, which is the fan-out above. What deriving bought
    // was immunity to a moved threshold, and publishDegraded buys that back a
    // different way: it recomputes against the current threshold on EVERY
    // charge and republishes, so this is at most one chat write behind the
    // truth, app-wide. An absent row means the month has never degraded.
    degraded: published?.degraded ?? false,
  }
}

/**
 * What a client actually needs from a message.
 *
 * NOT a database-I/O saving: Convex bills bandwidth on data SCANNED, so the
 * whole document is paid for either way. This trims EGRESS, which is a
 * separate 1GB/month free-tier cap, and the payload every browser downloads.
 *
 * `teamId` is dropped because the caller supplied it to scope the query, and
 * `_creationTime` because the schema added an explicit `createdAt` precisely so
 * nothing would depend on it.
 */
export type ChatMessage = {
  _id: Id<'chatMessages'>
  playerId: Id<'players'>
  body: string
  createdAt: number
}

function toChatMessage(doc: Doc<'chatMessages'>): ChatMessage {
  return { _id: doc._id, playerId: doc.playerId, body: doc.body, createdAt: doc.createdAt }
}

/**
 * The newest RECENT_WINDOW messages, oldest-first for rendering.
 *
 * Read once when a conversation opens, and again only when `revision` jumps
 * without new messages — which is what a delete looks like from the client's
 * side. It is NOT what a new message costs; that is messagesSinceFor.
 */
export async function recentMessagesFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<Array<ChatMessage>> {
  await requireTeamMemberFor(ctx, playerId, teamId)

  const newestFirst = await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId))
    .order('desc')
    .take(RECENT_WINDOW)

  return newestFirst.reverse().map(toChatMessage)
}

export type MessagesSince =
  | { gap: false; messages: Array<ChatMessage> }
  | { gap: true }

/**
 * Everything after `since` — the hot path, and normally one document.
 *
 * This is the whole reason the architecture is cheap: a client that already
 * holds history up to T pays for what it lacks, not for the window it already
 * has.
 *
 * BOUNDED, AND THE BOUND IS PART OF THE CONTRACT. `since` is client-supplied
 * (Task 9), so an unbounded query here would let a reconnecting client, a
 * skewed clock, or a plain `since: 0` pull a team's entire history in one
 * call — exactly the cost this design exists to avoid. Past a window's worth
 * we return `gap: true` and NO messages, rather than a truncated list a caller
 * could mistake for complete: the correct recovery is to refetch the window
 * with recentMessagesFor, not to append what happened to fit.
 *
 * THE BOUND IS TEST-ENFORCED, but not by any assertion on this function's
 * result — a capped and an uncapped read produce the same `gap` boolean, since
 * both counts land past the window. What catches its removal is Convex's own
 * per-function documents-read quota, tightened in one test so an unbounded
 * scan fails here the way it would in production. See "never scans
 * unboundedly" in chat.test.ts.
 */
export async function messagesSinceFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  since: number,
): Promise<MessagesSince> {
  await requireTeamMemberFor(ctx, playerId, teamId)

  // One more than the window, so "hit the cap" is distinguishable from
  // "exactly a window's worth".
  const found = await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId).gt('createdAt', since))
    .take(RECENT_WINDOW + 1)

  if (found.length > RECENT_WINDOW) return { gap: true }
  return { gap: false, messages: found.map(toChatMessage) }
}

/**
 * The page of messages immediately before `before`, oldest-first.
 *
 * Deliberately NOT subscribed by the client — scrollback does not live-update,
 * which is correct for history and is what keeps a deep scroll from becoming
 * permanently expensive.
 *
 * A `mutation`, NOT a `query` — see the note atop this file for why. Because
 * `before` moves on every call (that is the whole point of paging backwards),
 * this is also the one read Convex's per-argument query cache cannot help:
 * each page is a distinct argument, so each page would hit the database
 * whether this were a query or not. That is what makes it worth metering and
 * rate-limiting where the other three reads are not — see the top-of-file
 * note for the full reasoning.
 *
 * THE RATE CHECK COMES BEFORE THE READ, same reasoning as sendMessageFor:
 * refusing after paying the I/O it is being refused for would defeat the
 * point. The cursor is read once and reused for the write below, exactly as
 * sendMessageFor reuses its own read of the same row.
 */
export async function olderMessagesFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  before: number,
): Promise<Array<ChatMessage>> {
  await requireTeamMemberFor(ctx, playerId, teamId)
  const now = Date.now()

  const cursor = await readCursorFor(ctx, playerId, teamId)
  const window = nextScrollWindow(cursor ?? {}, now)
  if (window === null) throw accessError('SCROLL_RATE_LIMITED')

  const newestFirst = await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId).lt('createdAt', before))
    .order('desc')
    .take(RECENT_WINDOW)

  await chargeBudget(ctx, budgetIncrementForScroll(), now)
  // Only `lastReadAt` is conditional — window is always present, since a
  // refusal above already returned before this line. Built this way rather
  // than `{ lastReadAt: cursor?.lastReadAt, ...window }` because that spells
  // `lastReadAt: undefined` when there is no cursor yet, an EXPLICIT key on
  // the object rather than an absent one — upsertReadCursor's insert-path
  // default (`fields.lastReadAt ?? 0`) would be clobbered right back to
  // `undefined` by the later `...fields` spread. Omitting the key entirely
  // when there is nothing to preserve is what makes that default reachable.
  const fields = cursor === null ? window : { lastReadAt: cursor.lastReadAt, ...window }
  await upsertReadCursor(ctx, cursor, playerId, teamId, fields)

  return newestFirst.reverse().map(toChatMessage)
}

/**
 * Delete a message. The author may remove their own; the team owner may remove
 * any in their team.
 *
 * HARD DELETE, NOT A TOMBSTONE. A tombstone would occupy a slot in the loaded
 * window and be re-read on every refresh for the life of the team, and with no
 * report path there is no evidence it would preserve.
 *
 * OWNERSHIP IS A ROLE, NOT AUTHORSHIP — Phase 5's softened downgrade reassigns
 * `owner` to the earliest-joined remaining member, so this grants the power to
 * whoever holds the role now, which is the intent.
 *
 * A non-member gets NOT_A_MEMBER from requireTeamMemberFor before anything else
 * is considered, so this cannot be used to probe which message ids exist.
 */
export async function deleteMessageFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  messageId: Id<'chatMessages'>,
): Promise<void> {
  const message = await ctx.db.get(messageId)
  if (message === null) throw accessError('NOT_A_MEMBER')

  // Reuses access.ts's own owner rule rather than reimplementing
  // `team.owner === playerId` here — that check belongs to access.ts, and both
  // branches still fail NOT_A_MEMBER first, since requireTeamOwnerFor calls
  // requireTeamMemberFor before comparing `owner`.
  const team =
    message.playerId === playerId
      ? await requireTeamMemberFor(ctx, playerId, message.teamId)
      : await requireTeamOwnerFor(ctx, playerId, message.teamId)

  await ctx.db.delete(messageId)
  const now = Date.now()
  // History changed without the newest message moving — see bumpChatMeta. The
  // row is read here rather than inside it only because sendMessageFor needs
  // it before its own insert; this is the same one read, moved out.
  const meta = await chatMetaFor(ctx, message.teamId)
  await bumpChatMeta(ctx, meta, message.teamId, now, false)
  // A DELETE, NOT A SEND — see budgetIncrementForDelete. Every connected
  // client refetches its whole window, not one message, so this is charged at
  // the delete rate, not the send rate.
  await chargeBudget(ctx, budgetIncrementForDelete(team.playerIds.length), now)
}

/**
 * Mark a team's conversation read up to now.
 *
 * Separate from `sendMessageFor` because opening a conversation is the common
 * case and costs nothing: it writes one small row and reads no messages. Part
 * 2's unread badge is `chatMeta.lastMessageAt > chatReads.lastReadAt`, which is
 * why this has to exist as its own call.
 *
 * WRITES ONLY `lastReadAt` — see upsertReadCursor's comment on why that is
 * exactly what stops this from clobbering the caller's rate-limit window.
 */
export async function markReadFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<void> {
  await requireTeamMemberFor(ctx, playerId, teamId)
  const cursor = await readCursorFor(ctx, playerId, teamId)
  await upsertReadCursor(ctx, cursor, playerId, teamId, { lastReadAt: Date.now() })
}

/**
 * Whether the caller is on `teamId`, as a boolean rather than as a throw.
 *
 * WRAPS requireTeamMemberFor RATHER THAN REIMPLEMENTING IT. The rule — the
 * team must exist AND list this player, with the same answer either way so a
 * probe cannot tell those apart — belongs to access.ts, and a second copy of
 * it here is the copy that would drift. What is different is only what the
 * CALLER wants done about a `false`, and that is unreadTeamsFor's decision to
 * make (it skips; see its own comment).
 *
 * CATCHES EXACTLY NOT_A_MEMBER AND RETHROWS EVERYTHING ELSE. A bare
 * `catch { return false }` would swallow a read error, an OCC failure or a
 * future code from the same helper and silently report "not a member" for it —
 * turning an outage into a badge that is merely wrong, which is the harder bug
 * to notice.
 */
async function isTeamMemberFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<boolean> {
  try {
    await requireTeamMemberFor(ctx, playerId, teamId)
    return true
  } catch (error) {
    const data = error instanceof ConvexError ? (error.data as { code?: string } | null) : null
    if (data?.code === 'NOT_A_MEMBER') return false
    throw error
  }
}

/**
 * Which of `teamIds` have messages the caller has not read.
 *
 * READS NO MESSAGES, which is the point. A badge is a comparison of two small
 * documents per team — the team's chatMeta pointer against the caller's own
 * chatReads cursor — so it stays cheap enough to run on any page load. Counting
 * unread messages instead would read the messages themselves, on every load,
 * for every team, which is exactly the cost this feature is built to avoid, and
 * the design says so in as many words (spec section 5: the badge shows
 * presence-of-unread, a dot and never a number, precisely so it can stay free;
 * the hourly push sweep is where a COUNT is affordable, because it runs once
 * per team per hour rather than on every page load).
 *
 * IT TAKES THE IDS RATHER THAN DERIVING THEM, AND THAT IS wordle-teams-w7g2.
 * This used to call getMyTeamsFor, which opens `ctx.db.query('teams').collect()`
 * — a FULL TABLE SCAN of ~149 teams plus a `get` per member to build names and
 * rosters — to answer a question whose entire output is a list of team ids. The
 * document count was the smaller half of the cost. The bigger half was
 * invalidation: a Convex query is re-run when anything in its READ SET changes,
 * and the read set was the whole `teams` table, so every rename, invite, join
 * and billing change anywhere in the app re-fired this for EVERY connected
 * player — and by Part 2 essentially every authenticated session holds it open,
 * because the badge is on the dashboard. Taking the ids narrows the read set to
 * three small documents per team (the team for the gate, its chatMeta, the
 * caller's chatReads), so the app-wide fan-out DISAPPEARS rather than merely
 * getting cheaper. Indexing was not an option: membership lives only in
 * `teams.playerIds`, an array, and Convex cannot index array membership (see
 * the schema comment on `teams`).
 *
 * MEMBERSHIP IS CHECKED PER ID, and this comment used to say the opposite —
 * that no check was needed because the ids came from the caller's own teams and
 * none was ever accepted as an argument. Taking them from the client INVERTS
 * exactly that reasoning: any id can now arrive here, so every id is gated. The
 * caller supplies the list; it does not supply the permission.
 *
 * AN ID THE CALLER IS NOT ON IS SKIPPED, NOT THROWN ON. The client's team list
 * is a live subscription that can legitimately lag — someone removed from a
 * team goes on holding its id until getMyTeams re-resolves — and a throw would
 * take the WHOLE badge down for that moment, since one bad id poisons the call
 * and no team gets a dot. The security is identical either way: the id is not
 * answered about, and nothing about it (not even whether a team exists, which
 * requireTeamMemberFor is careful about) reaches the caller. Skipping degrades
 * one entry; throwing degrades all of them.
 *
 * DEDUPED, because the badge's own arithmetic depends on it: hasUnreadElsewhere
 * subtracts the selected team by COUNT — "exactly one entry, never a range", in
 * its words — so a repeated id would silently under-report the picker's trigger
 * dot. The client sorts its ids; nothing in the wire format stops it repeating
 * one.
 *
 * THE LENGTH IS NOT CAPPED, and the bound is the same one messagesSinceFor
 * documents for itself: Convex's per-function documents-read quota. A caller
 * passing thousands of ids gets a failed query rather than a slow one, and it
 * is their own badge they broke. A cap here would be a second, hand-maintained
 * number for a list that is in practice one to six teams long.
 *
 * A TEAM WITH NO chatMeta ROW IS SILENTLY SKIPPED, and that is the correct
 * answer rather than a missing case: bumpChatMeta creates that row on the first
 * message, so its absence means the team has never had a message at all, and
 * nothing unread can exist in an empty conversation.
 *
 * A MISSING chatReads ROW READS AS `0`, NOT AS "READ". Someone who has never
 * opened a team's chat has no cursor, and every message in it is unread to
 * them — which is what `?? 0` says. Defaulting the other way (to now, or to
 * lastMessageAt) would silently swallow the badge for exactly the person most
 * likely to want it.
 */
export async function unreadTeamsFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamIds: Array<Id<'teams'>>,
): Promise<Array<Id<'teams'>>> {
  const unread: Array<Id<'teams'>> = []

  for (const teamId of new Set(teamIds)) {
    if (!(await isTeamMemberFor(ctx, playerId, teamId))) continue

    const meta = await ctx.db
      .query('chatMeta')
      .withIndex('by_team', (q) => q.eq('teamId', teamId))
      .unique()
    if (meta === null) continue

    const cursor = await ctx.db
      .query('chatReads')
      .withIndex('by_player_team', (q) => q.eq('playerId', playerId).eq('teamId', teamId))
      .unique()

    if (meta.lastMessageAt > (cursor?.lastReadAt ?? 0)) unread.push(teamId)
  }

  return unread
}

/**
 * Forget what a player had read in a team, called when they are ADDED to one.
 *
 * WHY ON ADD RATHER THAN ON REMOVE. A departed member's cursor outlives them
 * whenever the team itself survives, and three separate paths remove a player
 * (removeMemberFor, leaveTeamFor, and the Phase 5 downgrade in billing.ts). An
 * invariant spread across three call sites and every future one is the shape
 * that rots — the same argument that made the team-deletion cascade index by
 * team rather than walk the roster. Addition happens in two places, and the
 * only visible symptom is here: a rejoining member would otherwise arrive
 * already caught up on everything said while they were gone.
 *
 * A FOURTH WRITER OF THE CONTENDED `chatReads` ROW, which sendMessageFor,
 * markReadFor and olderMessagesFor already share — and the one that costs
 * nothing. The other three are written by a member DURING a conversation, and
 * two of them overlapping is the OCC retry Task 6's `disabled` guard exists to
 * avoid. This one runs at the moment somebody is put ON the roster, when by
 * definition they are not yet a member and so cannot be holding any of the
 * other three: every one of those is gated on CURRENT membership. It is one
 * delete, once per join, off the chat hot path entirely.
 *
 * Leaves the orphaned row alone when nobody rejoins. It is small, unreachable
 * (every read is gated on CURRENT membership) and harmless.
 *
 * DELETING RATHER THAN ZEROING also clears the stale rate-limit windows
 * (postWindowStartedAt/postsInWindow and the scroll pair live on this same
 * row), which a returning member should not inherit. A zeroed lastReadAt would
 * fix the badge and leave them mid-window on somebody else's limit.
 */
export async function resetChatCursorFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<void> {
  const cursor = await readCursorFor(ctx, playerId, teamId)
  if (cursor !== null) await ctx.db.delete(cursor._id)
}

export const pointer = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await chatPointerFor(ctx, player._id, teamId)
  },
})

export const recentMessages = query({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    return await recentMessagesFor(ctx, player._id, teamId)
  },
})

export const messagesSince = query({
  args: { teamId: v.id('teams'), since: v.number() },
  handler: async (ctx, { teamId, since }) => {
    const player = await requirePlayer(ctx)
    return await messagesSinceFor(ctx, player._id, teamId, since)
  },
})

// A `mutation`, NOT a `query` — see olderMessagesFor's own comment, and the
// note atop this file, for why this one read needs write access to meter and
// rate-limit itself and the other three do not.
export const olderMessages = mutation({
  args: { teamId: v.id('teams'), before: v.number() },
  handler: async (ctx, { teamId, before }) => {
    const player = await requirePlayer(ctx)
    return await olderMessagesFor(ctx, player._id, teamId, before)
  },
})

export const send = mutation({
  args: { teamId: v.id('teams'), body: v.string() },
  handler: async (ctx, { teamId, body }) => {
    const player = await requirePlayer(ctx)
    return await sendMessageFor(ctx, player._id, teamId, body)
  },
})

export const deleteMessage = mutation({
  args: { messageId: v.id('chatMessages') },
  handler: async (ctx, { messageId }) => {
    const player = await requirePlayer(ctx)
    await deleteMessageFor(ctx, player._id, messageId)
  },
})

export const markRead = mutation({
  args: { teamId: v.id('teams') },
  handler: async (ctx, { teamId }) => {
    const player = await requirePlayer(ctx)
    await markReadFor(ctx, player._id, teamId)
  },
})

// TAKES THE TEAM IDS, WHICH IS THE ONE THING THE CLIENT ALREADY KNOWS —
// routes/app.tsx holds them from api.teams.getMyTeams before this ever runs.
// See unreadTeamsFor for why deriving them here cost a full `teams` scan and,
// far worse, re-fired this subscription for every connected player on every
// team write in the app.
//
// EVERY ID IS GATED SERVER-SIDE. `v.array(v.id('teams'))` only says the ids are
// well-formed; it says nothing about whose they are.
export const unreadTeams = query({
  args: { teamIds: v.array(v.id('teams')) },
  handler: async (ctx, { teamIds }) => {
    const player = await requirePlayer(ctx)
    return await unreadTeamsFor(ctx, player._id, teamIds)
  },
})
