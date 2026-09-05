import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import {
  chatPointerFor,
  messagesSinceFor,
  olderMessagesFor,
  recentMessagesFor,
  sendMessageFor,
} from './chat.ts'
import { aPlayer, aTeam } from './fixtures.ts'
import {
  BUDGET_THRESHOLD_BYTES,
  RATE_LIMIT_MESSAGES,
  RECENT_WINDOW,
  budgetIncrementFor,
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
      expect(since.map((m) => m.body)).toEqual(['new'])
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
