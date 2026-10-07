import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import type { MutationCtx } from './_generated/server'
import { aPlayer } from './fixtures.ts'
import { seedLeagueFor, standingsFor, leaguesFor, STARTING_WORDS } from './leagues.ts'
import type { DataModel, Id } from './_generated/dataModel'
import type { GenericDatabaseWriter } from 'convex/server'

/**
 * DRIVEN THROUGH ctx.db AND THE …For HANDLERS, never the public wrappers, which
 * need a Better Auth session the harness cannot mint (wordle-teams-obw).
 */
const modules = import.meta.glob('./**/*.ts')

describe('league tables', () => {
  test('accept the documents the handlers write', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const leagueId = await ctx.db.insert('leagues', {
        slug: 'starting-words',
        name: 'Starting Words',
        featured: true,
        createdAt: 0,
      })
      const groupId = await ctx.db.insert('leagueGroups', {
        leagueId,
        slug: 'crane',
        name: 'CRANE',
        order: 0,
        memberCount: 0,
      })
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId, fromDay: '2026-10-08' })
      await ctx.db.insert('leagueMemberMonth', { playerId, leagueId, groupId, year: 2026, month: 10, boards: 1, attempts: 4 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId, year: 2026, month: 10, boards: 1, attempts: 4, contributors: 1 })
      await ctx.db.insert('leagueMonthResults', {
        leagueId,
        year: 2026,
        month: 9,
        standings: [{ groupId, boards: 0, attempts: 0, average: null, contributors: 0 }],
        winnerGroupId: null,
        closedAt: 0,
      })
      expect(await ctx.db.query('leagueMonthResults').collect()).toHaveLength(1)
    })
  })

  // convex-test validates DECLARED tables and skips undeclared ones, so these
  // reject only while the tables are declared with these shapes.
  const seedLeague = async (ctx: MutationCtx) => {
    const playerId = await ctx.db.insert('players', aPlayer())
    const leagueId = await ctx.db.insert('leagues', { slug: 's', name: 'S', featured: true, createdAt: 0 })
    const groupId = await ctx.db.insert('leagueGroups', { leagueId, slug: 'c', name: 'C', order: 0, memberCount: 0 })
    return { playerId, leagueId, groupId }
  }

  test('leagueMemberships rejects a document without groupId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, leagueId } = await seedLeague(ctx)
      await expect(
        ctx.db.insert('leagueMemberships', { playerId, leagueId, fromDay: '2026-10-08' } as never),
      ).rejects.toThrow(/groupId/)
    })
  })

  test('leagueMonthResults rejects a string average', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, groupId } = await seedLeague(ctx)
      await expect(
        ctx.db.insert('leagueMonthResults', {
          leagueId,
          year: 2026,
          month: 9,
          standings: [{ groupId, boards: 0, attempts: 0, average: '4.0', contributors: 0 }],
          winnerGroupId: null,
          closedAt: 0,
        } as never),
      ).rejects.toThrow(/Expected one of number, null/)
    })
  })

  test('leagueMonthResults rejects an omitted winnerGroupId (null, not absent)', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedLeague(ctx)
      await expect(
        ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 9, standings: [], closedAt: 0 } as never),
      ).rejects.toThrow(/winnerGroupId/)
    })
  })
})

type Ctx = { db: GenericDatabaseWriter<DataModel> }

/** Seeds Starting Words and returns its id and its groups by slug. */
async function seedStartingWords(ctx: Ctx, createdAt = 0) {
  const leagueId = await seedLeagueFor(ctx, STARTING_WORDS, createdAt)
  const groups = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
  const bySlug = Object.fromEntries(groups.map((g) => [g.slug, g._id])) as Record<string, Id<'leagueGroups'>>
  return { leagueId, group: bySlug }
}

describe('seedLeagueFor', () => {
  test('creates Starting Words with its five groups in order', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      const groups = await ctx.db.query('leagueGroups').withIndex('by_league', (q) => q.eq('leagueId', leagueId)).collect()
      expect(groups.sort((a, b) => a.order - b.order).map((g) => g.name)).toEqual(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])
      expect(groups.every((g) => g.memberCount === 0)).toBe(true)
    })
  })
  test('is idempotent: a second run adds nothing and keeps createdAt', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const first = await seedLeagueFor(ctx, STARTING_WORDS, 100)
      const second = await seedLeagueFor(ctx, STARTING_WORDS, 999)
      expect(second).toBe(first)
      expect(await ctx.db.query('leagues').collect()).toHaveLength(1)
      expect(await ctx.db.query('leagueGroups').collect()).toHaveLength(5)
      expect((await ctx.db.get(first))!.createdAt).toBe(100)
    })
  })
})

describe('standingsFor', () => {
  test('null for an unknown slug', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      expect(await standingsFor(ctx, 'nope', '2026-10-07')).toBeNull()
    })
  })
  test('every group appears, zero-filled, unranked below the floor', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 10, boards: 10, attempts: 38, contributors: 2 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 10, boards: 6, attempts: 24, contributors: 1 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      expect(out.month).toBe('2026-10')
      expect(out.standings.map((s) => [s.groupId, s.rank, s.average, s.boards])).toEqual([
        [group.crane, 1, 3.8, 10],
        [group.slate, null, null, 6],
        [group.adieu, null, null, 0],
        [group.stare, null, null, 0],
        [group.orate, null, null, 0],
      ])
      expect(out.lastMonth).toBeNull()
    })
  })
  test('last month and the all-time tally come from snapshots, never live rows', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 8, standings: [], winnerGroupId: group.crane, closedAt: 0 })
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 9, standings: [], winnerGroupId: group.crane, closedAt: 0 })
      // A live September row that disagrees must be ignored.
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 9, boards: 50, attempts: 100, contributors: 3 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      expect(out.lastMonth).toEqual({ month: '2026-09', winnerGroupId: group.crane })
      expect(out.monthsWon.find((m) => m.groupId === group.crane)?.count).toBe(2)
      expect(out.monthsWon.find((m) => m.groupId === group.slate)?.count).toBe(0)
    })
  })
})

describe('leaguesFor', () => {
  test('lists leagues with their groups', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      const out = await leaguesFor(ctx)
      expect(out).toHaveLength(1)
      expect(out[0]).toMatchObject({ slug: 'starting-words', name: 'Starting Words', featured: true })
      expect(out[0].groups.map((g) => g.name)).toEqual(['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'])
    })
  })
})
