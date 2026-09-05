import { accessError, requireTeamMemberFor } from './access'
import {
  RECENT_WINDOW,
  budgetIncrementFor,
  budgetMonthFor,
  isOverBudget,
  nextPostWindow,
  requireBody,
} from './lib/chat.ts'
import type { Id } from './_generated/dataModel'
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
 * Charge the month's bandwidth budget for one message, and set `degraded` once
 * the threshold is crossed.
 *
 * WHY A METER AT ALL. The modelled worst case is ~7% of Convex's free-tier
 * database-I/O allowance, which is a large margin and not a guarantee. This
 * turns it into one. When it trips, chat stops opening live subscriptions and
 * falls back to manual refresh — SENDING KEEPS WORKING, because the failure
 * this exists to prevent is Convex refusing mutations app-wide and taking board
 * entry down along with chat.
 *
 * DELIBERATELY A HOT DOCUMENT — unlike every other table this module touches,
 * which are keyed per team. Design §4 rejects a denormalised per-team blob
 * for exactly this shape, citing write contention on one hot document. Here
 * it is accepted rather than avoided: at current volume (~70 active players
 * across ~149 teams) the contention is negligible, and Convex resolves OCC
 * conflicts on a hot row by retrying transparently rather than failing the
 * mutation. Revisit if message volume ever climbs by an order of magnitude.
 */
async function chargeBudget(ctx: WriterCtx, teamSize: number, now: number): Promise<void> {
  const month = budgetMonthFor(now)
  const row = await ctx.db
    .query('chatBudget')
    .withIndex('by_month', (q) => q.eq('month', month))
    .unique()

  const estimatedBytes = (row?.estimatedBytes ?? 0) + budgetIncrementFor(teamSize)
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
  await chargeBudget(ctx, team.playerIds.length, now)

  // Sending is reading — you have seen your own message.
  if (cursor === null) {
    await ctx.db.insert('chatReads', { playerId, teamId, lastReadAt: now, ...window })
  } else {
    await ctx.db.patch(cursor._id, { lastReadAt: now, ...window })
  }

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
) {
  await requireTeamMemberFor(ctx, playerId, teamId)

  const newestFirst = await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId))
    .order('desc')
    .take(RECENT_WINDOW)

  return newestFirst.reverse()
}

/**
 * Everything after `since` — the hot path, and normally one document.
 *
 * This is the whole reason the architecture is cheap: a client that already
 * holds history up to T pays for what it lacks, not for the window it already
 * has.
 */
export async function messagesSinceFor(
  ctx: ReaderCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
  since: number,
) {
  await requireTeamMemberFor(ctx, playerId, teamId)

  return await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId).gt('createdAt', since))
    .collect()
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
) {
  await requireTeamMemberFor(ctx, playerId, teamId)

  const newestFirst = await ctx.db
    .query('chatMessages')
    .withIndex('by_team_createdAt', (q) => q.eq('teamId', teamId).lt('createdAt', before))
    .order('desc')
    .take(RECENT_WINDOW)

  return newestFirst.reverse()
}
