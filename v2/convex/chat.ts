import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { accessError, requirePlayer, requireTeamMemberFor, requireTeamOwnerFor } from './access'
import {
  RECENT_WINDOW,
  budgetIncrementFor,
  budgetIncrementForDelete,
  budgetMonthFor,
  isOverBudget,
  nextPostWindow,
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
 */

/**
 * Advance a team's pointer, which is what wakes every connected client.
 *
 * REVISION BUMPS ON EVERY HISTORY CHANGE, not only on new messages. A delete
 * does not move lastMessageAt, so a client watching the timestamp alone would
 * go on showing a message that is gone.
 */
async function bumpChatMeta(
  ctx: WriterCtx,
  teamId: Id<'teams'>,
  now: number,
  movesLastMessage: boolean,
): Promise<void> {
  const existing = await ctx.db
    .query('chatMeta')
    .withIndex('by_team', (q) => q.eq('teamId', teamId))
    .unique()

  if (existing === null) {
    // movesLastMessage is ignored here, and that is safe only by an invariant
    // worth stating: `false` is passed on a delete (see deleteMessageFor), a
    // delete requires the message to exist, and every message is written by
    // sendMessageFor — which creates this row. So `false` never reaches this
    // branch. The invariant is NOT enforced by a type; it rests on nothing
    // else inserting into chatMessages. If you are adding a seed script or a
    // migration that does, this insert needs to honour the flag.
    await ctx.db.insert('chatMeta', { teamId, lastMessageAt: now, revision: 1 })
    return
  }

  await ctx.db.patch(existing._id, {
    revision: existing.revision + 1,
    ...(movesLastMessage ? { lastMessageAt: now } : {}),
  })
}

/**
 * Charge the month's bandwidth budget `bytes`, and set `degraded` once the
 * threshold is crossed.
 *
 * CHARGED FROM BOTH sendMessageFor (budgetIncrementFor) AND deleteMessageFor
 * (budgetIncrementForDelete) — this function only accumulates and persists,
 * it does not know which operation it is pricing. That split matters: a
 * delete costs roughly 17x a send, because every connected client refetches
 * its whole window rather than appending one message (see
 * budgetIncrementForDelete). Charging only sends would leave the meter blind
 * to the single most expensive path in the feature.
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
    return
  }
  await ctx.db.patch(row._id, { estimatedBytes, degraded })
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
  lastReadAt: number
  postWindowStartedAt?: number
  postsInWindow?: number
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
 */
async function upsertReadCursor(
  ctx: WriterCtx,
  cursor: Doc<'chatReads'> | null,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  fields: ReadCursorFields,
): Promise<void> {
  if (cursor === null) {
    await ctx.db.insert('chatReads', { playerId, teamId, ...fields })
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

  const id = await ctx.db.insert('chatMessages', { teamId, playerId, body, createdAt: now })
  await bumpChatMeta(ctx, teamId, now, true)
  await chargeBudget(ctx, budgetIncrementFor(team.playerIds.length), now)

  // Sending is reading — you have seen your own message.
  await upsertReadCursor(ctx, cursor, playerId, teamId, { lastReadAt: now, ...window })

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
 * TWO SMALL DOCUMENTS, deliberately. `degraded` lives in the app-wide
 * chatBudget row, and returning it here rather than letting clients subscribe
 * to that row directly is the difference between waking one team and waking
 * every connected client in the app whenever anybody sends a message.
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

  const budget = await ctx.db
    .query('chatBudget')
    .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
    .unique()

  return {
    lastMessageAt: meta?.lastMessageAt ?? 0,
    revision: meta?.revision ?? 0,
    // DERIVED, NOT READ BACK. chargeBudget stores `degraded` because it has to
    // write the row anyway, but a stored flag goes stale the moment the
    // threshold moves: every row already past the OLD threshold would keep
    // reporting degraded for the rest of the month even after the ceiling was
    // raised. The row is already in hand here, so deriving costs nothing and
    // removes the staleness case entirely.
    degraded: isOverBudget(budget?.estimatedBytes ?? 0),
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
 */
export async function olderMessagesFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  before: number,
): Promise<Array<ChatMessage>> {
  await requireTeamMemberFor(ctx, playerId, teamId)

  const newestFirst = await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId).lt('createdAt', before))
    .order('desc')
    .take(RECENT_WINDOW)

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
  // History changed without the newest message moving — see bumpChatMeta.
  await bumpChatMeta(ctx, message.teamId, now, false)
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

export const olderMessages = query({
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
