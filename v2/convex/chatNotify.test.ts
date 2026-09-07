import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import { aPlayer, aTeam } from './fixtures.ts'
import { markReadFor, sendMessageFor } from './chat.ts'
import {
  MAX_NOTIFIED_TEAM_NAME,
  chatNotificationBody,
  markChatNotifiedFor,
  pendingChatNotificationsFor,
} from './chatNotify.ts'
import type { Id } from './_generated/dataModel'
import type { ReaderCtx, WriterCtx } from './winners.ts'

const modules = import.meta.glob('./**/*.ts')

/**
 * The batched chat push sweep.
 *
 * TWO LAYERS TESTED SEPARATELY, on purpose. `pendingChatNotificationsFor`
 * answers "who is owed a notification" and knows nothing about push; `sweep`
 * decides who is actually DELIVERED to, which is gated on the same
 * `reminderDeliveryMethods` consent the board-entry sweep honours. Folding that
 * consent check into the first function would make "owed" and "reachable" the
 * same question, and the idempotence property — everyone owed gets marked,
 * whether or not a device exists to tell — would have nowhere left to live.
 *
 * NOTHING HERE DEPENDS ON THE WALL CLOCK ADVANCING. `sendMessageFor` and
 * `markChatNotifiedFor` both stamp `Date.now()`, and two calls in one test can
 * land in the same millisecond — which would make "a newer message arrived"
 * indistinguishable from "nothing happened" and turn these tests flaky on a
 * fast machine. Where a test needs a later message it patches `chatMeta`
 * forward instead, which is what a later message does anyway.
 */

/** Every `pushSend:deliverTo` job the harness has queued, args included. */
async function scheduledPushJobs(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    ctx.db.system
      .query('_scheduled_functions')
      .collect()
      .then((rows) => rows.filter((row) => row.name === 'pushSend:deliverTo')),
  )
}

/**
 * A message sent `by` milliseconds later than the last one, without waiting for
 * a clock: the pointer moves forward and so does the SENDER's own cursor, which
 * is exactly the pair of writes sendMessageFor makes ("sending is reading").
 * Moving only the pointer would leave the sender owed a notification for their
 * own message, which is a state no real send can produce.
 */
async function aLaterMessageFrom(
  ctx: WriterCtx,
  senderId: Id<'players'>,
  teamId: Id<'teams'>,
  by: number,
) {
  const meta = await ctx.db
    .query('chatMeta')
    .withIndex('by_team', (q) => q.eq('teamId', teamId))
    .unique()
  const at = meta!.lastMessageAt + by
  await ctx.db.patch(meta!._id, { lastMessageAt: at, revision: meta!.revision + 1 })

  const cursor = await ctx.db
    .query('chatReads')
    .withIndex('by_player_team', (q) => q.eq('playerId', senderId).eq('teamId', teamId))
    .unique()
  await ctx.db.patch(cursor!._id, { lastReadAt: at })
}

async function cursorOf(ctx: ReaderCtx, playerId: Id<'players'>) {
  return await ctx.db
    .query('chatReads')
    .withIndex('by_player', (q) => q.eq('playerId', playerId))
    .unique()
}

describe('pendingChatNotificationsFor', () => {
  test('notifies a member with unread messages they have not been told about', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      const pending = await pendingChatNotificationsFor(ctx)
      expect(pending.map((p) => p.playerId)).toEqual([bob])
      expect(pending.map((p) => p.teamName)).toEqual(['team 206'])
    })
  })

  test('does not notify the sender', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'mine')

      expect(await pendingChatNotificationsFor(ctx)).toEqual([])
    })
  })

  test('does not notify twice for the same messages', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      const first = await pendingChatNotificationsFor(ctx)
      for (const p of first) await markChatNotifiedFor(ctx, p.playerId, p.teamId)

      expect(await pendingChatNotificationsFor(ctx)).toEqual([])
    })
  })

  test('notifies again once a NEW message arrives after the last notification', async () => {
    // The other half of idempotence, and the half a "suppress everything after
    // the first notification ever" bug would leave green. Notifying twice and
    // never notifying again are both wrong; only having both tests tells them
    // apart.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')
      for (const p of await pendingChatNotificationsFor(ctx)) {
        await markChatNotifiedFor(ctx, p.playerId, p.teamId)
      }

      await aLaterMessageFrom(ctx, ada, team, 60_000)

      expect((await pendingChatNotificationsFor(ctx)).map((p) => p.playerId)).toEqual([bob])
    })
  })

  test('stops notifying once the member has read the conversation', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      await markReadFor(ctx, bob, team)

      expect(await pendingChatNotificationsFor(ctx)).toEqual([])
    })
  })

  test('ONE entry per team per sweep, however many messages were sent', async () => {
    // The whole point of the batching. A per-message shape returns three here,
    // and three notifications is what drives somebody to switch the app's
    // notifications off entirely — taking the board-entry reminders with them.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'one')
      await sendMessageFor(ctx, ada, team, 'two')
      await sendMessageFor(ctx, ada, team, 'three')

      expect(await pendingChatNotificationsFor(ctx)).toHaveLength(1)
    })
  })

  test('ignores a chatReads row belonging to a member who has since left', async () => {
    // The cursor table is read through `by_team`, which returns rows for former
    // members too — `resetChatCursorFor` only clears one on ADD, and says so.
    // The roster on the team document is what decides who is owed anything.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const gone = await ctx.db.insert('players', aPlayer({ email: 'gone@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, gone], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')
      await ctx.db.patch(team, { playerIds: [ada] })

      expect(await pendingChatNotificationsFor(ctx)).toEqual([])
    })
  })

  test('a team whose document has been deleted is skipped, not thrown on', async () => {
    // deleteTeamFor DOES cascade chatMeta, so this state is not reachable
    // through the app today — the row is written directly here. The branch
    // exists for the paths that cascade does not cover (a copy or migration
    // writing chatMeta, a future delete path forgetting one of the three
    // tables), and the cost of getting it wrong is the whole sweep dying on
    // one row and delivering nothing to anybody.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')
      await ctx.db.delete(team)

      expect(await pendingChatNotificationsFor(ctx)).toEqual([])
    })
  })

  test('READS NO MESSAGES, which is the property this design exists to hold', async () => {
    // Asserted rather than promised in a comment. Putting a count in the
    // notification body ("3 new messages in …") is the change that breaks it —
    // see the module comment on why the design's own documented fallback was
    // taken instead.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      for (let i = 0; i < 5; i += 1) await sendMessageFor(ctx, ada, team, `message ${i}`)

      const tables: Array<string> = []
      const spy = {
        db: {
          get: (id: unknown) => ctx.db.get(id as Id<'teams'>),
          query: (table: string) => {
            tables.push(table)
            return ctx.db.query(table as 'chatMeta')
          },
        },
      } as unknown as ReaderCtx

      expect(await pendingChatNotificationsFor(spy)).toHaveLength(1)
      expect(tables).not.toContain('chatMessages')
      expect(tables).toContain('chatMeta')
    })
  })
})

/**
 * THE PUSH BODY, AND WHY IT IS CLAMPED (wordle-teams-5gm3).
 *
 * NOT AN INJECTION RISK, and worth writing down so nobody re-litigates it: the
 * Notification API takes plain text rather than markup, and the deep link is
 * built server-side from the team ID and clamped to the worker's own origin
 * (resolveNotificationUrl in src/lib/sw-push.ts). A crafted team name cannot
 * inject anything anywhere.
 *
 * WHAT IS WRONG IS THAT SOMEBODY ELSE CHOOSES THE CUT. Team names have no
 * length limit at any layer — requireName only rejects an empty one — so an
 * unclamped body is as long as somebody typed, and the operating system
 * truncates it at a point that varies by platform, by device and by whether the
 * shade is expanded. It can cut mid-word, and it can push the words that
 * identify this as a CHAT notification off the end entirely, which is the one
 * part a reader needs to decide whether to tap.
 *
 * THE BOARD REMINDER DOES NOT SHARE THIS. Its body is a fixed literal in
 * pushSend.ts (REMINDER_PAYLOAD) with nothing interpolated into it, and its
 * byte-identical twin in src/lib/sw-push.ts is fixed too. This is the only
 * push body in the app built from user-supplied text.
 */
describe('chatNotificationBody', () => {
  test('names the team, which is the whole point of the notification', () => {
    expect(chatNotificationBody('Wordle Wizards')).toBe('New messages in Wordle Wizards')
  })

  test('leaves a name that fits exactly alone, ellipsis and all', () => {
    const exact = 'x'.repeat(MAX_NOTIFIED_TEAM_NAME)
    expect(chatNotificationBody(exact)).toBe(`New messages in ${exact}`)
  })

  // THE CUT IS OURS, AND IT IS VISIBLE. A body that simply ran on would be cut
  // by the OS with no mark at all, so the reader cannot tell a long name from a
  // truncated one.
  test('clamps a longer name to a deliberate width, with an ellipsis', () => {
    const body = chatNotificationBody('y'.repeat(MAX_NOTIFIED_TEAM_NAME + 50))
    expect(body).toBe(`New messages in ${'y'.repeat(MAX_NOTIFIED_TEAM_NAME - 1)}\u2026`)
    expect(body.endsWith('\u2026')).toBe(true)
  })

  // ONE ELLIPSIS CHARACTER, NOT THREE DOTS, so the clamped name is exactly
  // MAX_NOTIFIED_TEAM_NAME long rather than two characters over the budget it
  // was clamped to.
  test('never exceeds the budget it clamps to', () => {
    const name = [...chatNotificationBody('z'.repeat(500))].slice('New messages in '.length)
    expect(name).toHaveLength(MAX_NOTIFIED_TEAM_NAME)
  })

  // COUNTED IN CODE POINTS, NOT UTF-16 UNITS. `String.prototype.slice` cuts
  // between the halves of a surrogate pair, so a name of emoji clamped by
  // `.slice` ends in a lone surrogate — which renders as the replacement
  // glyph in the shade. Every astral character here is two UTF-16 units, so a
  // naive slice would also produce a name half the intended length.
  test('does not cut an emoji in half', () => {
    const body = chatNotificationBody('🎉'.repeat(MAX_NOTIFIED_TEAM_NAME + 10))
    const name = body.slice('New messages in '.length)
    expect([...name]).toHaveLength(MAX_NOTIFIED_TEAM_NAME)
    expect(name).not.toContain('\uFFFD')
    expect(name).toBe(`${'🎉'.repeat(MAX_NOTIFIED_TEAM_NAME - 1)}\u2026`)
  })

  // TRAILING SPACE GOES BEFORE THE ELLIPSIS DOES. Cutting mid-word can leave
  // the last kept character a space, and "Team … " reads as a rendering bug
  // rather than as a deliberate truncation.
  test('does not leave a space sitting in front of the ellipsis', () => {
    const name = `${'a'.repeat(MAX_NOTIFIED_TEAM_NAME - 1)} bcdef`
    expect(chatNotificationBody(name)).toBe(
      `New messages in ${'a'.repeat(MAX_NOTIFIED_TEAM_NAME - 1)}\u2026`,
    )
  })
})

describe('sweep', () => {
  test('schedules one batched push per owed member, deep-linked to the team', async () => {
    const t = convexTest(schema, modules)
    const { bob, team } = await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert(
        'players',
        aPlayer({ email: 'bob@example.com', reminderDeliveryMethods: ['push'] }),
      )
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')
      return { bob, team }
    })

    await t.mutation(internal.chatNotify.sweep, {})

    const jobs = await scheduledPushJobs(t)
    expect(jobs).toHaveLength(1)
    // THE FULL ARGS, not just the count. `attempt: 0` is what lets deliverTo's
    // one bounded retry happen at all, and the url is the deep link — a chat
    // notification landing on `/app` would be indistinguishable from the
    // board-entry reminder that it is not.
    expect(jobs[0]!.args).toEqual([
      {
        playerId: bob,
        attempt: 0,
        notification: {
          title: 'Wordle Teams',
          body: 'New messages in team 206',
          url: `/chat?team=${team}`,
        },
      },
    ])
  })

  // THE WIRING, NOT THE HELPER. chatNotificationBody can be perfect and unused:
  // the body is composed at the one call site above, and a clamp that is not
  // called there is a clamp that does nothing. Driven through the real sweep
  // for the same reason the leave-path tests avoid resetChatCursorFor.
  test('clamps a long team name in the body it actually schedules', async () => {
    const t = convexTest(schema, modules)
    const longName = 'W'.repeat(MAX_NOTIFIED_TEAM_NAME + 60)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert(
        'players',
        aPlayer({ email: 'bob@example.com', reminderDeliveryMethods: ['push'] }),
      )
      const team = await ctx.db.insert(
        'teams',
        aTeam({ name: longName, playerIds: [ada, bob], owner: ada }),
      )
      await sendMessageFor(ctx, ada, team, 'hello')
    })

    await t.mutation(internal.chatNotify.sweep, {})

    const jobs = await scheduledPushJobs(t)
    const { body } = (jobs[0]!.args as Array<{ notification: { body: string } }>)[0].notification
    expect(body).toBe(chatNotificationBody(longName))
    expect(body).not.toContain(longName)
    expect(body.endsWith('\u2026')).toBe(true)
  })

  test('a second sweep with nothing new schedules nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert(
        'players',
        aPlayer({ email: 'bob@example.com', reminderDeliveryMethods: ['push'] }),
      )
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')
    })

    await t.mutation(internal.chatNotify.sweep, {})
    await t.mutation(internal.chatNotify.sweep, {})

    expect(await scheduledPushJobs(t)).toHaveLength(1)
  })

  test('does not deliver to a player who has not turned push on', async () => {
    // The fixture default is `['email']`, and there is no email path for chat.
    // Turning the Push switch off deletes only the CURRENT browser's
    // subscription row, so a second device's row can outlive the consent —
    // this check, not the presence of a row, is what decides.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')
    })

    await t.mutation(internal.chatNotify.sweep, {})

    expect(await scheduledPushJobs(t)).toHaveLength(0)
  })

  test('still marks an unreachable player notified, so they are not re-swept forever', async () => {
    // Claim regardless of delivery, exactly as reminders.sweep does. Skipping
    // the write would make every hourly run re-read the same rows to reach the
    // same "cannot deliver" answer, for as long as the message stays unread.
    const t = convexTest(schema, modules)
    const bob = await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')
      return bob
    })

    await t.mutation(internal.chatNotify.sweep, {})

    const cursor = await t.run(async (ctx) => await cursorOf(ctx, bob))
    expect(cursor?.lastNotifiedAt).toBeGreaterThan(0)
    // AND NOT MARKED READ. A notification is not a reading; zeroing this
    // distinction would clear the unread badge for a message nobody opened.
    expect(cursor?.lastReadAt).toBe(0)
  })

  test('marking notified leaves lastReadAt and the rate-limit window alone', async () => {
    // `chatReads` is shared with sendMessageFor's post window and markReadFor's
    // cursor. A `replace` here, or a write that defaulted the omitted fields,
    // would hand every player a fresh rate-limit window once an hour.
    const t = convexTest(schema, modules)
    const bob = await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hi from ada')
      // Bob has now both read (sending is reading) and spent one post window.
      await sendMessageFor(ctx, bob, team, 'hi from bob')
      await aLaterMessageFrom(ctx, ada, team, 60_000)
      return bob
    })

    const before = await t.run(async (ctx) => await cursorOf(ctx, bob))
    await t.mutation(internal.chatNotify.sweep, {})
    const after = await t.run(async (ctx) => await cursorOf(ctx, bob))

    expect(after?.lastReadAt).toBe(before?.lastReadAt)
    expect(after?.postsInWindow).toBe(before?.postsInWindow)
    expect(after?.postWindowStartedAt).toBe(before?.postWindowStartedAt)
    expect(after?.lastNotifiedAt).toBeGreaterThan(before?.lastNotifiedAt ?? 0)
  })

  test('a team that has never chatted notifies nobody', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert(
        'players',
        aPlayer({ email: 'bob@example.com', reminderDeliveryMethods: ['push'] }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
    })

    await t.mutation(internal.chatNotify.sweep, {})

    expect(await scheduledPushJobs(t)).toHaveLength(0)
  })
})
