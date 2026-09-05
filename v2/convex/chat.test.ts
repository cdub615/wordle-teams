import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'

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
