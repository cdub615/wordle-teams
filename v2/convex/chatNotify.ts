import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { METHODS } from './lib/reminders.ts'
import type { Id } from './_generated/dataModel'
import type { ReaderCtx, WriterCtx } from './winners.ts'

/**
 * Team chat's batched push sweep (wordle-teams-qix). Phase 7.5, Part 2.
 *
 * Design: docs/superpowers/specs/2026-09-05-team-chat-design.md §5.
 *
 * KEPT OUT OF chat.ts, which is already ~670 lines and whose concern is the
 * conversation, not delivery. Nothing in here is reachable from the client:
 * the only exported Convex function is an `internalMutation` the cron calls.
 *
 * ONE NOTIFICATION PER TEAM PER SWEEP, NEVER ONE PER MESSAGE. Push-per-message
 * is a spam and cost risk the epic flags, and one chatty team could drive
 * somebody to disable notifications for the whole app — which would take the
 * board-entry reminders that already work down with it. Whatever else changes
 * here, that batching is the feature.
 *
 * IT READS NO MESSAGES, and that is a deliberate departure from design §5's
 * first choice. The design asks for a count — "3 new messages in Team Name" —
 * and names the cost honestly: a range scan on `by_team_createdAt` since each
 * member's own `lastReadAt`, which is one scan PER MEMBER PER TEAM and is
 * bounded by nothing but how much was said. It then names its own fallback:
 * "drop the count and send 'New messages in Team Name'". That fallback is what
 * ships. The whole chat architecture exists so a client wake reads two small
 * documents rather than a message window (schema.ts's note on chatMeta,
 * unreadTeamsFor's on the badge); an hourly job that read every unread message
 * in every team would be the one place that undid it, and the notification is
 * useful without the number. Pinned by a test, not by this paragraph.
 *
 * WHAT IT COSTS PER RUN, as a function of T (teams that have ever chatted) and
 * M (members per team):
 *
 *   T                  the chatMeta collect — one row per chatting team
 *   T                  one `ctx.db.get` per team, for the roster and the name
 *   <= T * M           the chatReads `by_team` collect, one row per EXISTING
 *                      cursor (a member who never opened the chat has none)
 *   <= T * M           one `ctx.db.get` per player actually owed a notification
 *
 * So O(T * M) documents, and zero message documents. Bounded by the roster,
 * not by traffic. At today's ~149 teams that is a few hundred documents an
 * hour. IT IS NOT BOUNDED BY A CONSTANT, though: Convex caps the documents one
 * function may read, and a deployment with tens of thousands of teams would
 * eventually hit it. The fix then is to page the chatMeta scan across runs, not
 * to make the sweep cheaper per team — recorded here because the shape of the
 * next change is much easier to see now than it will be at that point.
 */

export type PendingChatNotification = {
  playerId: Id<'players'>
  teamId: Id<'teams'>
  teamName: string
}

const [, PUSH_METHOD] = METHODS

/**
 * Who is owed a chat notification right now.
 *
 * A player is owed one when the team's `lastMessageAt` is newer than BOTH their
 * `lastReadAt` (they have not seen it) and their `lastNotifiedAt` (we have not
 * already told them). The second condition is what makes this idempotent across
 * sweeps: the message stays unread for as long as the player ignores it, so
 * `lastReadAt` alone would re-send the same notification every hour, forever.
 *
 * STRICTLY GREATER, ON BOTH. `>=` on `told` would notify on every sweep for an
 * unread message; `>=` on `seen` would notify a player about their own message,
 * since sendMessageFor stamps `lastReadAt` with the very timestamp it writes to
 * `lastMessageAt` ("sending is reading"). The one-millisecond edge — a message
 * landing in the same millisecond as the sweep's own write — loses a
 * notification rather than duplicating one, which is the right way round for a
 * job that runs hourly.
 *
 * IT KNOWS NOTHING ABOUT PUSH. "Owed" and "reachable" are different questions
 * and are answered in different places: `sweep` gates delivery on the player's
 * own consent, and marks everybody owed regardless. Answering both here would
 * mean a player who has push switched off is re-evaluated on every run forever,
 * because nothing would ever advance their cursor.
 *
 * A MISSING chatReads ROW READS AS ZERO ON BOTH FIELDS — never read, never
 * told — which is exactly right for somebody who has never opened the
 * conversation, and is the same `?? 0` unreadTeamsFor uses for the badge.
 *
 * THE ROSTER DECIDES, NOT THE CURSOR TABLE. Cursors are read through `by_team`
 * (one indexed range read per team, rather than one point read per member) and
 * that index can still return rows for FORMER members. Since
 * wordle-teams-qix.11 every removal path calls resetChatCursorFor, so the
 * common case leaves none — but a row written before that was wired, or by a
 * future path that forgets, is exactly what this index would hand back.
 * Iterating `team.playerIds` and looking each one up in the map is what keeps a
 * leaver out; iterating the cursors instead would push at people who are no
 * longer on the team, and would do so on a rule that depends on every removal
 * path being right rather than on the roster it can read.
 */
export async function pendingChatNotificationsFor(
  ctx: ReaderCtx,
): Promise<Array<PendingChatNotification>> {
  // A FULL COLLECT, AND THE RIGHT SHAPE HERE. There is no index that narrows
  // "teams with something to notify about": a team idle since the last sweep
  // still owes a notification to anyone who JOINED since it, whose cursor was
  // deleted by resetChatCursorFor and therefore reads as never-told. Narrowing
  // by `lastMessageAt` would silently skip exactly that person. One row per
  // team that has ever chatted, which is the bound stated above.
  const metas = await ctx.db.query('chatMeta').collect()
  const pending: Array<PendingChatNotification> = []

  for (const meta of metas) {
    // NOT REACHABLE TODAY, AND KEPT ANYWAY. deleteTeamFor (teams.ts) cascades
    // chatMeta along with the messages and the cursors, so a live deployment
    // should hold no row whose team is gone. This branch is for the states
    // that cascade does not cover: a copy or a migration that writes chatMeta
    // without going through it, and any future delete path that forgets one of
    // the three tables. Skipping is the answer rather than throwing, because
    // one orphan must not take the sweep down for every other team in the
    // deployment — a sweep that dies here delivers nothing to anybody.
    const team = await ctx.db.get(meta.teamId)
    if (team === null) continue

    const cursors = await ctx.db
      .query('chatReads')
      .withIndex('by_team', (q) => q.eq('teamId', meta.teamId))
      .collect()
    const byPlayer = new Map(cursors.map((cursor) => [cursor.playerId, cursor]))

    for (const playerId of team.playerIds) {
      const cursor = byPlayer.get(playerId)
      const seen = cursor?.lastReadAt ?? 0
      const told = cursor?.lastNotifiedAt ?? 0
      if (meta.lastMessageAt > seen && meta.lastMessageAt > told) {
        pending.push({ playerId, teamId: meta.teamId, teamName: team.name })
      }
    }
  }

  return pending
}

/**
 * Record that we have told this player about this team's current state.
 *
 * A FIFTH WRITER OF THE CONTENDED `chatReads` ROW, after sendMessageFor,
 * markReadFor, olderMessagesFor and resetChatCursorFor. This one is off the
 * hot path in time rather than by construction: it runs once an hour, from a
 * cron, and only for rows whose team has had a message since the last run. It
 * CAN still collide with a live markRead — somebody opening the conversation at
 * exactly half past — and that collision is a Convex OCC retry, which re-runs
 * the whole sweep mutation having committed nothing. Cheap at this volume,
 * worth knowing about if the sweep ever grows.
 *
 * WRITES ONLY `lastNotifiedAt`, on the insert path as well as the patch path.
 * `ctx.db.patch` merges, so the rate-limit windows and `lastReadAt` living on
 * this same row survive untouched — the property upsertReadCursor's own comment
 * in chat.ts spells out, and the reason a `replace` here would silently reset
 * every player's post limit once an hour.
 *
 * THE INSERT DEFAULTS `lastReadAt` TO 0, NOT TO NOW. A notification is not a
 * reading. Stamping it would clear the unread badge for a message the player
 * has not opened, which is the opposite of what telling them about it is for.
 */
export async function markChatNotifiedFor(
  ctx: WriterCtx,
  playerId: Id<'players'>,
  teamId: Id<'teams'>,
): Promise<void> {
  const cursor = await ctx.db
    .query('chatReads')
    .withIndex('by_player_team', (q) => q.eq('playerId', playerId).eq('teamId', teamId))
    .unique()

  // Read INSIDE the mutation, so this is the transaction's timestamp rather
  // than anything captured earlier — the same reason crons.ts passes no `now`.
  const now = Date.now()

  if (cursor === null) {
    await ctx.db.insert('chatReads', { playerId, teamId, lastReadAt: 0, lastNotifiedAt: now })
    return
  }
  await ctx.db.patch(cursor._id, { lastNotifiedAt: now })
}

/**
 * The hourly sweep, scheduled by crons.ts at half past — see that file for why
 * it does not share the top of the hour with the board-entry reminders.
 *
 * A MUTATION, NOT AN ACTION, for the reason reminders.sweep is one: the
 * decision and the claim that suppresses it next hour have to commit in the
 * same transaction. Split across an action calling out to mutations, a failure
 * between the two is a duplicate notification — and unlike a duplicate email,
 * a duplicate push is the exact thing this feature is designed not to produce.
 *
 * CLAIM BEFORE DELIVERING, UNCONDITIONALLY, and not behind an `if` on whether
 * a push was scheduled. Same rule as reminders.sweep, for a slightly different
 * reason: an unread message stays unread, so a player we cannot reach would
 * otherwise be re-evaluated on every run for as long as they ignore it, paying
 * the same reads each time to reach the same answer.
 *
 * DELIVERY IS SCHEDULED, NEVER AWAITED. `deliverTo` is a 'use node' action that
 * talks to a push service over the network; awaiting it would let one dead
 * endpoint fail the sweep for everybody else. It carries its own 404/410
 * cleanup and its own single bounded retry, and this file adds nothing to
 * either — that plumbing is Phase 6's and is reused wholesale.
 *
 * GATED ON THE PLAYER'S OWN PUSH CONSENT, which is the same
 * `reminderDeliveryMethods` array the board-entry sweep honours. There is no
 * separate chat-notification setting, and inventing delivery to somebody who
 * has the app's one Push switch turned off is not a defensible reading of it.
 * It matters beyond tidiness: turning that switch off deletes the CURRENT
 * browser's subscription row only, so a second device's row can outlive the
 * consent, and `subscriptionsFor` alone would happily deliver to it.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pending = await pendingChatNotificationsFor(ctx)
    let notified = 0

    for (const { playerId, teamId, teamName } of pending) {
      await markChatNotifiedFor(ctx, playerId, teamId)
      notified += 1

      const player = await ctx.db.get(playerId)
      if (player === null) continue
      if (!player.reminderDeliveryMethods.includes(PUSH_METHOD)) continue

      await ctx.scheduler.runAfter(0, internal.pushSend.deliverTo, {
        playerId,
        attempt: 0,
        notification: {
          // `title` MATCHES THE REMINDER'S so the two notification types read
          // as one app in the shade; the team name goes in the body, where the
          // whole line is visible, rather than in a title the OS truncates
          // hardest.
          title: 'Wordle Teams',
          body: `New messages in ${teamName}`,
          // A RELATIVE, SAME-ORIGIN PATH — and it has to stay one. The service
          // worker clamps this to its own origin (resolveNotificationUrl in
          // src/lib/sw-push.ts) precisely because a URL in a push payload
          // otherwise becomes an open redirect that opens in the app's own
          // window; a payload that needed the clamp to save it would be a bug
          // here, not a caught attack.
          url: `/chat?team=${teamId}`,
        },
      })
    }

    return { notified }
  },
})
