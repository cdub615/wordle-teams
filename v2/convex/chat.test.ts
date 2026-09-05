import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import {
  chatPointerFor,
  deleteMessageFor,
  messagesSinceFor,
  olderMessagesFor,
  recentMessagesFor,
  sendMessageFor,
} from './chat.ts'
import { deleteTeamFor } from './teams.ts'
import { aPlayer, aTeam } from './fixtures.ts'
import {
  BUDGET_THRESHOLD_BYTES,
  RATE_LIMIT_MESSAGES,
  RECENT_WINDOW,
  budgetIncrementFor,
  budgetIncrementForDelete,
  budgetMonthFor,
} from './lib/chat.ts'

const modules = import.meta.glob('./**/*.ts')

describe('the chat schema', () => {
  // THE LOAD-BEARING ASSUMPTION OF THE WHOLE DESIGN. Every wake does a
  // "messages since T" range scan on this index. If this does not work, the
  // pointer architecture in spec section 4 does not work.
  test('finds only the messages after a given time, by team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'first', createdAt: 1000 })
      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'second', createdAt: 2000 })
      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'third', createdAt: 3000 })

      const since = await ctx.db
        .query('chatMessages')
        .withIndex('by_team_createdAt', (q) => q.eq('teamId', team).gt('createdAt', 1000))
        .collect()

      expect(since.map((m) => m.body)).toEqual(['second', 'third'])
    })
  })

  test('keeps one team\'s messages out of another\'s range scan', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mine = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const theirs = await ctx.db.insert('teams', aTeam({ legacyId: 900, name: 'Theirs', playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatMessages', { teamId: mine, playerId: ada, body: 'mine', createdAt: 1000 })
      await ctx.db.insert('chatMessages', { teamId: theirs, playerId: ada, body: 'theirs', createdAt: 1000 })

      const found = await ctx.db
        .query('chatMessages')
        .withIndex('by_team_createdAt', (q) => q.eq('teamId', mine))
        .collect()

      expect(found.map((m) => m.body)).toEqual(['mine'])
    })
  })

  test('holds a pointer, a read cursor and a budget row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatMeta', { teamId: team, lastMessageAt: 5, revision: 1 })
      await ctx.db.insert('chatReads', { playerId: ada, teamId: team, lastReadAt: 5 })
      await ctx.db.insert('chatBudget', { month: '2026-09', estimatedBytes: 0, degraded: false })

      const meta = await ctx.db
        .query('chatMeta')
        .withIndex('by_team', (q) => q.eq('teamId', team))
        .unique()
      const cursor = await ctx.db
        .query('chatReads')
        .withIndex('by_player_team', (q) => q.eq('playerId', ada).eq('teamId', team))
        .unique()
      const budget = await ctx.db
        .query('chatBudget')
        .withIndex('by_month', (q) => q.eq('month', '2026-09'))
        .unique()

      expect(meta?.revision).toBe(1)
      expect(cursor?.lastReadAt).toBe(5)
      expect(budget?.degraded).toBe(false)
    })
  })
})

describe('sendMessageFor', () => {
  test('stores a trimmed message for a member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await sendMessageFor(ctx, ada, team, '  hello team  ')

      const stored = await ctx.db
        .query('chatMessages')
        .withIndex('by_team_createdAt', (q) => q.eq('teamId', team))
        .collect()
      expect(stored.map((m) => m.body)).toEqual(['hello team'])
      expect(stored[0].playerId).toBe(ada)
    })
  })

  // THE SECURITY BOUNDARY. The route guard in Part 2 is UX; this is the gate.
  test('refuses a non-member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await expect(sendMessageFor(ctx, mallory, team, 'let me in')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })

      const stored = await ctx.db.query('chatMessages').collect()
      expect(stored).toEqual([])
    })
  })

  test('refuses an empty message', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await expect(sendMessageFor(ctx, ada, team, '   ')).rejects.toMatchObject({
        data: { code: 'INVALID_MESSAGE' },
      })
    })
  })

  test('creates the pointer on the first message and advances it on the next', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'one')
      const first = await ctx.db
        .query('chatMeta')
        .withIndex('by_team', (q) => q.eq('teamId', team))
        .unique()

      await sendMessageFor(ctx, ada, team, 'two')
      const second = await ctx.db
        .query('chatMeta')
        .withIndex('by_team', (q) => q.eq('teamId', team))
        .unique()

      expect(first?.revision).toBe(1)
      expect(second?.revision).toBe(2)
      expect(second?.lastMessageAt ?? 0).toBeGreaterThanOrEqual(first?.lastMessageAt ?? 0)
    })
  })

  // Sending is reading: you have obviously seen your own message.
  test('advances the sender\'s own read cursor', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'hello')

      const cursor = await ctx.db
        .query('chatReads')
        .withIndex('by_player_team', (q) => q.eq('playerId', ada).eq('teamId', team))
        .unique()
      const meta = await ctx.db
        .query('chatMeta')
        .withIndex('by_team', (q) => q.eq('teamId', team))
        .unique()

      expect(cursor?.lastReadAt).toBe(meta?.lastMessageAt)
    })
  })
})

describe('the send rate limit', () => {
  test('allows a full window and refuses the one after it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) {
        await sendMessageFor(ctx, ada, team, `message ${i}`)
      }
      await expect(sendMessageFor(ctx, ada, team, 'one too many')).rejects.toMatchObject({
        data: { code: 'RATE_LIMITED' },
      })

      const stored = await ctx.db
        .query('chatMessages')
        .withIndex('by_team_createdAt', (q) => q.eq('teamId', team))
        .collect()
      expect(stored).toHaveLength(RATE_LIMIT_MESSAGES)
    })
  })

  // The limit is per player per team, so one chatty person must not silence
  // their teammates — this is a group feature.
  test('does not let one player\'s limit block another', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) {
        await sendMessageFor(ctx, ada, team, `message ${i}`)
      }
      await expect(sendMessageFor(ctx, ada, team, 'blocked')).rejects.toMatchObject({
        data: { code: 'RATE_LIMITED' },
      })

      // Bob is unaffected.
      await expect(sendMessageFor(ctx, bob, team, 'still fine')).resolves.toBeDefined()
    })
  })

  // Per player PER TEAM. Being chatty in one team must not silence you in
  // another — the window lives on the chatReads row, which is keyed by both.
  test('does not let a player\'s limit in one team block another team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const noisy = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const quiet = await ctx.db.insert('teams', aTeam({ legacyId: 902, name: 'Quiet', playerIds: [ada], owner: ada }))

      for (let i = 0; i < RATE_LIMIT_MESSAGES; i++) {
        await sendMessageFor(ctx, ada, noisy, `message ${i}`)
      }
      await expect(sendMessageFor(ctx, ada, noisy, 'blocked here')).rejects.toMatchObject({
        data: { code: 'RATE_LIMITED' },
      })

      await expect(sendMessageFor(ctx, ada, quiet, 'but fine here')).resolves.toBeDefined()
    })
  })
})

describe('the budget meter', () => {
  test('charges every member of the team for each message sent', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'hello')

      const budget = await ctx.db
        .query('chatBudget')
        .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
        .unique()
      expect(budget?.estimatedBytes).toBe(budgetIncrementFor(2))
      expect(budget?.degraded).toBe(false)
    })
  })

  test('degrades once the month crosses the threshold', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatBudget', {
        month: budgetMonthFor(Date.now()),
        estimatedBytes: BUDGET_THRESHOLD_BYTES,
        degraded: false,
      })

      await sendMessageFor(ctx, ada, team, 'over the line')

      const budget = await ctx.db
        .query('chatBudget')
        .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
        .unique()
      expect(budget?.degraded).toBe(true)
    })
  })

  // DEGRADED MUST NOT MEAN SILENCED. Live updates pause; the conversation does
  // not stop. Cutting sending would be a worse outcome than the cost it saves.
  test('still accepts messages while degraded', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await ctx.db.insert('chatBudget', {
        month: budgetMonthFor(Date.now()),
        estimatedBytes: BUDGET_THRESHOLD_BYTES * 2,
        degraded: true,
      })

      // NOTE: this cannot fail today — nothing in sendMessageFor consults
      // `degraded`, so it passes by default rather than by design. It is a
      // regression guard: if someone later makes the meter gate sending, this is
      // what should stop them.
      await expect(sendMessageFor(ctx, ada, team, 'still talking')).resolves.toBeDefined()
    })
  })

  // A delete is the most expensive operation in the feature — every connected
  // client refetches the whole window because it cannot know which message
  // went. An unmetered path at 17x normal cost would quietly invalidate the
  // ~7% model the meter exists to guarantee.
  test('charges a delete far more than a send', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const id = await sendMessageFor(ctx, ada, team, 'regrettable')

      const month = budgetMonthFor(Date.now())
      const afterSend = await ctx.db
        .query('chatBudget').withIndex('by_month', (q) => q.eq('month', month)).unique()
      await deleteMessageFor(ctx, ada, id)
      const afterDelete = await ctx.db
        .query('chatBudget').withIndex('by_month', (q) => q.eq('month', month)).unique()

      const charged = (afterDelete?.estimatedBytes ?? 0) - (afterSend?.estimatedBytes ?? 0)
      expect(charged).toBe(budgetIncrementForDelete(2))
      expect(charged).toBeGreaterThan(budgetIncrementFor(2))
    })
  })
})

describe('the chat reads', () => {
  test('the pointer carries the team\'s state and the app\'s degraded flag', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      const pointer = await chatPointerFor(ctx, ada, team)
      expect(pointer.revision).toBe(1)
      expect(pointer.lastMessageAt).toBeGreaterThan(0)
      expect(pointer.degraded).toBe(false)
    })
  })

  // Pins the derivation: a row whose STORED flag disagrees with its own byte
  // count must report the truth, not the stale flag.
  test('derives degraded from the byte count, not the stored flag', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await ctx.db.insert('chatBudget', {
        month: budgetMonthFor(Date.now()),
        estimatedBytes: BUDGET_THRESHOLD_BYTES * 2,
        degraded: false, // stale: says fine, the bytes say otherwise
      })

      expect((await chatPointerFor(ctx, ada, team)).degraded).toBe(true)
    })
  })

  test('the pointer is empty but valid for a team that has never chatted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const pointer = await chatPointerFor(ctx, ada, team)
      expect(pointer).toEqual({ lastMessageAt: 0, revision: 0, degraded: false })
    })
  })

  test('the window returns the newest messages oldest-first', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      for (let i = 0; i < RECENT_WINDOW + 5; i++) {
        await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
      }

      const window = await recentMessagesFor(ctx, ada, team)
      expect(window).toHaveLength(RECENT_WINDOW)
      // Oldest-first, and it is the TAIL of the conversation, not the head.
      expect(window[0].body).toBe('m5')
      expect(window[window.length - 1].body).toBe(`m${RECENT_WINDOW + 4}`)
    })
  })

  test('the incremental fetch returns only what the client lacks', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'old', createdAt: 1000 })
      await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'new', createdAt: 2000 })

      const since = await messagesSinceFor(ctx, ada, team, 1000)
      expect(since.gap).toBe(false)
      expect(since.gap === false && since.messages.map((m) => m.body)).toEqual(['new'])
    })
  })

  test('reports a gap rather than truncating when the client is far behind', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      for (let i = 0; i < RECENT_WINDOW + 5; i++) {
        await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
      }

      expect(await messagesSinceFor(ctx, ada, team, 0)).toEqual({ gap: true })
    })
  })

  // The boundary itself must NOT report a gap: exactly a window's worth is
  // deliverable, and reporting a gap there would make a busy team refetch the
  // whole window unnecessarily.
  test('delivers exactly a window\'s worth without reporting a gap', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      for (let i = 0; i < RECENT_WINDOW; i++) {
        await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
      }

      const result = await messagesSinceFor(ctx, ada, team, 0)
      expect(result.gap).toBe(false)
      expect(result.gap === false && result.messages).toHaveLength(RECENT_WINDOW)
    })
  })

  // THE BOUND ITSELF, caught by Convex's own scan quota rather than by any
  // assertion on the result. convex-test reimplements the real per-function
  // documents-read limit, so tightening it here makes an unbounded read fail
  // the way production would — which is the one thing an assertion on `gap`
  // cannot see, since a capped and an uncapped read produce the same count.
  test('never scans unboundedly, however far behind the client is', async () => {
    const t = convexTest({ schema, modules, transactionLimits: { documentsRead: 50 } })
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
      }

      expect(await messagesSinceFor(ctx, ada, team, 0)).toEqual({ gap: true })
    })
  })

  test('older messages page backwards from a given time', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
      }

      const older = await olderMessagesFor(ctx, ada, team, 1003)
      expect(older.map((m) => m.body)).toEqual(['m0', 'm1', 'm2'])
    })
  })

  // EVERY READ IS GATED, not just the writes. This is the easiest rule in the
  // feature to forget, because reads feel harmless.
  test('refuses a non-member on every read', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'private')

      const notAMember = { data: { code: 'NOT_A_MEMBER' } }
      await expect(chatPointerFor(ctx, mallory, team)).rejects.toMatchObject(notAMember)
      await expect(recentMessagesFor(ctx, mallory, team)).rejects.toMatchObject(notAMember)
      await expect(messagesSinceFor(ctx, mallory, team, 0)).rejects.toMatchObject(notAMember)
      await expect(olderMessagesFor(ctx, mallory, team, Date.now())).rejects.toMatchObject(notAMember)
    })
  })
})

describe('deleteMessageFor', () => {
  test('lets an author delete their own message', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const id = await sendMessageFor(ctx, bob, team, 'mine to remove')

      await deleteMessageFor(ctx, bob, id)

      expect(await ctx.db.get(id)).toBeNull()
    })
  })

  test('lets the team owner delete anyone\'s message', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const id = await sendMessageFor(ctx, bob, team, 'something regrettable')

      await deleteMessageFor(ctx, ada, id)

      expect(await ctx.db.get(id)).toBeNull()
    })
  })

  test('refuses a member who is neither the author nor the owner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const cass = await ctx.db.insert('players', aPlayer({ email: 'cass@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob, cass], owner: ada }))
      const id = await sendMessageFor(ctx, bob, team, 'not yours')

      await expect(deleteMessageFor(ctx, cass, id)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
      expect(await ctx.db.get(id)).not.toBeNull()
    })
  })

  test('refuses a non-member outright', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const id = await sendMessageFor(ctx, ada, team, 'private')

      await expect(deleteMessageFor(ctx, mallory, id)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
      expect(await ctx.db.get(id)).not.toBeNull()
    })
  })

  // THE REASON `revision` EXISTS. A delete does not move lastMessageAt, so
  // without this bump a connected client would go on showing a deleted message
  // forever.
  test('bumps revision without moving lastMessageAt', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'first')
      const id = await sendMessageFor(ctx, ada, team, 'second')

      const before = await chatPointerFor(ctx, ada, team)
      await deleteMessageFor(ctx, ada, id)
      const after = await chatPointerFor(ctx, ada, team)

      expect(after.revision).toBe(before.revision + 1)
      expect(after.lastMessageAt).toBe(before.lastMessageAt)
    })
  })
})

describe('deleting a team', () => {
  test('takes its messages, pointer and read cursors with it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')
      await sendMessageFor(ctx, bob, team, 'hi back')

      await deleteTeamFor(ctx, ada, team)

      expect(await ctx.db.query('chatMessages').collect()).toEqual([])
      expect(await ctx.db.query('chatMeta').collect()).toEqual([])
      expect(await ctx.db.query('chatReads').collect()).toEqual([])
    })
  })

  // The budget is app-wide and monthly, not per team. Deleting a team must not
  // hand back bandwidth that has already been spent.
  test('leaves the bandwidth budget alone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      await deleteTeamFor(ctx, ada, team)

      const budget = await ctx.db.query('chatBudget').collect()
      expect(budget).toHaveLength(1)
      expect(budget[0].estimatedBytes).toBeGreaterThan(0)
    })
  })

  // THE ORPHAN CASE, found in review of Task 1. A player who LEFT before the
  // team was deleted is no longer in playerIds, so a cascade that walked the
  // roster would never find their cursor and it would outlive the team with
  // nothing able to reach it. The row is inserted directly rather than by
  // calling leaveTeamFor, so this tests the CASCADE rather than the leave flow.
  test('removes the cursor of someone who had already left the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const gone = await ctx.db.insert('players', aPlayer({ email: 'gone@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'hello')

      // A cursor belonging to someone who is NOT on the roster any more.
      await ctx.db.insert('chatReads', { playerId: gone, teamId: team, lastReadAt: 1 })

      await deleteTeamFor(ctx, ada, team)

      expect(await ctx.db.query('chatReads').collect()).toEqual([])
    })
  })

  test('does not touch another team\'s chat', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const doomed = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const kept = await ctx.db.insert('teams', aTeam({ legacyId: 901, name: 'Kept', playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, doomed, 'goodbye')
      await sendMessageFor(ctx, ada, kept, 'still here')

      await deleteTeamFor(ctx, ada, doomed)

      const left = await ctx.db.query('chatMessages').collect()
      expect(left.map((m) => m.body)).toEqual(['still here'])
    })
  })
})
