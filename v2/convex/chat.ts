import { accessError, requireTeamMemberFor } from './access'
import {
  budgetIncrementFor,
  budgetMonthFor,
  isOverBudget,
  nextPostWindow,
  requireBody,
} from './lib/chat.ts'
import type { Id } from './_generated/dataModel'
import type { WriterCtx } from './winners.ts'

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
