import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { toPuzzleDay } from './lib/puzzleDay.ts'
import { aPlayer, aTeam } from './scores.test.ts'
import { monthsWithWinners, recomputeTeamMonth, recomputeTeamMonths } from './winners.ts'

const today = toPuzzleDay(new Date())
const modules = import.meta.glob('./**/*.ts')

/** A board scoring `attempts` guesses, on the given day. */
const aScore = (playerId: string, puzzleDay: string, guesses: Array<string>) => ({
  playerId: playerId as never,
  puzzleDay,
  date: 1_755_500_000_000,
  answer: 'SPEED',
  guesses,
})

describe('recomputeTeamMonth', () => {
  test('writes a winner row for the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      // Ada solves in one (5 points); Bob solves in four (1 point).
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-08-03', ['CRANE', 'SLATE', 'SPELL', 'SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.playerId).toBe(ada)
    })
  })

  test('breaks a tie in favour of the earlier player in team order', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [bob, ada] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-08-03', ['SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      // Bob is first in playerIds, so Bob wins the tie.
      expect(row?.playerId).toBe(bob)
    })
  })

  test('deletes the row when the team has no member who can win', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row).toBeNull()
    })
  })

  test('preserves hasSeenCelebration when the winner is unchanged', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [ada],
      })

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.hasSeenCelebration).toEqual([ada])
    })
  })

  test('resets hasSeenCelebration when the winner changes', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [bob],
      })

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.playerId).toBe(ada)
      expect(row?.hasSeenCelebration).toEqual([])
    })
  })

  test('excludes a profile-incomplete member from winning', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const invitee = await ctx.db.insert(
        'players',
        aPlayer({ email: 'new@example.com', firstName: undefined, lastName: undefined }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [invitee, ada] }))
      // The invitee scores higher, but has no completed profile.
      await ctx.db.insert('dailyScores', aScore(invitee, '2026-08-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['CRANE', 'SLATE', 'SPELL', 'SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.playerId).toBe(ada)
    })
  })
})

describe('monthsWithWinners', () => {
  test('returns every month the team has a winner row for, as YYYY-MM', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      const other = await ctx.db.insert('teams', aTeam({ legacyId: 207, playerIds: [ada] }))
      for (const [year, month] of [
        [2026, 6],
        [2026, 7],
        [2025, 12],
      ] as const) {
        await ctx.db.insert('monthlyWinners', {
          playerId: ada,
          teamId,
          year,
          month,
          hasSeenCelebration: [],
        })
      }
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId: other,
        year: 2026,
        month: 1,
        hasSeenCelebration: [],
      })

      expect((await monthsWithWinners(ctx, teamId)).sort()).toEqual(['2025-12', '2026-06', '2026-07'])
    })
  })
})

describe('recomputeTeamMonths', () => {
  test('recomputes each month it is given, independently', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      // Ada wins June, Bob wins July.
      await ctx.db.insert('dailyScores', aScore(ada, '2026-06-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-07-03', ['SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonths(ctx, team, ['2026-06', '2026-07'], today)

      const june = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 6))
        .first()
      const july = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 7))
        .first()
      expect(june?.playerId).toBe(ada)
      expect(july?.playerId).toBe(bob)
    })
  })
})
