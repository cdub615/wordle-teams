import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { rollupTeamMonth } from './teamStats'
import { upsertBoardFor } from './scores'
import { cascadeDeleteTeam } from './teams'
import { toPuzzleDay } from './lib/puzzleDay.ts'
import type { DataModel, Id } from './_generated/dataModel'
import type { GenericDatabaseWriter } from 'convex/server'

const modules = import.meta.glob('./**/*.ts')
const today = toPuzzleDay(new Date())

type TestCtx = { db: GenericDatabaseWriter<DataModel> }

const statsFor = async (ctx: TestCtx, teamId: Id<'teams'>, year: number, month: number) =>
  await ctx.db
    .query('teamMonthStats')
    .withIndex('by_team_year_month', (q) =>
      q.eq('teamId', teamId).eq('year', year).eq('month', month),
    )
    .unique()

const aBoard = (playerId: Id<'players'>, puzzleDay: string, n: number) => ({
  playerId,
  puzzleDay,
  date: Date.now(),
  answer: 'SPEED',
  guesses: ['CRANE', ...Array.from({ length: n - 2 }, () => 'MOIST'), 'SPEED'].slice(0, n),
})

describe('rollupTeamMonth', () => {
  test('writes one document per team per month, read by a point lookup', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const a = await ctx.db.insert('players', aPlayer())
      const b = await ctx.db.insert('players', aPlayer({ email: 'b@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [a, b] }))
      await ctx.db.insert('dailyScores', aBoard(a, '2026-09-01', 3))
      await ctx.db.insert('dailyScores', aBoard(b, '2026-09-01', 5))

      const team = (await ctx.db.get(teamId))!
      await rollupTeamMonth(ctx, team, '2026-09')

      const row = await statsFor(ctx, teamId, 2026, 9)
      expect(row?.members).toEqual([
        { playerId: a, boards: 1, attempts: 3, solved: 1, failed: 0 },
        { playerId: b, boards: 1, attempts: 5, solved: 1, failed: 0 },
      ])
      expect(row?.days).toHaveLength(1)
    })
  })

  /**
   * A cron that double-counts on a retry is worse than one that misses, so this
   * asserts the DOCUMENT, not merely that no second row appeared.
   */
  test('is idempotent — running it twice produces the same document', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const a = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [a] }))
      await ctx.db.insert('dailyScores', aBoard(a, '2026-09-01', 4))
      const team = (await ctx.db.get(teamId))!

      await rollupTeamMonth(ctx, team, '2026-09')
      const first = await statsFor(ctx, teamId, 2026, 9)
      await rollupTeamMonth(ctx, team, '2026-09')
      await rollupTeamMonth(ctx, team, '2026-09')
      const third = await statsFor(ctx, teamId, 2026, 9)

      expect(third?._id).toBe(first?._id)
      expect(third?.members).toEqual(first?.members)
      expect(third?.days).toEqual(first?.days)
      // AND IT DID NOT REWRITE: an unchanged month must cost no write, or the
      // hourly sweep spends on every team every hour exactly what the aggregate
      // saves on reads.
      expect(third?.computedAt).toBe(first?.computedAt)
    })
  })

  test('rewrites when a board actually changed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const a = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [a] }))
      const boardId = await ctx.db.insert('dailyScores', aBoard(a, '2026-09-01', 4))
      const team = (await ctx.db.get(teamId))!

      await rollupTeamMonth(ctx, team, '2026-09')
      await ctx.db.patch(boardId, { guesses: ['CRANE', 'SPEED'] })
      await rollupTeamMonth(ctx, team, '2026-09')

      expect((await statsFor(ctx, teamId, 2026, 9))?.members[0].attempts).toBe(2)
    })
  })

  test('reads only the requested month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const a = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [a] }))
      await ctx.db.insert('dailyScores', aBoard(a, '2026-08-31', 2))
      await ctx.db.insert('dailyScores', aBoard(a, '2026-09-01', 4))
      await ctx.db.insert('dailyScores', aBoard(a, '2026-10-01', 6))
      const team = (await ctx.db.get(teamId))!

      await rollupTeamMonth(ctx, team, '2026-09')
      const row = await statsFor(ctx, teamId, 2026, 9)
      expect(row?.members[0]).toMatchObject({ boards: 1, attempts: 4 })
    })
  })
})

describe('the board-write trigger', () => {
  /**
   * THE ONE THAT MATTERS. Backfill is a free feature, so a player can edit a
   * month from last year — and a rollup that only ever touched the current month
   * would leave that month's analytics permanently and silently wrong. The
   * aggregate rides recomputeTeamMonth, which already runs for the board's OWN
   * month.
   */
  test('entering a board in a PAST month rolls that month up', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const a = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [a] }))

      await upsertBoardFor(ctx, a, {
        puzzleDay: '2025-03-14',
        answer: 'SPEED',
        guesses: ['CRANE', 'MOIST', 'SPEED'],
        today,
      })

      const row = await statsFor(ctx, teamId, 2025, 3)
      expect(row, 'a backfilled month must be rolled up').not.toBeNull()
      expect(row?.members[0]).toMatchObject({ playerId: a, boards: 1, attempts: 3 })
    })
  })

  test('and editing that board updates the same document', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const a = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [a] }))
      const board = { puzzleDay: '2025-03-14', answer: 'SPEED', today }

      await upsertBoardFor(ctx, a, { ...board, guesses: ['CRANE', 'MOIST', 'SPEED'] })
      await upsertBoardFor(ctx, a, { ...board, guesses: ['CRANE', 'SPEED'] })

      const row = await statsFor(ctx, teamId, 2025, 3)
      expect(row?.members[0].attempts).toBe(2)
    })
  })

  test('and clearing it leaves the month at zero rather than stale', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const a = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [a] }))
      const board = { puzzleDay: '2025-03-14', today }

      await upsertBoardFor(ctx, a, { ...board, answer: 'SPEED', guesses: ['CRANE', 'SPEED'] })
      await upsertBoardFor(ctx, a, { ...board, answer: '', guesses: [] })

      const row = await statsFor(ctx, teamId, 2025, 3)
      expect(row?.members[0]).toMatchObject({ boards: 0, attempts: 0 })
      expect(row?.days).toEqual([])
    })
  })
})

describe('cascadeDeleteTeam', () => {
  /**
   * wordle-teams-2c1u's whole cause was a table added the day AFTER this cascade
   * was written. This table was added to it in the same commit, and this is the
   * test that keeps it there.
   */
  test('sweeps the aggregate along with the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const a = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [a] }))
      await ctx.db.insert('dailyScores', aBoard(a, '2026-09-01', 3))
      const team = (await ctx.db.get(teamId))!

      await rollupTeamMonth(ctx, team, '2026-09')
      await rollupTeamMonth(ctx, team, '2026-08')
      expect(await ctx.db.query('teamMonthStats').collect()).toHaveLength(2)

      await cascadeDeleteTeam(ctx, team)

      expect(await ctx.db.query('teamMonthStats').collect()).toEqual([])
    })
  })
})
