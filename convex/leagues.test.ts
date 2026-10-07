import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import type { MutationCtx } from './_generated/server'
import { aPlayer } from './fixtures.ts'
import { upsertBoardFor } from './scores.ts'
import { groupsOf, joinGroupFor, leaguesFor, leaveLeagueFor, readToday, recomputeLeagueMonthFor, seedLeagueFor, standingsFor, STARTING_WORDS, switchGroupFor } from './leagues.ts'
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
      // A row for another month must stay out of October's totals.
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.adieu, year: 2026, month: 9, boards: 30, attempts: 90, contributors: 4 })
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

describe('readToday', () => {
  afterEach(() => vi.useRealTimers())
  test('passes a plausible day through and falls back to the server day otherwise', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
    expect(readToday('2026-10-07')).toBe('2026-10-07')
    expect(readToday('2026-10-08')).toBe('2026-10-08')
    expect(readToday('2026-10-12')).toBe('2026-10-07')
    expect(readToday('2026-10-02')).toBe('2026-10-07')
    expect(readToday('garbage')).toBe('2026-10-07')
  })
})

describe('standingsFor snapshots and isolation', () => {
  test('a September snapshot with no winner is lastMonth with a null winner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 9, standings: [], winnerGroupId: null, closedAt: 0 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      expect(out.lastMonth).toEqual({ month: '2026-09', winnerGroupId: null })
    })
  })
  test('January looks back to December of the previous year', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 12, standings: [], winnerGroupId: group.crane, closedAt: 0 })
      const out = (await standingsFor(ctx, 'starting-words', '2027-01-05'))!
      expect(out.month).toBe('2027-01')
      expect(out.lastMonth).toEqual({ month: '2026-12', winnerGroupId: group.crane })
    })
  })
  test('another league never leaks into standings or monthsWon', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group } = await seedStartingWords(ctx)
      const otherId = await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'x', name: 'X' }] }, 0)
      const [x] = await groupsOf(ctx, otherId)
      await ctx.db.insert('leagueGroupMonth', { leagueId: otherId, groupId: x._id, year: 2026, month: 10, boards: 40, attempts: 120, contributors: 5 })
      await ctx.db.insert('leagueMonthResults', { leagueId: otherId, year: 2026, month: 9, standings: [], winnerGroupId: x._id, closedAt: 0 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      expect(out.standings).toHaveLength(5)
      expect(out.standings.every((s) => s.boards === 0)).toBe(true)
      expect(out.lastMonth).toBeNull()
      expect(out.monthsWon.every((m) => m.count === 0)).toBe(true)
      expect(out.monthsWon.map((m) => m.groupId)).toContain(group.crane)
    })
  })
})

describe('seeding edges', () => {
  test('a re-seed renames and reorders groups, never removing one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await seedLeagueFor(ctx, STARTING_WORDS, 0)
      await seedLeagueFor(ctx, {
        ...STARTING_WORDS,
        name: 'Openers',
        groups: [
          { slug: 'slate', name: 'Slate!' },
          { slug: 'crane', name: 'Crane!' },
        ],
      }, 5)
      expect((await ctx.db.get(id))!.name).toBe('Openers')
      const groups = await groupsOf(ctx, id)
      expect(groups.map((g) => [g.slug, g.name, g.order])).toEqual([
        ['slate', 'Slate!', 0],
        ['crane', 'Crane!', 1],
        ['adieu', 'ADIEU', 2],
        ['stare', 'STARE', 3],
        ['orate', 'ORATE', 4],
      ])
    })
  })
  test('groupsOf sorts by order, not insertion', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const leagueId = await ctx.db.insert('leagues', { slug: 'l', name: 'L', featured: false, createdAt: 0 })
      for (const [slug, order] of [['c', 2], ['a', 0], ['b', 1]] as const) {
        await ctx.db.insert('leagueGroups', { leagueId, slug, name: slug, order, memberCount: 0 })
      }
      expect((await groupsOf(ctx, leagueId)).map((g) => g.slug)).toEqual(['a', 'b', 'c'])
    })
  })
})

/**
 * FROZEN CLOCK: requirePlausibleToday bounds `today` to +-1 day of the server's,
 * so a literal date would start failing on its own with INVALID_DATE.
 */
const NOW = new Date('2026-10-07T12:00:00Z')
const today = '2026-10-07'

describe('membership', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p
      return null
    } catch (error) {
      return (error as { data?: { code?: string } }).data?.code ?? String(error)
    }
  }

  test('join opens an interval from tomorrow and counts the member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinGroupFor(ctx, playerId, { groupId: group.crane, today })
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows).toEqual([expect.objectContaining({ playerId, leagueId, groupId: group.crane, fromDay: '2026-10-08' })])
      expect(rows[0].toDay).toBeUndefined()
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(1)
    })
  })

  test('a second join is refused ALREADY_IN_LEAGUE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinGroupFor(ctx, playerId, { groupId: group.crane, today })
      expect(await codeOf(joinGroupFor(ctx, playerId, { groupId: group.slate, today }))).toBe('ALREADY_IN_LEAGUE')
      expect((await ctx.db.get(group.slate))!.memberCount).toBe(0)
    })
  })

  test('switch from a started interval closes at month end and moves the count', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await ctx.db.patch(group.crane, { memberCount: 1 })
      await switchGroupFor(ctx, playerId, { groupId: group.slate, today })
      const rows = (await ctx.db.query('leagueMemberships').collect()).sort((a, b) => a.fromDay.localeCompare(b.fromDay))
      expect(rows.map((r) => [r.groupId, r.fromDay, r.toDay])).toEqual([
        [group.crane, '2026-09-01', '2026-10-31'],
        [group.slate, '2026-11-01', undefined],
      ])
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(0)
      expect((await ctx.db.get(group.slate))!.memberCount).toBe(1)
    })
  })

  test('switching back cancels the pending switch', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await ctx.db.patch(group.crane, { memberCount: 1 })
      await switchGroupFor(ctx, playerId, { groupId: group.slate, today })
      await switchGroupFor(ctx, playerId, { groupId: group.crane, today })
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows.map((r) => [r.groupId, r.toDay])).toEqual([[group.crane, undefined]])
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(1)
      expect((await ctx.db.get(group.slate))!.memberCount).toBe(0)
    })
  })

  test('switch to a group from another league is refused NOT_IN_LEAGUE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const other = await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'x', name: 'X' }] }, 0)
      const [x] = await groupsOf(ctx, other)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      // x belongs to `other`, where this player has no membership: NOT_IN_LEAGUE.
      expect(await codeOf(switchGroupFor(ctx, playerId, { groupId: x._id, today }))).toBe('NOT_IN_LEAGUE')
    })
  })

  test('leave ends today, and a pending-only membership is deleted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const a = await ctx.db.insert('players', aPlayer({ email: 'a@example.com' }))
      const b = await ctx.db.insert('players', aPlayer({ email: 'b@example.com' }))
      await ctx.db.insert('leagueMemberships', { playerId: a, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await joinGroupFor(ctx, b, { groupId: group.crane, today })
      await ctx.db.patch(group.crane, { memberCount: 2 })
      await leaveLeagueFor(ctx, a, { leagueId, today })
      await leaveLeagueFor(ctx, b, { leagueId, today })
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows.map((r) => [r.playerId, r.toDay])).toEqual([[a, today]])
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(0)
    })
  })

  test('leave mid-month then rejoin the same group the same day opens tomorrow and ends at one member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await ctx.db.patch(group.crane, { memberCount: 1 })
      await leaveLeagueFor(ctx, playerId, { leagueId, today })
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(0)
      await joinGroupFor(ctx, playerId, { groupId: group.crane, today })
      const rows = (await ctx.db.query('leagueMemberships').collect()).sort((x, y) => x.fromDay.localeCompare(y.fromDay))
      expect(rows.map((r) => [r.groupId, r.fromDay, r.toDay])).toEqual([
        [group.crane, '2026-09-01', today],
        [group.crane, '2026-10-08', undefined],
      ])
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(1)
    })
  })

  test('a pending-only switch retargets the pending row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinGroupFor(ctx, playerId, { groupId: group.crane, today })
      await switchGroupFor(ctx, playerId, { groupId: group.slate, today })
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows.map((r) => [r.groupId, r.fromDay, r.toDay])).toEqual([[group.slate, '2026-10-08', undefined]])
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(0)
      expect((await ctx.db.get(group.slate))!.memberCount).toBe(1)
    })
  })

  test('a pending-only switch that changes the opening day deletes and re-inserts', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-10-01', toDay: '2026-10-05' })
      await joinGroupFor(ctx, playerId, { groupId: group.slate, today })
      expect((await ctx.db.query('leagueMemberships').collect()).map((r) => r.fromDay).sort()).toEqual(['2026-10-01', '2026-11-01'])
      await switchGroupFor(ctx, playerId, { groupId: group.crane, today })
      const rows = (await ctx.db.query('leagueMemberships').collect()).sort((a, b) => a.fromDay.localeCompare(b.fromDay))
      expect(rows.map((r) => [r.groupId, r.fromDay, r.toDay])).toEqual([
        [group.crane, '2026-10-01', '2026-10-05'],
        [group.crane, '2026-10-08', undefined],
      ])
      expect((await ctx.db.get(group.slate))!.memberCount).toBe(0)
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(1)
    })
  })

  test('leave with a started and a pending interval ends the first and deletes the second', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await ctx.db.patch(group.crane, { memberCount: 1 })
      await switchGroupFor(ctx, playerId, { groupId: group.slate, today })
      await leaveLeagueFor(ctx, playerId, { leagueId, today })
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows.map((r) => [r.groupId, r.toDay])).toEqual([[group.crane, today]])
      expect((await ctx.db.get(group.slate))!.memberCount).toBe(0)
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(0)
    })
  })

  test('a deleted group is refused UNKNOWN_GROUP', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.delete(group.crane)
      expect(await codeOf(joinGroupFor(ctx, playerId, { groupId: group.crane, today }))).toBe('UNKNOWN_GROUP')
    })
  })

  test('a deleted league is refused UNKNOWN_LEAGUE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const gone = await ctx.db.insert('leagues', { slug: 'gone', name: 'Gone', featured: false, createdAt: 0 })
      await ctx.db.delete(gone)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await codeOf(leaveLeagueFor(ctx, playerId, { leagueId: gone, today }))).toBe('UNKNOWN_LEAGUE')
    })
  })

  test('leave when not a member is refused NOT_IN_LEAGUE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await codeOf(leaveLeagueFor(ctx, playerId, { leagueId, today }))).toBe('NOT_IN_LEAGUE')
    })
  })

  test('an implausible today is refused INVALID_DATE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await codeOf(joinGroupFor(ctx, playerId, { groupId: group.crane, today: '2026-01-01' }))).toBe('INVALID_DATE')
    })
  })
})

/** A solved board in `n` guesses on `day`. */
async function board(ctx: Ctx, playerId: Id<'players'>, day: string, n: number) {
  const guesses = [...Array(n - 1).fill('wrong'), 'crane']
  await ctx.db.insert('dailyScores', { playerId, puzzleDay: day, date: 0, answer: 'crane', guesses })
}

/** INVARIANT: every group-month row equals the sum of its member rows. */
async function expectGroupRowsAreSums(ctx: Ctx) {
  const members = await ctx.db.query('leagueMemberMonth').collect()
  for (const row of await ctx.db.query('leagueGroupMonth').collect()) {
    const mine = members.filter((m) => m.groupId === row.groupId && m.year === row.year && m.month === row.month)
    expect({ boards: row.boards, attempts: row.attempts, contributors: row.contributors }).toEqual({
      boards: mine.reduce((s, m) => s + m.boards, 0),
      attempts: mine.reduce((s, m) => s + m.attempts, 0),
      contributors: mine.length,
    })
  }
}

describe('recomputeLeagueMonthFor', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  test('a non-member costs nothing and writes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await board(ctx, playerId, '2026-10-05', 3)
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      expect(await ctx.db.query('leagueMemberMonth').collect()).toEqual([])
      expect(await ctx.db.query('leagueGroupMonth').collect()).toEqual([])
    })
  })

  test('only boards inside the interval count, and the group row follows', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-10-03' })
      await board(ctx, playerId, '2026-10-02', 2) // before joining: never counts
      await board(ctx, playerId, '2026-10-03', 4)
      await board(ctx, playerId, '2026-10-05', 3)
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      const [row] = await ctx.db.query('leagueGroupMonth').collect()
      expect(row).toMatchObject({ groupId: group.crane, year: 2026, month: 10, boards: 2, attempts: 7, contributors: 1 })
      await expectGroupRowsAreSums(ctx)
    })
  })

  test('two members, edits and a delete keep the invariant', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const a = await ctx.db.insert('players', aPlayer({ email: 'a@example.com' }))
      const b = await ctx.db.insert('players', aPlayer({ email: 'b@example.com' }))
      for (const p of [a, b]) await ctx.db.insert('leagueMemberships', { playerId: p, leagueId, groupId: group.crane, fromDay: '2026-10-01' })
      await board(ctx, a, '2026-10-02', 3)
      await board(ctx, b, '2026-10-02', 5)
      await recomputeLeagueMonthFor(ctx, a, '2026-10')
      await recomputeLeagueMonthFor(ctx, b, '2026-10')
      await expectGroupRowsAreSums(ctx)

      const [aBoard] = await ctx.db.query('dailyScores').withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', a)).collect()
      await ctx.db.patch(aBoard._id, { guesses: ['wrong', 'crane'] })
      await recomputeLeagueMonthFor(ctx, a, '2026-10')
      await expectGroupRowsAreSums(ctx)

      await ctx.db.delete(aBoard._id)
      await recomputeLeagueMonthFor(ctx, a, '2026-10')
      await expectGroupRowsAreSums(ctx)
      const [row] = await ctx.db.query('leagueGroupMonth').collect()
      expect(row).toMatchObject({ boards: 1, attempts: 5, contributors: 1 })
    })
  })

  test('a failed board counts as 7', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-10-01' })
      await ctx.db.insert('dailyScores', { playerId, puzzleDay: '2026-10-02', date: 0, answer: 'crane', guesses: Array(6).fill('wrong') })
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      expect((await ctx.db.query('leagueMemberMonth').collect())[0]).toMatchObject({ boards: 1, attempts: 7 })
    })
  })

  test('unchanged totals write NOTHING (no insert, patch or delete)', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-10-01' })
      await board(ctx, playerId, '2026-10-02', 3)
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      // An identical write is indistinguishable from none in the stored rows
      // (convex-test has no _updatedTime), so watch the write calls themselves.
      const writes = [vi.spyOn(ctx.db, 'insert'), vi.spyOn(ctx.db, 'patch'), vi.spyOn(ctx.db, 'delete')]
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      for (const w of writes) expect(w).not.toHaveBeenCalled()
      // ...and it is not vacuous: a real change does write.
      await board(ctx, playerId, '2026-10-04', 4)
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      expect(writes.some((w) => w.mock.calls.length > 0)).toBe(true)
      await expectGroupRowsAreSums(ctx)
    })
  })

  test('a member who leaves today keeps the boards already counted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-10-01' })
      await board(ctx, playerId, '2026-10-03', 4)
      await board(ctx, playerId, '2026-10-06', 2)
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      await leaveLeagueFor(ctx, playerId, { leagueId, today })
      const [row] = await ctx.db.query('leagueGroupMonth').collect()
      expect(row).toMatchObject({ groupId: group.crane, boards: 2, attempts: 6, contributors: 1 })
      await expectGroupRowsAreSums(ctx)
    })
  })

  test('upsertBoardFor drives it: a member submitting a board moves their group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.slate, fromDay: '2026-10-01' })
      await upsertBoardFor(ctx, playerId, {
        puzzleDay: today,
        answer: 'crane',
        guesses: ['slate', 'crane', '', '', '', ''],
        today,
      })
      expect((await ctx.db.query('leagueGroupMonth').collect())[0]).toMatchObject({ groupId: group.slate, boards: 1, attempts: 2 })
    })
  })
})
