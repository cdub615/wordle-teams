import { readFileSync } from 'node:fs'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import type { MutationCtx } from './_generated/server'
import { api, internal } from './_generated/api'
import { insightsAccess } from './lib/insightsAccess.ts'
import { contributionUnlocked } from './lib/league.ts'
import { aPlayer, authenticatedAs, makeRegisterBetterAuth } from './fixtures.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'
import { upsertBoardFor } from './scores.ts'
import { closeLeagueMonthFor, dismissLeagueOfferFor, groupStandingFor, groupsOf, joinGroupFor, joinWordFor, leaguesFor, leaveLeagueFor, myContributionFor, myLeaguesFor, readToday, recomputeLeagueMonthFor, scheduleLeagueClosesFor, seedLeagueFor, standingsFor, STARTING_WORDS, switchGroupFor, switchWordFor } from './leagues.ts'
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

/**
 * The same five openers as a FIXED league (no groupSource). Starting Words is a
 * word league since v2a, so it takes the large-league path (spec v2 §4.5); the
 * small-league standings tests below pin the v1 shape on this instead.
 */
async function seedFixedOpeners(ctx: Ctx) {
  const leagueId = await seedLeagueFor(ctx, { ...STARTING_WORDS, groupSource: undefined }, 0)
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
  test('a fresh seed writes groupSource answer-words', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await seedLeagueFor(ctx, STARTING_WORDS, 100)
      expect((await ctx.db.get(id))!.groupSource).toBe('answer-words')
    })
  })
  test('a re-seed patches groupSource onto a league that lacked it, in place', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      // The dev deployment's state: seeded before groupSource existed.
      const legacy = await ctx.db.insert('leagues', { slug: 'starting-words', name: 'Starting Words', featured: true, createdAt: 50 })
      for (const [order, name] of ['CRANE', 'SLATE', 'ADIEU', 'STARE', 'ORATE'].entries()) {
        await ctx.db.insert('leagueGroups', { leagueId: legacy, slug: name.toLowerCase(), name, order, memberCount: 0 })
      }
      expect((await ctx.db.get(legacy))!.groupSource).toBeUndefined()
      const id = await seedLeagueFor(ctx, STARTING_WORDS, 999)
      expect(id).toBe(legacy)
      const row = (await ctx.db.get(legacy))!
      expect(row.groupSource).toBe('answer-words')
      expect(row.createdAt).toBe(50)
      expect(await ctx.db.query('leagueGroups').collect()).toHaveLength(5)
    })
  })
  test('a fresh seed of a spec without groupSource omits the field', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await seedLeagueFor(ctx, { slug: 'o', name: 'O', featured: false, groups: [] }, 0)
      expect((await ctx.db.get(id))!.groupSource).toBeUndefined()
    })
  })
  test('a re-seed with a spec lacking groupSource never downgrades a word league', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await seedLeagueFor(ctx, STARTING_WORDS, 0)
      await seedLeagueFor(ctx, { ...STARTING_WORDS, groupSource: undefined }, 1)
      expect((await ctx.db.get(id))!.groupSource).toBe('answer-words')
    })
  })
  test('the by_league_and_slug and by_league_and_memberCount indexes serve queries', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      await ctx.db.patch(group.stare, { memberCount: 3 })
      const bySlug = await ctx.db.query('leagueGroups').withIndex('by_league_and_slug', (q) => q.eq('leagueId', leagueId).eq('slug', 'slate')).unique()
      expect(bySlug?._id).toBe(group.slate)
      const byCount = await ctx.db.query('leagueGroups').withIndex('by_league_and_memberCount', (q) => q.eq('leagueId', leagueId)).order('desc').first()
      expect(byCount?._id).toBe(group.stare)
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
      const { leagueId, group } = await seedFixedOpeners(ctx)
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
      const { leagueId, group } = await seedFixedOpeners(ctx)
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
      const { leagueId } = await seedFixedOpeners(ctx)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 9, standings: [], winnerGroupId: null, closedAt: 0 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      expect(out.lastMonth).toEqual({ month: '2026-09', winnerGroupId: null })
    })
  })
  test('January looks back to December of the previous year', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedFixedOpeners(ctx)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 12, standings: [], winnerGroupId: group.crane, closedAt: 0 })
      const out = (await standingsFor(ctx, 'starting-words', '2027-01-05'))!
      expect(out.month).toBe('2027-01')
      expect(out.lastMonth).toEqual({ month: '2026-12', winnerGroupId: group.crane })
    })
  })
  test('another league never leaks into standings or monthsWon', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group } = await seedFixedOpeners(ctx)
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

  // T18 (spec §8.4): "ever joined" must survive planLeave DELETING a
  // not-yet-started membership, so a join stamps players.leagueJoinedAt.
  test('join stamps leagueJoinedAt ONCE: a rejoin after leaving keeps the first stamp', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinGroupFor(ctx, playerId, { groupId: group.crane, today })
      expect((await ctx.db.get(playerId))!.leagueJoinedAt).toBe(NOW.getTime())

      // An hour later: leave (deleting the pending row) and join again. A stamp
      // that moved would mean "first joined" was being overwritten.
      vi.setSystemTime(NOW.getTime() + 3_600_000)
      await leaveLeagueFor(ctx, playerId, { leagueId, today })
      expect(await ctx.db.query('leagueMemberships').collect()).toEqual([])
      await joinGroupFor(ctx, playerId, { groupId: group.slate, today })
      expect((await ctx.db.get(playerId))!.leagueJoinedAt).toBe(NOW.getTime())
    })
  })

  test('switch and leave never stamp leagueJoinedAt; a refused join does not either', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      // A member from before the field existed: a row, no stamp.
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await ctx.db.patch(group.crane, { memberCount: 1 })
      expect(await codeOf(joinGroupFor(ctx, playerId, { groupId: group.slate, today }))).toBe('ALREADY_IN_LEAGUE')
      await switchGroupFor(ctx, playerId, { groupId: group.slate, today })
      await leaveLeagueFor(ctx, playerId, { leagueId, today })
      expect((await ctx.db.get(playerId))!.leagueJoinedAt).toBeUndefined()
    })
  })

  test('dismissLeagueOfferFor stamps leagueOfferDismissedAt and is idempotent', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      expect((await ctx.db.get(playerId))!.leagueOfferDismissedAt).toBeUndefined()
      await dismissLeagueOfferFor(ctx, playerId)
      expect((await ctx.db.get(playerId))!.leagueOfferDismissedAt).toBe(NOW.getTime())
      // A second dismiss just rewrites the stamp, like onboarding.dismiss.
      vi.setSystemTime(NOW.getTime() + 60_000)
      await dismissLeagueOfferFor(ctx, playerId)
      expect((await ctx.db.get(playerId))!.leagueOfferDismissedAt).toBe(NOW.getTime() + 60_000)
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

  test('a member whose row sits in the wrong group is repaired: old group loses them, new gains them', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-10-01' })
      await board(ctx, playerId, '2026-10-02', 3)
      // Stale derived rows: the member row (and its group total) claim SLATE.
      await ctx.db.insert('leagueMemberMonth', { playerId, leagueId, groupId: group.slate, year: 2026, month: 10, boards: 1, attempts: 3 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 10, boards: 1, attempts: 3, contributors: 1 })
      await recomputeLeagueMonthFor(ctx, playerId, '2026-10')
      const rows = await ctx.db.query('leagueGroupMonth').collect()
      expect(rows.find((r) => r.groupId === group.slate)).toMatchObject({ boards: 0, attempts: 0, contributors: 0 })
      expect(rows.find((r) => r.groupId === group.crane)).toMatchObject({ boards: 1, attempts: 3, contributors: 1 })
      expect(await ctx.db.query('leagueMemberMonth').collect()).toEqual([
        expect.objectContaining({ playerId, groupId: group.crane, boards: 1, attempts: 3 }),
      ])
      await expectGroupRowsAreSums(ctx)
    })
  })

  test('upsertBoardFor delete path removes the member row and decrements the group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.slate, fromDay: '2026-10-01' })
      await upsertBoardFor(ctx, playerId, { puzzleDay: today, answer: 'crane', guesses: ['slate', 'crane', '', '', '', ''], today })
      expect(await ctx.db.query('leagueMemberMonth').collect()).toHaveLength(1)
      await upsertBoardFor(ctx, playerId, { puzzleDay: today, answer: '', guesses: ['', '', '', '', '', ''], today })
      expect(await ctx.db.query('leagueMemberMonth').collect()).toEqual([])
      expect((await ctx.db.query('leagueGroupMonth').collect())[0]).toMatchObject({ groupId: group.slate, boards: 0, attempts: 0, contributors: 0 })
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

  test('join, enter TOMORROW’s board, leave the same day: nothing is stranded in the group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinGroupFor(ctx, playerId, { groupId: group.crane, today }) // opens 2026-10-08
      // The server accepts a board up to its own today + 1.
      await upsertBoardFor(ctx, playerId, { puzzleDay: '2026-10-08', answer: 'crane', guesses: ['slate', 'crane', '', '', '', ''], today })
      expect((await ctx.db.query('leagueGroupMonth').collect())[0]).toMatchObject({ groupId: group.crane, boards: 1, contributors: 1 })
      // planLeave DELETES the pending interval: no membership row survives.
      await leaveLeagueFor(ctx, playerId, { leagueId, today })
      expect(await ctx.db.query('leagueMemberships').collect()).toEqual([])
      expect(await ctx.db.query('leagueMemberMonth').collect()).toEqual([])
      expect((await ctx.db.query('leagueGroupMonth').collect())[0]).toMatchObject({ groupId: group.crane, boards: 0, attempts: 0, contributors: 0 })
      await expectGroupRowsAreSums(ctx)
    })
  })
})

describe('a membership change late in a month reaches next month’s boards', () => {
  // The server's last day of October. A board for November 1 is accepted (server today + 1).
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-31T12:00:00Z'), toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  const nov1 = { puzzleDay: '2026-11-01', answer: 'crane', guesses: ['slate', 'crane', '', '', '', ''] }

  async function craneMemberWithNov1Board(ctx: Ctx) {
    const { leagueId, group } = await seedStartingWords(ctx)
    const playerId = await ctx.db.insert('players', aPlayer())
    await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-10-01' })
    await ctx.db.patch(group.crane, { memberCount: 1 })
    await upsertBoardFor(ctx, playerId, { ...nov1, today: '2026-10-31' })
    const novRows = async () => (await ctx.db.query('leagueGroupMonth').collect()).filter((r) => r.month === 11)
    expect(await novRows()).toEqual([expect.objectContaining({ groupId: group.crane, boards: 1, contributors: 1 })])
    return { leagueId, group, playerId, novRows }
  }

  test('a switch on the last day moves the board on the 1st to the new group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group, playerId, novRows } = await craneMemberWithNov1Board(ctx)
      await switchGroupFor(ctx, playerId, { groupId: group.slate, today: '2026-10-31' })
      const rows = await novRows()
      expect(rows.find((r) => r.groupId === group.crane)).toMatchObject({ boards: 0, attempts: 0, contributors: 0 })
      expect(rows.find((r) => r.groupId === group.slate)).toMatchObject({ boards: 1, attempts: 2, contributors: 1 })
      expect(await ctx.db.query('leagueMemberMonth').collect()).toEqual([expect.objectContaining({ groupId: group.slate, month: 11 })])
      await expectGroupRowsAreSums(ctx)
    })
  })

  test('a leave on the last day takes the board on the 1st out of the group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group, playerId, novRows } = await craneMemberWithNov1Board(ctx)
      await leaveLeagueFor(ctx, playerId, { leagueId, today: '2026-10-31' })
      expect(await novRows()).toEqual([expect.objectContaining({ groupId: group.crane, boards: 0, attempts: 0, contributors: 0 })])
      expect(await ctx.db.query('leagueMemberMonth').collect()).toEqual([])
      await expectGroupRowsAreSums(ctx)
    })
  })

  test('a client a day behind the server (today = the 30th) still moves the board on the 1st', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group, playerId, novRows } = await craneMemberWithNov1Board(ctx)
      // requirePlausibleToday accepts server today - 1, and a board can be server today + 1: today + 2.
      await switchGroupFor(ctx, playerId, { groupId: group.slate, today: '2026-10-30' })
      const rows = await novRows()
      expect(rows.find((r) => r.groupId === group.crane)).toMatchObject({ boards: 0, contributors: 0 })
      expect(rows.find((r) => r.groupId === group.slate)).toMatchObject({ boards: 1, contributors: 1 })
      await expectGroupRowsAreSums(ctx)
    })
  })
})

describe('closing a month', () => {
  test('writes a snapshot with standings and the winner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedFixedOpeners(ctx)
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 9, boards: 12, attempts: 42, contributors: 2 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 9, boards: 10, attempts: 40, contributors: 1 })
      expect(await closeLeagueMonthFor(ctx, leagueId, '2026-09')).toBe(true)
      const [result] = await ctx.db.query('leagueMonthResults').collect()
      expect(result.winnerGroupId).toBe(group.slate) // 3.5 beats 4.0
      expect(result.standings).toHaveLength(5)
      expect(result.standings[0]).toEqual({ groupId: group.slate, boards: 12, attempts: 42, average: 3.5, contributors: 2 })
    })
  })

  test('a WORD league snapshots only the groups that played, ranked first in rank order', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const fresh = await ctx.db.insert('leagueGroups', { leagueId, slug: 'crate', name: 'CRATE', order: 50, memberCount: 0 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.adieu, year: 2026, month: 9, boards: 3, attempts: 12, contributors: 1 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 9, boards: 10, attempts: 40, contributors: 1 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: fresh, year: 2026, month: 9, boards: 12, attempts: 42, contributors: 2 })
      // October's row is a different month and must stay out.
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.stare, year: 2026, month: 10, boards: 30, attempts: 60, contributors: 3 })
      expect(await closeLeagueMonthFor(ctx, leagueId, '2026-09')).toBe(true)
      const [result] = await ctx.db.query('leagueMonthResults').collect()
      expect(result.standings.map((s) => [s.groupId, s.average])).toEqual([
        [fresh, 3.5],
        [group.crane, 4],
        [group.adieu, null],
      ])
      expect(result.winnerGroupId).toBe(fresh)
    })
  })

  test('is idempotent: a second close changes nothing, even after backfill', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const rowId = await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 9, boards: 10, attempts: 40, contributors: 1 })
      await closeLeagueMonthFor(ctx, leagueId, '2026-09')
      await ctx.db.patch(rowId, { boards: 30, attempts: 31 })
      expect(await closeLeagueMonthFor(ctx, leagueId, '2026-09')).toBe(false)
      const results = await ctx.db.query('leagueMonthResults').collect()
      expect(results).toHaveLength(1)
      expect(results[0].standings[0]).toMatchObject({ boards: 10, attempts: 40 })
    })
  })

  test('a malformed month writes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      expect(await closeLeagueMonthFor(ctx, leagueId, '2026-9')).toBe(false)
      expect(await ctx.db.query('leagueMonthResults').collect()).toEqual([])
    })
  })

  test('a duplicate snapshot does not throw', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      const row = { leagueId, year: 2026, month: 9, standings: [], winnerGroupId: null, closedAt: 0 }
      await ctx.db.insert('leagueMonthResults', row)
      await ctx.db.insert('leagueMonthResults', row)
      expect(await closeLeagueMonthFor(ctx, leagueId, '2026-09')).toBe(false)
      // the call site that runs INLINE in the sweep
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-02')).toBe(0)
    })
  })

  test('no qualifying group snapshots winnerGroupId null', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      await closeLeagueMonthFor(ctx, leagueId, '2026-09')
      expect((await ctx.db.query('leagueMonthResults').collect())[0].winnerGroupId).toBeNull()
    })
  })

  test('a board backfilled into a closed month moves live rows only, never the snapshot', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    try {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const { leagueId, group } = await seedStartingWords(ctx)
        const playerId = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.slate, fromDay: '2026-08-01' })
        await closeLeagueMonthFor(ctx, leagueId, '2026-09')
        const before = await ctx.db.query('leagueMonthResults').collect()
        await upsertBoardFor(ctx, playerId, { puzzleDay: '2026-09-15', answer: 'crane', guesses: ['slate', 'crane', '', '', '', ''], today: '2026-10-07' })
        expect(await ctx.db.query('leagueGroupMonth').collect()).toEqual(
          expect.arrayContaining([expect.objectContaining({ groupId: group.slate, year: 2026, month: 9, boards: 1, attempts: 2 })]),
        )
        await recomputeLeagueMonthFor(ctx, playerId, '2026-09')
        expect(await ctx.db.query('leagueMonthResults').collect()).toEqual(before)
        expect(before[0].winnerGroupId).toBeNull()
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('scheduleLeagueClosesFor', () => {
  const seededIn = Date.parse('2026-08-15T12:00:00Z')
  test('nothing on day 1', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedLeagueFor(ctx, STARTING_WORDS, seededIn)
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-01')).toBe(0)
    })
  })
  test('day 2 schedules last month once; an existing snapshot schedules nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const leagueId = await seedLeagueFor(ctx, STARTING_WORDS, seededIn)
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-02')).toBe(1)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 9, standings: [], winnerGroupId: null, closedAt: 0 })
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-03')).toBe(0)
    })
  })
  test('each league is checked against its own snapshot', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedLeagueFor(ctx, STARTING_WORDS, seededIn)
      const other = await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'solo', name: 'Solo' }] }, seededIn)
      await ctx.db.insert('leagueMonthResults', { leagueId: other, year: 2026, month: 9, standings: [], winnerGroupId: null, closedAt: 0 })
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-02')).toBe(1)
    })
  })
  test('never the month before the league existed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedLeagueFor(ctx, STARTING_WORDS, Date.parse('2026-10-01T12:00:00Z'))
      expect(await scheduleLeagueClosesFor(ctx, '2026-10-02')).toBe(0)
    })
  })
  test('the sweep runs it, and the scheduled job writes the snapshot', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-02T00:45:00Z') })
    try {
      const t = convexTest(schema, modules)
      await t.run((ctx) => seedLeagueFor(ctx, STARTING_WORDS, seededIn))
      await t.mutation(internal.teamStats.sweep, {})
      await t.finishAllScheduledFunctions(vi.runAllTimers)
      const results = await t.run((ctx) => ctx.db.query('leagueMonthResults').collect())
      expect(results.map((r) => [r.year, r.month])).toEqual([[2026, 9]])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('myLeaguesFor', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  test('empty for a non-member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await myLeaguesFor(ctx, playerId, today)).toEqual([])
    })
  })

  test('group, rank, average and a pending switch', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01', toDay: '2026-10-31' })
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.slate, fromDay: '2026-11-01' })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 10, boards: 10, attempts: 38, contributors: 3 })
      expect(await myLeaguesFor(ctx, playerId, today)).toEqual([
        {
          league: { slug: 'starting-words', name: 'Starting Words' },
          leagueId,
          group: { _id: group.crane, name: 'CRANE' },
          since: '2026-09-01',
          pending: { group: { _id: group.slate, name: 'SLATE' }, from: '2026-11-01' },
          rank: 1,
          average: 3.8,
          boards: 10,
        },
      ])
    })
  })

  test('pending-only: just joined, starts tomorrow', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.slate, fromDay: '2026-10-08' })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 10, boards: 10, attempts: 40, contributors: 2 })
      expect(await myLeaguesFor(ctx, playerId, today)).toEqual([
        {
          league: { slug: 'starting-words', name: 'Starting Words' },
          leagueId,
          group: { _id: group.slate, name: 'SLATE' },
          since: '2026-10-08',
          pending: null,
          rank: 1,
          average: 4,
          boards: 10,
        },
      ])
    })
  })

  test('two leagues: one row each, each with its own league group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const otherId = await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'solo', name: 'Solo' }] }, 0)
      const solo = (await groupsOf(ctx, otherId))[0]!
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await ctx.db.insert('leagueMemberships', { playerId, leagueId: otherId, groupId: solo._id, fromDay: '2026-09-05' })
      const rows = await myLeaguesFor(ctx, playerId, today)
      expect(rows.map((r) => [r.league.slug, r.group.name, r.since]).sort()).toEqual([
        ['other', 'Solo', '2026-09-05'],
        ['starting-words', 'CRANE', '2026-09-01'],
      ])
    })
  })

  test('a membership naming a missing group is skipped, not rendered blank', async () => {
    const t = convexTest(schema, modules)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await t.run(async (ctx) => {
        const { group } = await seedStartingWords(ctx)
        const otherId = await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'solo', name: 'Solo' }] }, 0)
        const playerId = await ctx.db.insert('players', aPlayer())
        // Foreign group id: valid document, but not in this league's groups.
        await ctx.db.insert('leagueMemberships', { playerId, leagueId: otherId, groupId: group.crane, fromDay: '2026-09-01' })
        expect(await myLeaguesFor(ctx, playerId, today)).toEqual([])
      })
      expect(err).toHaveBeenCalled()
    } finally {
      err.mockRestore()
    }
  })

  test('a word league: rank among the ACTIVE groups only', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.orate, fromDay: '2026-09-01' })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 10, boards: 10, attempts: 30, contributors: 2 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.orate, year: 2026, month: 10, boards: 10, attempts: 40, contributors: 2 })
      const [row] = await myLeaguesFor(ctx, playerId, today)
      expect(row).toMatchObject({ group: { _id: group.orate, name: 'ORATE' }, rank: 2, average: 4, boards: 10 })
    })
  })

  test('a word league member whose group has no row this month: rank null, boards 0', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.stare, fromDay: '2026-09-01' })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 10, boards: 10, attempts: 30, contributors: 2 })
      const [row] = await myLeaguesFor(ctx, playerId, today)
      expect(row).toMatchObject({ group: { _id: group.stare, name: 'STARE' }, rank: null, average: null, boards: 0 })
    })
  })

  test('a word-league membership naming another league’s group is skipped', async () => {
    const t = convexTest(schema, modules)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await t.run(async (ctx) => {
        const { leagueId } = await seedStartingWords(ctx)
        const otherId = await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'solo', name: 'Solo' }] }, 0)
        const solo = (await groupsOf(ctx, otherId))[0]!
        const playerId = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: solo._id, fromDay: '2026-09-01' })
        expect(await myLeaguesFor(ctx, playerId, today)).toEqual([])
      })
      expect(err).toHaveBeenCalled()
    } finally {
      err.mockRestore()
    }
  })

  test('a small fixed league still ranks against every group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedFixedOpeners(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.slate, fromDay: '2026-09-01' })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 10, boards: 10, attempts: 35, contributors: 2 })
      const [row] = await myLeaguesFor(ctx, playerId, today)
      expect(row).toMatchObject({ group: { _id: group.slate, name: 'SLATE' }, rank: 1, average: 3.5, boards: 10 })
    })
  })

  test('a left league is not listed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01', toDay: '2026-10-03' })
      expect(await myLeaguesFor(ctx, playerId, today)).toEqual([])
    })
  })
})

describe('myContributionFor', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date'] }))
  afterEach(() => vi.useRealTimers())

  test('mine, group, and the shift', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberMonth', { playerId, leagueId, groupId: group.crane, year: 2026, month: 10, boards: 4, attempts: 10 })
      // 14 boards with the member, exactly 10 without: both sides clear MIN_LEAGUE_BOARDS.
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.crane, year: 2026, month: 10, boards: 14, attempts: 56, contributors: 2 })
      expect(await myContributionFor(ctx, playerId, 'starting-words', today)).toEqual({ mine: 2.5, group: 4, shift: -0.6 })
    })
  })
  test('null with no boards this month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await myContributionFor(ctx, playerId, 'starting-words', today)).toBeNull()
    })
  })
  test('a member row with no group row reports group null, shift null', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberMonth', { playerId, leagueId, groupId: group.crane, year: 2026, month: 10, boards: 12, attempts: 30 })
      expect(await myContributionFor(ctx, playerId, 'starting-words', today)).toEqual({ mine: 2.5, group: null, shift: null })
    })
  })
  test('null for an unknown league', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await myContributionFor(ctx, playerId, 'nope', today)).toBeNull()
    })
  })
})

describe('the my* wrappers are gated', () => {
  // Wrappers cannot be driven (wordle-teams-obw), so pin the exact lines, as
  // challenges.test.ts does. Exact lines, not toContain: an inverted gate
  // contains every fragment.
  const source = readFileSync(new URL('./leagues.ts', import.meta.url), 'utf8')
  function handlerLines(name: string): string[] {
    const start = source.indexOf(`export const ${name} = `)
    expect(start, `no export const ${name}`).toBeGreaterThan(-1)
    const rest = source.slice(start)
    const end = rest.indexOf('\nexport ', 1)
    const body = (end === -1 ? rest : rest.slice(0, end)).split(/handler: async \(.*?\) => \{/)[1]
    expect(body, `no handler in ${name}`).toBeDefined()
    return body!
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
  }
  const DARK = 'if (!leaguesEnabled(process.env.LEAGUES_ENABLED)) return { enabled: false as const }'

  test.each(['myLeagues', 'myContribution'])('%s answers { enabled: false } first when dark', (name) => {
    expect(handlerLines(name)[0]).toBe(DARK)
  })

  test('myContribution returns locked, never numbers, to a caller with neither Pro nor a trial', () => {
    const lines = handlerLines('myContribution')
    const pro = lines.indexOf('const isPro = await isProFor(ctx, player._id)')
    const gate = lines.indexOf('if (!contributionUnlocked({ isPro, trialActive })) return { enabled: true as const, locked: true as const }')
    expect(pro).toBeGreaterThan(-1)
    const trial = lines.indexOf('const { trialActive } = insightsAccess({ isPro, trialEndsAt: player.insightsTrialEndsAt, now: Date.now() })')
    expect(trial).toBeGreaterThan(pro)
    expect(gate).toBeGreaterThan(trial)
    // The gate precedes any read of contribution data.
    expect(lines.findIndex((l) => l.includes('myContributionFor('))).toBeGreaterThan(gate)
    // The old Pro-only gate must not survive alongside it.
    expect(lines.some((l) => l.startsWith('if (!(await isProFor('))).toBe(false)
  })
})

describe('the Insights trial unlocks the contribution view', () => {
  const now = NOW.getTime()
  test.each([
    { label: 'an active trial', trialEndsAt: now + 86_400_000, unlocked: true },
    { label: 'a trial that expired 1 ms ago', trialEndsAt: now - 1, unlocked: false },
    { label: 'no trial', trialEndsAt: undefined, unlocked: false },
  ])('$label: unlocked is $unlocked', ({ trialEndsAt, unlocked }) => {
    // The same two calls the wrapper makes, minus the Better Auth session it needs.
    const { trialActive } = insightsAccess({ isPro: false, trialEndsAt, now })
    expect(contributionUnlocked({ isPro: false, trialActive })).toBe(unlocked)
  })
})

/**
 * T18, END TO END through the public wrappers and onboarding.getStatus, with a
 * real Better Auth session (fixtures.ts's authenticatedAs, as onboarding.test.ts
 * does). REAL TIME, not NOW: joinGroup checks `today` against the server's day.
 */
describe('"ever joined" survives a same-day join and leave', () => {
  // Supplied here, not in fixtures.ts: see makeRegisterBetterAuth's comment.
  const registerBetterAuth = makeRegisterBetterAuth(import.meta.glob('./betterAuth/**/*.ts'))
  afterEach(() => vi.unstubAllEnvs())

  test('join then leave the same day deletes the pending row, and getStatus still reports inLeague', async () => {
    vi.stubEnv('LEAGUES_ENABLED', 'true')
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { leagueId, group } = await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'sameday@example.com' }))
      return await seedStartingWords(ctx)
    })
    const as = await authenticatedAs(t, 'sameday@example.com')
    const day = toPuzzleDay(new Date())
    expect((await as.query(api.onboarding.getStatus, {}))?.inLeague).toBe(false)

    await as.mutation(api.leagues.joinGroup, { groupId: group.crane, today: day })
    await as.mutation(api.leagues.leaveLeague, { leagueId, today: day })

    // The precondition that made the bug: no membership row is left to find.
    expect(await t.run((ctx) => ctx.db.query('leagueMemberships').collect())).toEqual([])
    expect((await as.query(api.onboarding.getStatus, {}))?.inLeague).toBe(true)
  })

  test('dismissLeagueOffer is refused LEAGUES_DISABLED when dark, and writes nothing', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ email: 'dark@example.com' })))
    const as = await authenticatedAs(t, 'dark@example.com')
    await expect(as.mutation(api.leagues.dismissLeagueOffer, {})).rejects.toMatchObject({ data: { code: 'LEAGUES_DISABLED' } })
    // A boolean out of t.run: it serialises its result, so undefined comes back null.
    expect(await t.run(async (ctx) => (await ctx.db.get(playerId))?.leagueOfferDismissedAt !== undefined)).toBe(false)
  })
})

/**
 * v2a A3: a word picks (or, in a word league, creates) the group (spec v2 §4.2).
 * Driven through the …For handlers, at NOW, like 'membership' above.
 */
describe('joining and switching by word', () => {
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
  const groupsBySlug = async (ctx: Ctx, slug: string) =>
    (await ctx.db.query('leagueGroups').collect()).filter((g) => g.slug === slug)

  test('a new answer word creates its group, named UPPERCASE, and joins it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinWordFor(ctx, playerId, { leagueId, word: 'crate', today })
      const [crate] = await groupsBySlug(ctx, 'crate')
      expect(crate).toMatchObject({ leagueId, slug: 'crate', name: 'CRATE', memberCount: 1 })
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows).toEqual([expect.objectContaining({ playerId, leagueId, groupId: crate._id, fromDay: '2026-10-08' })])
    })
  })

  // CONCURRENCY: convex-test runs mutations one at a time, so the race named in
  // resolveWordGroupFor's comment (two first-joins both reading an empty slug
  // range) cannot be staged here; Convex's OCC retry is what resolves it in prod.
  // What this asserts is the invariant that retry relies on: once the group
  // exists, a later first-join finds it rather than inserting another.
  test('a second player picking the same word joins the same group: one group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      const a = await ctx.db.insert('players', aPlayer())
      const b = await ctx.db.insert('players', aPlayer())
      await joinWordFor(ctx, a, { leagueId, word: 'crate', today })
      await joinWordFor(ctx, b, { leagueId, word: 'crate', today })
      const groups = await groupsBySlug(ctx, 'crate')
      expect(groups).toHaveLength(1)
      expect(groups[0].memberCount).toBe(2)
      const rows = await ctx.db.query('leagueMemberships').collect()
      expect(rows.map((r) => r.groupId)).toEqual([groups[0]._id, groups[0]._id])
    })
  })

  test('mixed case and whitespace resolve to the same group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const a = await ctx.db.insert('players', aPlayer())
      const b = await ctx.db.insert('players', aPlayer())
      await joinWordFor(ctx, a, { leagueId, word: '  CrAtE\n', today })
      await joinWordFor(ctx, b, { leagueId, word: 'crate', today })
      expect(await groupsBySlug(ctx, 'crate')).toHaveLength(1)
      // An existing seeded group resolves the same way.
      const c = await ctx.db.insert('players', aPlayer())
      await joinWordFor(ctx, c, { leagueId, word: ' Crane ', today })
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(1)
    })
  })

  test('a non-answer word is refused UNKNOWN_WORD and creates nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      const before = (await ctx.db.query('leagueGroups').collect()).length
      for (const word of ['zzzzz', 'cr4te', 'crates', '']) {
        expect(await codeOf(joinWordFor(ctx, playerId, { leagueId, word, today }))).toBe('UNKNOWN_WORD')
      }
      expect(await ctx.db.query('leagueGroups').collect()).toHaveLength(before)
      expect(await ctx.db.query('leagueMemberships').collect()).toEqual([])
      expect((await ctx.db.get(playerId))!.leagueJoinedAt).toBeUndefined()
    })
  })

  test('an existing group whose word is not on the list stays joinable (grandfathered)', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      // No real v1 word is off the list today, so stage one directly.
      const zzzzz = await ctx.db.insert('leagueGroups', { leagueId, slug: 'zzzzz', name: 'ZZZZZ', order: 99, memberCount: 0 })
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinWordFor(ctx, playerId, { leagueId, word: 'ZZZZZ', today })
      expect((await ctx.db.get(zzzzz))!.memberCount).toBe(1)
      expect(await groupsBySlug(ctx, 'zzzzz')).toHaveLength(1)
    })
  })

  test('a fixed league refuses a new word UNKNOWN_WORD but accepts an existing group', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const leagueId = await seedLeagueFor(ctx, { slug: 'fixed', name: 'Fixed', featured: false, groups: [{ slug: 'crane', name: 'CRANE' }] }, 0)
      expect((await ctx.db.get(leagueId))!.groupSource).toBeUndefined()
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await codeOf(joinWordFor(ctx, playerId, { leagueId, word: 'crate', today }))).toBe('UNKNOWN_WORD')
      expect(await groupsBySlug(ctx, 'crate')).toEqual([])
      await joinWordFor(ctx, playerId, { leagueId, word: 'crane', today })
      const [crane] = await groupsBySlug(ctx, 'crane')
      expect(crane.memberCount).toBe(1)
    })
  })

  // IN-TRANSACTION: codeOf catches the refusal inside this same t.run, so no
  // rollback happens here; only the pre-check keeps the group from being created.
  // In production the mutation would roll back anyway (see the wrapper test).
  test('a member refused ALREADY_IN_LEAGUE in-transaction leaves no group, and hears that before UNKNOWN_WORD', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await joinGroupFor(ctx, playerId, { groupId: group.crane, today })
      expect(await codeOf(joinWordFor(ctx, playerId, { leagueId, word: 'crate', today }))).toBe('ALREADY_IN_LEAGUE')
      expect(await codeOf(joinWordFor(ctx, playerId, { leagueId, word: 'zzzzz', today }))).toBe('ALREADY_IN_LEAGUE')
      expect(await groupsBySlug(ctx, 'crate')).toEqual([])
    })
  })

  test('switchWord to a new word creates the group and plans the switch', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('leagueMemberships', { playerId, leagueId, groupId: group.crane, fromDay: '2026-09-01' })
      await ctx.db.patch(group.crane, { memberCount: 1 })
      await switchWordFor(ctx, playerId, { leagueId, word: 'Crate', today })
      const [crate] = await groupsBySlug(ctx, 'crate')
      expect(crate).toMatchObject({ name: 'CRATE', memberCount: 1 })
      const rows = (await ctx.db.query('leagueMemberships').collect()).sort((a, b) => a.fromDay.localeCompare(b.fromDay))
      expect(rows.map((r) => [r.groupId, r.fromDay, r.toDay])).toEqual([
        [group.crane, '2026-09-01', '2026-10-31'],
        [crate._id, '2026-11-01', undefined],
      ])
      expect((await ctx.db.get(group.crane))!.memberCount).toBe(0)
    })
  })

  // IN-TRANSACTION, as the join case above.
  test('a non-member refused NOT_IN_LEAGUE in-transaction leaves no group, and hears that before UNKNOWN_WORD', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId } = await seedStartingWords(ctx)
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await codeOf(switchWordFor(ctx, playerId, { leagueId, word: 'crate', today }))).toBe('NOT_IN_LEAGUE')
      expect(await codeOf(switchWordFor(ctx, playerId, { leagueId, word: 'zzzzz', today }))).toBe('NOT_IN_LEAGUE')
      expect(await groupsBySlug(ctx, 'crate')).toEqual([])
    })
  })

  test('validation order: a bad date before an unknown league, an unknown league before the word', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const gone = await ctx.db.insert('leagues', { slug: 'gone', name: 'Gone', featured: false, createdAt: 0 })
      await ctx.db.delete(gone)
      const playerId = await ctx.db.insert('players', aPlayer())
      for (const handler of [joinWordFor, switchWordFor]) {
        expect(await codeOf(handler(ctx, playerId, { leagueId: gone, word: 'zzzzz', today: '2020-01-01' }))).toBe('INVALID_DATE')
        expect(await codeOf(handler(ctx, playerId, { leagueId: gone, word: 'zzzzz', today }))).toBe('UNKNOWN_LEAGUE')
      }
      expect(await ctx.db.query('leagueGroups').collect()).toEqual([])
    })
  })
})

/** The joinWord/switchWord wrappers, through a real session. REAL TIME: `today` is checked against the server's day. */
describe('the joinWord and switchWord wrappers', () => {
  const registerBetterAuth = makeRegisterBetterAuth(import.meta.glob('./betterAuth/**/*.ts'))
  afterEach(() => vi.unstubAllEnvs())

  test('joinWord creates the word group and joins the caller', async () => {
    vi.stubEnv('LEAGUES_ENABLED', 'true')
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { playerId, leagueId } = await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ email: 'word@example.com' }))
      return { playerId, ...(await seedStartingWords(ctx)) }
    })
    const as = await authenticatedAs(t, 'word@example.com')
    await as.mutation(api.leagues.joinWord, { leagueId, word: ' Crate ', today: toPuzzleDay(new Date()) })
    const { groups, rows } = await t.run(async (ctx) => ({
      groups: (await ctx.db.query('leagueGroups').collect()).filter((g) => g.slug === 'crate'),
      rows: await ctx.db.query('leagueMemberships').collect(),
    }))
    expect(groups).toEqual([expect.objectContaining({ name: 'CRATE', memberCount: 1 })])
    expect(rows).toEqual([expect.objectContaining({ playerId, groupId: groups[0]._id })])
  })

  // END TO END through the wrapper: the refusal escapes the mutation, so Convex
  // rolls the whole transaction back. This is what keeps production orphan-free.
  test('an existing member joining a NEW valid word is refused ALREADY_IN_LEAGUE, and no group exists for it', async () => {
    vi.stubEnv('LEAGUES_ENABLED', 'true')
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { leagueId, group } = await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'member@example.com' }))
      return await seedStartingWords(ctx)
    })
    const as = await authenticatedAs(t, 'member@example.com')
    const day = toPuzzleDay(new Date())
    await as.mutation(api.leagues.joinGroup, { groupId: group.crane, today: day })
    await expect(as.mutation(api.leagues.joinWord, { leagueId, word: 'crate', today: day })).rejects.toMatchObject({
      data: { code: 'ALREADY_IN_LEAGUE' },
    })
    expect(await t.run(async (ctx) => (await ctx.db.query('leagueGroups').collect()).filter((g) => g.slug === 'crate').length)).toBe(0)
  })

  test('joinWord and switchWord are refused LEAGUES_DISABLED when dark, and create nothing', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const { leagueId } = await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'darkword@example.com' }))
      return await seedStartingWords(ctx)
    })
    const as = await authenticatedAs(t, 'darkword@example.com')
    const args = { leagueId, word: 'crate', today: toPuzzleDay(new Date()) }
    await expect(as.mutation(api.leagues.joinWord, args)).rejects.toMatchObject({ data: { code: 'LEAGUES_DISABLED' } })
    await expect(as.mutation(api.leagues.switchWord, args)).rejects.toMatchObject({ data: { code: 'LEAGUES_DISABLED' } })
    expect(await t.run(async (ctx) => (await ctx.db.query('leagueGroups').collect()).filter((g) => g.slug === 'crate').length)).toBe(0)
  })
})

/**
 * v2a A4: a large league lists only this month's ACTIVE groups — the top 10
 * ranked, the viewer's group, and a count of the unranked (spec v2 §4.5).
 */
describe('large-league standings', () => {
  /** A word group with no seed: what resolveWordGroupFor would create. */
  async function addGroup(ctx: Ctx, leagueId: Id<'leagues'>, slug: string, order: number) {
    return await ctx.db.insert('leagueGroups', { leagueId, slug, name: slug.toUpperCase(), order, memberCount: 0 })
  }
  async function monthRow(ctx: Ctx, leagueId: Id<'leagues'>, groupId: Id<'leagueGroups'>, boards: number, attempts: number, month = 10) {
    await ctx.db.insert('leagueGroupMonth', { leagueId, groupId, year: 2026, month, boards, attempts, contributors: 1 })
  }
  /**
   * Starting Words with 12 RANKED groups (averages 3.0, 3.1 … 4.1, so rank i+1 is
   * ranked[i]), one active UNRANKED group, and STARE and ORATE INACTIVE this
   * month (STARE has a September row, which must not count).
   */
  async function twelveActive(ctx: Ctx) {
    const { leagueId, group } = await seedStartingWords(ctx)
    const ranked = [group.crane, group.slate, group.adieu]
    for (const [i, slug] of ['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee', 'fffff', 'ggggg', 'hhhhh', 'iiiii'].entries()) {
      ranked.push(await addGroup(ctx, leagueId, slug, 10 + i))
    }
    for (const [i, id] of ranked.entries()) await monthRow(ctx, leagueId, id, 10, 30 + i)
    const unranked = await addGroup(ctx, leagueId, 'zzzzz', 99)
    await monthRow(ctx, leagueId, unranked, 4, 16)
    await monthRow(ctx, leagueId, group.stare, 40, 100, 9)
    return { leagueId, group, ranked, unranked }
  }

  test('top 10, the viewer at #12, the unranked count, and inactive groups not listed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group, ranked, unranked } = await twelveActive(ctx)
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07', ranked[11]))!
      if (!out.large) throw new Error('expected the large shape')
      expect(out.shown.map((s) => [s.groupId, s.rank])).toEqual(ranked.slice(0, 10).map((id, i) => [id, i + 1]))
      expect(out.viewer).toMatchObject({ groupId: ranked[11], rank: 12, average: 4.1 })
      expect(out.unrankedCount).toBe(1)
      // The page's table: shown, then the viewer.
      expect(out.standings.map((s) => s.groupId)).toEqual([...ranked.slice(0, 10), ranked[11]])
      // Names only for what is on the page: never #11, the unranked group, or an inactive one.
      const named = out.groups.map((g) => g._id)
      expect(new Set(named)).toEqual(new Set([...ranked.slice(0, 10), ranked[11]]))
      for (const absent of [ranked[10], unranked, group.stare, group.orate]) expect(named).not.toContain(absent)
      expect(out.groups.find((g) => g._id === group.crane)).toMatchObject({ slug: 'crane', name: 'CRANE' })
    })
  })

  test('a viewer inside the top 10 is not repeated', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { ranked } = await twelveActive(ctx)
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07', ranked[2]))!
      if (!out.large) throw new Error('expected the large shape')
      expect(out.viewer).toBeNull()
      expect(out.standings).toHaveLength(10)
    })
  })

  test('no viewer, and an empty month, list nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      expect(out).toMatchObject({ large: true, shown: [], viewer: null, unrankedCount: 0, standings: [], groups: [], monthsWon: [], lastMonth: null })
    })
  })

  test('v2a A7: the page gets the league id and the popular quick picks, top 6 by members, with slugs', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const counts: Record<string, number> = { crane: 5, slate: 9, adieu: 1, stare: 3, orate: 7 }
      for (const [slug, memberCount] of Object.entries(counts)) await ctx.db.patch(group[slug], { memberCount })
      await ctx.db.insert('leagueGroups', { leagueId, slug: 'crate', name: 'CRATE', order: 50, memberCount: 4 })
      await ctx.db.insert('leagueGroups', { leagueId, slug: 'pious', name: 'PIOUS', order: 51, memberCount: 0 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      if (!out.large) throw new Error('expected the large shape')
      expect(out.leagueId).toBe(leagueId)
      expect(out.groupSource).toBe('answer-words')
      expect(out.pickable).toBeNull()
      expect(out.popular.map((g) => [g.slug, g.name, g.memberCount])).toEqual([
        ['slate', 'SLATE', 9],
        ['orate', 'ORATE', 7],
        ['crane', 'CRANE', 5],
        ['crate', 'CRATE', 4],
        ['stare', 'STARE', 3],
        ['adieu', 'ADIEU', 1],
      ])
      // Popular groups are not standings: an empty month still names no group.
      expect(out.groups).toEqual([])
    })
  })

  test('lastMonth.viewerRank comes from the snapshot, and monthsWon lists winners only', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      await monthRow(ctx, leagueId, group.crane, 10, 35, 9)
      await monthRow(ctx, leagueId, group.slate, 10, 38, 9)
      await monthRow(ctx, leagueId, group.adieu, 3, 12, 9)
      await closeLeagueMonthFor(ctx, leagueId, '2026-09')
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 7, standings: [], winnerGroupId: group.orate, closedAt: 0 })
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 8, standings: [], winnerGroupId: null, closedAt: 0 })
      const rankOf = async (viewer?: Id<'leagueGroups'>) => {
        const out = (await standingsFor(ctx, 'starting-words', '2026-10-07', viewer))!
        if (!out.large) throw new Error('expected the large shape')
        return out.lastMonth?.viewerRank
      }
      expect(await rankOf(group.crane)).toBe(1)
      expect(await rankOf(group.slate)).toBe(2)
      expect(await rankOf(group.adieu)).toBeNull() // in the snapshot, unranked
      expect(await rankOf(group.stare)).toBeNull() // not in the snapshot
      expect(await rankOf()).toBeNull()

      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      expect(out.lastMonth).toMatchObject({ month: '2026-09', winnerGroupId: group.crane })
      expect(new Set(out.monthsWon)).toEqual(new Set([{ groupId: group.crane, count: 1 }, { groupId: group.orate, count: 1 }]))
      // Winners are named even when inactive this month.
      expect(new Set(out.groups.map((g) => g._id))).toEqual(new Set([group.crane, group.orate]))
    })
  })

  test('a viewer whose group has no row this month is still returned, as a zero row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group, unranked } = await twelveActive(ctx)
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07', group.orate))!
      if (!out.large) throw new Error('expected the large shape')
      expect(out.viewer).toEqual({ groupId: group.orate, order: 4, boards: 0, attempts: 0, contributors: 0, average: null, rank: null })
      expect(out.unrankedCount).toBe(1) // active groups only
      expect(out.standings.at(-1)?.groupId).toBe(group.orate)
      expect(out.groups.find((g) => g._id === group.orate)).toMatchObject({ name: 'ORATE' })
      expect(out.groups.map((g) => g._id)).not.toContain(unranked)
    })
  })

  test('a viewerGroupId from another league is ignored', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await twelveActive(ctx)
      const otherId = await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'x', name: 'X' }] }, 0)
      const [x] = await groupsOf(ctx, otherId)
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07', x._id))!
      if (!out.large) throw new Error('expected the large shape')
      expect(out.viewer).toBeNull()
      expect(out.lastMonth).toBeNull()
      expect(out.groups.map((g) => g._id)).not.toContain(x._id)
    })
  })

  test('another league’s rows and snapshots never reach a large league', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group, ranked } = await twelveActive(ctx)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 9, standings: [], winnerGroupId: group.crane, closedAt: 0 })
      const otherId = await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'x', name: 'X' }, { slug: 'y', name: 'Y' }] }, 0)
      const [x, y] = await groupsOf(ctx, otherId)
      await monthRow(ctx, otherId, x._id, 40, 80) // average 2.0: would top the table
      await monthRow(ctx, otherId, y._id, 2, 8) // unranked
      await ctx.db.insert('leagueMonthResults', { leagueId: otherId, year: 2026, month: 9, standings: [{ groupId: x._id, boards: 40, attempts: 80, average: 2, contributors: 1 }], winnerGroupId: x._id, closedAt: 0 })
      await ctx.db.insert('leagueMonthResults', { leagueId: otherId, year: 2026, month: 8, standings: [], winnerGroupId: x._id, closedAt: 0 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07'))!
      if (!out.large) throw new Error('expected the large shape')
      expect(out.shown.map((s) => s.groupId)).toEqual(ranked.slice(0, 10))
      expect(out.unrankedCount).toBe(1)
      expect(out.monthsWon).toEqual([{ groupId: group.crane, count: 1 }])
      expect(out.lastMonth).toEqual({ month: '2026-09', winnerGroupId: group.crane, viewerRank: null })
    })
  })

  test('a FIXED league above PICKER_INLINE_MAX is large too', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const groups = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((slug) => ({ slug, name: slug }))
      const leagueId = await seedLeagueFor(ctx, { slug: 'seven', name: 'Seven', featured: false, groups }, 0)
      const [a] = await groupsOf(ctx, leagueId)
      await monthRow(ctx, leagueId, a._id, 10, 30)
      const out = (await standingsFor(ctx, 'seven', '2026-10-07'))!
      if (!out.large) throw new Error('expected the large shape')
      expect(out.standings.map((s) => s.groupId)).toEqual([a._id])
      // Its picker gets EVERY group, not just the active one.
      expect(out.groupSource).toBe('fixed')
      expect(out.pickable?.map((g) => g.slug)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    })
  })

  test('a small fixed league keeps the v1 shape, plus large: false, whatever the viewer', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedFixedOpeners(ctx)
      await ctx.db.insert('leagueMonthResults', { leagueId, year: 2026, month: 9, standings: [], winnerGroupId: group.crane, closedAt: 0 })
      const out = (await standingsFor(ctx, 'starting-words', '2026-10-07', group.slate))!
      expect(Object.keys(out).sort()).toEqual(['groups', 'large', 'lastMonth', 'league', 'month', 'monthsWon', 'standings'])
      expect(out.large).toBe(false)
      expect(out.standings).toHaveLength(5)
      expect(out.groups).toHaveLength(5)
      expect(out.lastMonth).toEqual({ month: '2026-09', winnerGroupId: group.crane })
      expect(out.monthsWon).toHaveLength(5)
    })
  })
})

describe('groupStandingFor', () => {
  test('a word group: its month totals, without a rank', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      await ctx.db.patch(group.slate, { memberCount: 4 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 10, boards: 12, attempts: 42, contributors: 3 })
      await ctx.db.insert('leagueGroupMonth', { leagueId, groupId: group.slate, year: 2026, month: 9, boards: 50, attempts: 99, contributors: 9 })
      expect(await groupStandingFor(ctx, 'starting-words', '2026-10-07', ' Slate ')).toEqual({
        group: { _id: group.slate, name: 'SLATE', memberCount: 4 },
        boards: 12,
        attempts: 42,
        average: 3.5,
        contributors: 3,
      })
    })
  })
  test('a group with no boards this month is all zeros, average null', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { group } = await seedStartingWords(ctx)
      expect(await groupStandingFor(ctx, 'starting-words', '2026-10-07', 'crane')).toEqual({
        group: { _id: group.crane, name: 'CRANE', memberCount: 0 },
        boards: 0,
        attempts: 0,
        average: null,
        contributors: 0,
      })
    })
  })
  test('null for an unknown word, a malformed word, another league’s group, or an unknown league', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedStartingWords(ctx)
      await seedLeagueFor(ctx, { slug: 'other', name: 'Other', featured: false, groups: [{ slug: 'pious', name: 'PIOUS' }] }, 0)
      expect(await groupStandingFor(ctx, 'starting-words', '2026-10-07', 'crate')).toBeNull()
      expect(await groupStandingFor(ctx, 'starting-words', '2026-10-07', 'cr4ne')).toBeNull()
      expect(await groupStandingFor(ctx, 'starting-words', '2026-10-07', 'pious')).toBeNull()
      expect(await groupStandingFor(ctx, 'nope', '2026-10-07', 'crane')).toBeNull()
    })
  })
})

describe('popular groups in leaguesFor', () => {
  test('a word league lists its top 6 by memberCount, with groupSource and leagueId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { leagueId, group } = await seedStartingWords(ctx)
      const extra: Id<'leagueGroups'>[] = []
      for (const [i, slug] of ['aaaaa', 'bbbbb', 'ccccc'].entries()) {
        extra.push(await ctx.db.insert('leagueGroups', { leagueId, slug, name: slug.toUpperCase(), order: 10 + i, memberCount: 0 }))
      }
      const counts: [Id<'leagueGroups'>, number][] = [[group.orate, 9], [extra[1], 7], [group.slate, 5], [extra[0], 3], [group.crane, 3], [group.adieu, 1], [group.stare, 0]]
      for (const [id, n] of counts) await ctx.db.patch(id, { memberCount: n })
      const [out] = await leaguesFor(ctx)
      expect(out).toMatchObject({ leagueId, groupSource: 'answer-words' })
      // Ties (CRANE and AAAAA on 3) in display order.
      expect(out.groups.map((g) => [g._id, g.memberCount])).toEqual([
        [group.orate, 9],
        [extra[1], 7],
        [group.slate, 5],
        [group.crane, 3],
        [extra[0], 3],
        [group.adieu, 1],
      ])
    })
  })
  test('a fixed league still lists every group in order', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const groups = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((slug) => ({ slug, name: slug }))
      const leagueId = await seedLeagueFor(ctx, { slug: 'seven', name: 'Seven', featured: false, groups }, 0)
      const [g] = await groupsOf(ctx, leagueId)
      await ctx.db.patch(g._id, { memberCount: 0 })
      const [out] = await leaguesFor(ctx)
      expect(out).toMatchObject({ leagueId, groupSource: 'fixed' })
      expect(out.groups.map((x) => x.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    })
  })
})

describe('the standings and groupStanding wrappers', () => {
  const registerBetterAuth = makeRegisterBetterAuth(import.meta.glob('./betterAuth/**/*.ts'))
  afterEach(() => vi.unstubAllEnvs())

  async function setup(email: string) {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const day = toPuzzleDay(new Date())
    const [year, month] = day.split('-').map(Number)
    const { group } = await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email }))
      const seeded = await seedStartingWords(ctx)
      await ctx.db.insert('leagueGroupMonth', { leagueId: seeded.leagueId, groupId: seeded.group.slate, year, month, boards: 3, attempts: 12, contributors: 1 })
      return seeded
    })
    return { t, day, group, as: await authenticatedAs(t, email) }
  }

  test('standings passes groupId through as the viewer', async () => {
    vi.stubEnv('LEAGUES_ENABLED', 'true')
    const { as, day, group } = await setup('viewer@example.com')
    const res = await as.query(api.leagues.standings, { slug: 'starting-words', today: day, groupId: group.slate })
    if (!res.enabled || !res.view?.large) throw new Error('expected an enabled large view')
    expect(res.view.viewer).toMatchObject({ groupId: group.slate, boards: 3, rank: null })
    expect(res.view.unrankedCount).toBe(1)
  })

  test('groupStanding finds a word, and is null for an unknown one', async () => {
    vi.stubEnv('LEAGUES_ENABLED', 'true')
    const { as, day, group } = await setup('search@example.com')
    expect(await as.query(api.leagues.groupStanding, { slug: 'starting-words', today: day, word: 'SLATE' })).toEqual({
      enabled: true,
      standing: { group: { _id: group.slate, name: 'SLATE', memberCount: 0 }, boards: 3, attempts: 12, average: null, contributors: 1 },
    })
    expect(await as.query(api.leagues.groupStanding, { slug: 'starting-words', today: day, word: 'crate' })).toEqual({ enabled: true, standing: null })
  })

  test('groupStanding is dark when leagues are off', async () => {
    const { as, day } = await setup('darksearch@example.com')
    expect(await as.query(api.leagues.groupStanding, { slug: 'starting-words', today: day, word: 'slate' })).toEqual({ enabled: false })
  })
})
