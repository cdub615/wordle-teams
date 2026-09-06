import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import betterAuthTest from '@convex-dev/better-auth/test'
import schema from './schema'
import { api } from './_generated/api'
import {
  chatPointerFor,
  deleteMessageFor,
  markReadFor,
  messagesSinceFor,
  olderMessagesFor,
  recentMessagesFor,
  resetChatCursorFor,
  sendMessageFor,
  unreadTeamsFor,
} from './chat.ts'
import { deleteTeamFor, invitePlayerFor, leaveTeamFor } from './teams.ts'
import { upgradeTeamInvitesFor } from './billing.ts'
import { aPlayer, aTeam, authenticatedAs } from './fixtures.ts'
import {
  BUDGET_THRESHOLD_BYTES,
  RATE_LIMIT_MESSAGES,
  RATE_LIMIT_SCROLLS,
  RECENT_WINDOW,
  budgetIncrementFor,
  budgetIncrementForDelete,
  budgetIncrementForScroll,
  budgetMonthFor,
} from './lib/chat.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
const today = toPuzzleDay(new Date())

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

  // THE FINDING THIS CLOSES: reads were unmetered and unrate-limited, and
  // olderMessagesFor is the one read expensive and cache-defeating enough
  // (see the top-of-file note) to be worth fixing. It is a mutation
  // specifically so it CAN charge chargeBudget — a query's ctx.db has no
  // write methods, so this coverage would be structurally impossible against
  // a query.
  describe('the scrollback meter and rate limit', () => {
    test('charges one RECENT_WINDOW page per call, not per team member', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const ada = await ctx.db.insert('players', aPlayer())
        const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
        const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
        for (let i = 0; i < 5; i++) {
          await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
        }

        await olderMessagesFor(ctx, ada, team, 1003)

        const budget = await ctx.db
          .query('chatBudget')
          .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
          .unique()
        // NOT multiplied by the team's two members — a send at this team size
        // would charge budgetIncrementFor(2), which is a different, smaller
        // number (BYTES_PER_WAKE * 2) than a single scroll page.
        expect(budget?.estimatedBytes).toBe(budgetIncrementForScroll())
      })
    })

    test('allows a full window of pages and refuses the one after it', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const ada = await ctx.db.insert('players', aPlayer())
        const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
        for (let i = 0; i < 5; i++) {
          await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
        }

        for (let i = 0; i < RATE_LIMIT_SCROLLS; i++) {
          await olderMessagesFor(ctx, ada, team, 1003)
        }
        await expect(olderMessagesFor(ctx, ada, team, 1003)).rejects.toMatchObject({
          data: { code: 'SCROLL_RATE_LIMITED' },
        })
      })
    })

    // A refused page must not spend the budget it was refused to protect —
    // the same ordering sendMessageFor already relies on (rate check before
    // the write), pinned here for the scroll path specifically.
    test('a refused page charges nothing further', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const ada = await ctx.db.insert('players', aPlayer())
        const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
        for (let i = 0; i < 5; i++) {
          await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
        }

        for (let i = 0; i < RATE_LIMIT_SCROLLS; i++) {
          await olderMessagesFor(ctx, ada, team, 1003)
        }
        const beforeRefusal = await ctx.db
          .query('chatBudget')
          .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
          .unique()

        await expect(olderMessagesFor(ctx, ada, team, 1003)).rejects.toMatchObject({
          data: { code: 'SCROLL_RATE_LIMITED' },
        })

        const afterRefusal = await ctx.db
          .query('chatBudget')
          .withIndex('by_month', (q) => q.eq('month', budgetMonthFor(Date.now())))
          .unique()
        expect(afterRefusal?.estimatedBytes).toBe(beforeRefusal?.estimatedBytes)
      })
    })

    // Per player PER TEAM, same shape as the send limit — one chatty scroller
    // must not silence a teammate, and being throttled in one team must not
    // reach into another.
    test('does not let one player\'s scroll limit block a teammate or another team', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const ada = await ctx.db.insert('players', aPlayer())
        const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
        const noisy = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
        const quiet = await ctx.db.insert('teams', aTeam({ legacyId: 903, name: 'Quiet', playerIds: [ada], owner: ada }))
        await ctx.db.insert('chatMessages', { teamId: noisy, playerId: ada, body: 'm', createdAt: 1000 })
        await ctx.db.insert('chatMessages', { teamId: quiet, playerId: ada, body: 'm', createdAt: 1000 })

        for (let i = 0; i < RATE_LIMIT_SCROLLS; i++) {
          await olderMessagesFor(ctx, ada, noisy, 1001)
        }
        await expect(olderMessagesFor(ctx, ada, noisy, 1001)).rejects.toMatchObject({
          data: { code: 'SCROLL_RATE_LIMITED' },
        })

        await expect(olderMessagesFor(ctx, bob, noisy, 1001)).resolves.toBeDefined()
        await expect(olderMessagesFor(ctx, ada, quiet, 1001)).resolves.toBeDefined()
      })
    })

    // MEMBERSHIP BEFORE THE RATE CHECK, not after — a non-member must not be
    // able to tell the difference between "not a member" and "rate limited"
    // by spamming this call, and must not be able to spend anyone's window.
    test('still refuses a non-member outright, before the rate limit is even consulted', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const ada = await ctx.db.insert('players', aPlayer())
        const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
        const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
        await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: 'private', createdAt: 1000 })

        await expect(olderMessagesFor(ctx, mallory, team, 2000)).rejects.toMatchObject({
          data: { code: 'NOT_A_MEMBER' },
        })

        const budget = await ctx.db.query('chatBudget').collect()
        expect(budget).toEqual([])
      })
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

describe('markReadFor', () => {
  test("advances an existing cursor's lastReadAt", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const cursorId = await ctx.db.insert('chatReads', { playerId: ada, teamId: team, lastReadAt: 1000 })

      await markReadFor(ctx, ada, team)

      const cursor = await ctx.db.get(cursorId)
      expect(cursor?.lastReadAt).toBeGreaterThan(1000)
    })
  })

  test('creates a cursor when none exists', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await markReadFor(ctx, ada, team)

      const cursor = await ctx.db
        .query('chatReads')
        .withIndex('by_player_team', (q) => q.eq('playerId', ada).eq('teamId', team))
        .unique()
      expect(cursor).not.toBeNull()
      expect(cursor?.lastReadAt).toBeGreaterThan(0)
    })
  })

  test('refuses a non-member with NOT_A_MEMBER', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await expect(markReadFor(ctx, mallory, team)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  // THE ACTUAL RISK IN SHARING upsertReadCursor BETWEEN sendMessageFor AND
  // markReadFor: markReadFor must patch ONLY `lastReadAt`, never the
  // rate-limit window (postWindowStartedAt/postsInWindow) — those two fields
  // live on the exact same `chatReads` row sendMessageFor writes them to.
  // Get the shared helper wrong (e.g. widen markReadFor's fields, or swap
  // `ctx.db.patch`'s merge semantics for a replace) and opening a
  // conversation would silently reset a player's rate limit on every read.
  test("leaves the rate-limit window alone", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'one')
      await sendMessageFor(ctx, ada, team, 'two')
      await sendMessageFor(ctx, ada, team, 'three')

      await markReadFor(ctx, ada, team)

      const cursor = await ctx.db
        .query('chatReads')
        .withIndex('by_player_team', (q) => q.eq('playerId', ada).eq('teamId', team))
        .unique()
      expect(cursor?.postsInWindow).toBe(3)
      expect(cursor?.postWindowStartedAt).toBeDefined()
    })
  })

  // THE SAME HAZARD, THE OTHER PAIR OF FIELDS. All three writers patch the one
  // chatReads row with disjoint field sets, so a merge cannot zero the others —
  // but only the post window was pinned by a test. A future change widening
  // sendMessageFor's or markReadFor's field set would silently reset a player's
  // SCROLL limit every time they posted or opened a conversation, and nothing
  // would have caught it. Covers scroll-vs-send and scroll-vs-markRead at once.
  test('leaves the scroll window alone, and the post window with it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      for (let i = 0; i < 4; i++) {
        await ctx.db.insert('chatMessages', { teamId: team, playerId: ada, body: `m${i}`, createdAt: 1000 + i })
      }

      await olderMessagesFor(ctx, ada, team, 1003)
      await olderMessagesFor(ctx, ada, team, 1002)
      await sendMessageFor(ctx, ada, team, 'a post between scrolls')
      await markReadFor(ctx, ada, team)

      const cursor = await ctx.db
        .query('chatReads')
        .withIndex('by_player_team', (q) => q.eq('playerId', ada).eq('teamId', team))
        .unique()
      expect(cursor?.scrollsInWindow).toBe(2)
      expect(cursor?.scrollWindowStartedAt).toBeDefined()
      expect(cursor?.postsInWindow).toBe(1)
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

  // THE SECOND ENTRY POINT. cascadeDeleteTeam has two callers, and the four
  // tests above all reach it through deleteTeamFor. leaveTeamFor calls it too,
  // on its empty-roster branch — the last member leaves and the team goes with
  // them. That path is likelier in practice than a deliberate delete, and
  // nothing was covering it for chat.
  //
  // The team is owner-less (as in teams.test.ts's own empty-roster cascade
  // test): an owner ON THE ROSTER cannot leave (OWNER_NOT_REMOVABLE) and so
  // could never empty a team by leaving it, which would make this branch
  // unreachable with the obvious owned-team fixture.
  test('cascades chat when the last member leaves and the team goes with them', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: undefined }))
      await sendMessageFor(ctx, ada, team, 'last one out')

      await leaveTeamFor(ctx, ada, { teamId: team, today })

      expect(await ctx.db.get(team)).toBeNull()
      expect(await ctx.db.query('chatMessages').collect()).toEqual([])
      expect(await ctx.db.query('chatMeta').collect()).toEqual([])
      expect(await ctx.db.query('chatReads').collect()).toEqual([])
    })
  })
})

describe('the public surface', () => {
  // NOT `{ code: 'UNAUTHENTICATED' }`, even though that is an AccessCode and
  // access.ts's requirePlayer has a line that throws it. Verified empirically:
  // requirePlayer calls `authComponent.getAuthUser(ctx)` (the THROWING variant
  // the Better Auth component client exports, not `safeGetAuthUser`), and for
  // a caller with no identity at all that call throws `ConvexError` with a
  // bare STRING payload, `'Unauthenticated'`, the moment
  // `ctx.auth.getUserIdentity()` resolves to null — before requirePlayer's own
  // `if (!user?.email) throw accessError('UNAUTHENTICATED')` line ever runs.
  // That line is reachable only if getAuthUser resolved to a user record with
  // a falsy email, which no code path here produces. This is not particular
  // to chat.ts: the identical shape comes back from every other authed
  // wrapper in this codebase (checked against `teams.createTeam`), so it is a
  // property of `requirePlayer`/Better Auth, not a bug introduced here.
  test('refuses an unauthenticated caller', async () => {
    const t = convexTest(schema, modules)
    const teamId = await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      return await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
    })

    await expect(t.query(api.chat.pointer, { teamId })).rejects.toMatchObject({
      data: 'Unauthenticated',
    })
    await expect(t.mutation(api.chat.send, { teamId, body: 'hello' })).rejects.toMatchObject({
      data: 'Unauthenticated',
    })
    // olderMessages is a MUTATION, not a query — called with t.mutation here
    // for exactly that reason. It still goes through requirePlayer first,
    // same as every other wrapper in this file.
    await expect(t.mutation(api.chat.olderMessages, { teamId, before: Date.now() })).rejects.toMatchObject({
      data: 'Unauthenticated',
    })
  })

  // A GENUINE AUTHENTICATED CALLER, THROUGH `t.withIdentity`, IS ACHIEVABLE —
  // an earlier version of this comment claimed it was not, citing
  // `wordle-teams-obw` ("convex-test cannot stand up a Better Auth session")
  // and reasoning that it would need `@convex-dev/better-auth`'s internal,
  // unpublished `dist/component/**` files. That was wrong: the package
  // exports a first-class test entry point built for exactly this. See
  // `authenticatedAs`'s doc comment in fixtures.ts for the mechanism (and its
  // one real caveat: it relies on an `_id`-equality lookup that is an
  // implementation detail, not a documented contract, of the pinned
  // `@convex-dev/better-auth` version).
  test('refuses an authenticated caller who is not on the team, with NOT_A_MEMBER', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)

    const teamId = await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      // The outsider has a real `players` row (unlike the NO_PLAYER test
      // below) — just not one this team's `playerIds` includes.
      await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '22222222-2222-4222-8222-222222222222',
          email: 'outsider@example.com',
        }),
      )
      return await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
    })

    const asOutsider = await authenticatedAs(t, 'outsider@example.com')

    await expect(asOutsider.query(api.chat.pointer, { teamId })).rejects.toMatchObject({
      data: { code: 'NOT_A_MEMBER' },
    })
    await expect(asOutsider.mutation(api.chat.send, { teamId, body: 'hi' })).rejects.toMatchObject({
      data: { code: 'NOT_A_MEMBER' },
    })
    await expect(
      asOutsider.mutation(api.chat.olderMessages, { teamId, before: Date.now() }),
    ).rejects.toMatchObject({
      data: { code: 'NOT_A_MEMBER' },
    })
  })

  // THE OTHER HALF OF `requirePlayer`: a session and user genuinely exist
  // (Better Auth is satisfied), but no `players` row matches that email — the
  // shape a copied v1 account never reaches, and a brand-new signup does until
  // `completeProfileFor` runs. Falls out of the same `authenticatedAs` helper
  // for free: skip inserting a `players` row for the email at all.
  test('refuses an authenticated caller with no player row, with NO_PLAYER', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)

    const teamId = await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      return await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
    })

    const asStranger = await authenticatedAs(t, 'stranger@example.com')

    await expect(asStranger.query(api.chat.pointer, { teamId })).rejects.toMatchObject({
      data: { code: 'NO_PLAYER' },
    })
    await expect(asStranger.mutation(api.chat.send, { teamId, body: 'hi' })).rejects.toMatchObject({
      data: { code: 'NO_PLAYER' },
    })
    await expect(
      asStranger.mutation(api.chat.olderMessages, { teamId, before: Date.now() }),
    ).rejects.toMatchObject({
      data: { code: 'NO_PLAYER' },
    })
  })
})


describe('unreadTeamsFor', () => {
  test('reports a team unread when a teammate has posted since we last read', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await sendMessageFor(ctx, bob, team, 'hello ada')

      expect(await unreadTeamsFor(ctx, ada)).toEqual([team])
    })
  })

  // Sending advances your own cursor, so your own message is never unread.
  test('does not report your own message as unread', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'mine')

      expect(await unreadTeamsFor(ctx, ada)).toEqual([])
    })
  })

  test('clears once the conversation is marked read', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await sendMessageFor(ctx, bob, team, 'hello')

      await markReadFor(ctx, ada, team)

      expect(await unreadTeamsFor(ctx, ada)).toEqual([])
    })
  })

  test('never reports a team the caller is not on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const mallory = await ctx.db.insert('players', aPlayer({ email: 'mallory@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await sendMessageFor(ctx, ada, team, 'private')

      expect(await unreadTeamsFor(ctx, mallory)).toEqual([])
    })
  })
})

describe('rejoining a team', () => {
  // qix.11. Their cursor survived them leaving, so without a reset they would
  // rejoin already "caught up" on everything said while they were gone.
  test('a rejoining member sees messages sent while they were away as unread', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const gone = await ctx.db.insert('players', aPlayer({ email: 'gone@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, gone], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'before they left')
      await markReadFor(ctx, gone, team)
      await ctx.db.patch(team, { playerIds: [ada] })          // they leave

      await sendMessageFor(ctx, ada, team, 'while they were away')

      await resetChatCursorFor(ctx, gone, team)                // they rejoin
      await ctx.db.patch(team, { playerIds: [ada, gone] })

      expect(await unreadTeamsFor(ctx, gone)).toEqual([team])
    })
  })

  // THE TEST ABOVE CALLS THE HELPER DIRECTLY AND SO PROVES NOTHING ABOUT THE
  // CALL SITES. These two are the ones that fail if either wiring is dropped —
  // one per add-member path — because the whole point of the fix is that BOTH
  // paths get it and a fix on one looks done while being half absent.
  test('re-inviting a departed member resets their cursor', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const gone = await ctx.db.insert('players', aPlayer({ email: 'gone@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, gone], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'before they left')
      await markReadFor(ctx, gone, team)
      await leaveTeamFor(ctx, gone, { teamId: team, today })

      await sendMessageFor(ctx, ada, team, 'while they were away')
      await invitePlayerFor(ctx, ada, { teamId: team, email: 'gone@example.com', today })

      expect((await ctx.db.get(team))!.playerIds).toContain(gone)
      expect(await unreadTeamsFor(ctx, gone)).toEqual([team])
    })
  })

  test('releasing a parked invite on upgrade resets the rejoiner cursor', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const gone = await ctx.db.insert('players', aPlayer({ email: 'gone@example.com' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [ada, gone], owner: ada }))

      await sendMessageFor(ctx, ada, team, 'before they left')
      await markReadFor(ctx, gone, team)
      // They leave, and are later re-invited while still capped, which parks the
      // address rather than joining them. The upgrade is what lets them back in.
      await leaveTeamFor(ctx, gone, { teamId: team, today })
      await ctx.db.patch(team, { invited: ['gone@example.com'] })

      await sendMessageFor(ctx, ada, team, 'while they were away')
      await upgradeTeamInvitesFor(ctx, gone)

      expect((await ctx.db.get(team))!.playerIds).toContain(gone)
      expect(await unreadTeamsFor(ctx, gone)).toEqual([team])
    })
  })

  // The other half of that branch. A team can list the same person in BOTH
  // playerIds and `invited` — that is exactly what the v1 copy brings over — and
  // the upgrade then visits it only to clear the stale address. Nobody joins
  // anything, so wiping the cursor would mark a conversation they have been
  // reading all along unread.
  test('an upgrade does not reset the cursor of someone already on the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const stays = await ctx.db.insert('players', aPlayer({ email: 'stays@example.com' }))
      const team = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, stays], owner: ada, invited: ['stays@example.com'] }),
      )

      await sendMessageFor(ctx, ada, team, 'hello')
      await markReadFor(ctx, stays, team)

      await upgradeTeamInvitesFor(ctx, stays)

      expect((await ctx.db.get(team))!.invited).toEqual([])
      expect(await unreadTeamsFor(ctx, stays)).toEqual([])
    })
  })
})
