import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

describe('deleteNamelessPlayers', () => {
  test('dry run reports counts and writes nothing', async () => {
    const t = convexTest(schema, modules)
    const ada = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert(
        'players',
        aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [nameless], creator: nameless }))
      return nameless
    })

    const report = await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: true })
    expect(report).toMatchObject({ namelessPlayers: 1, teamsEmptied: 1 })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(ada)).not.toBeNull()
    })
  })

  test('removes the player from rosters, clears creator, and deletes an emptied team', async () => {
    const t = convexTest(schema, modules)
    const { nameless, live, sharedTeam, deadTeam } = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert(
        'players',
        aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }),
      )
      const live = await ctx.db.insert('players', aPlayer({ email: 'live@a.test' }))
      const sharedTeam = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [live, nameless], creator: nameless }),
      )
      const deadTeam = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 999, playerIds: [nameless], creator: nameless }),
      )
      return { nameless, live, sharedTeam, deadTeam }
    })

    await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false })

    await t.run(async (ctx) => {
      expect(await ctx.db.get(nameless)).toBeNull()
      expect(await ctx.db.get(deadTeam)).toBeNull()
      const shared = (await ctx.db.get(sharedTeam))!
      expect(shared.playerIds).toEqual([live])
      expect(shared.creator).toBeUndefined()
    })
  })

  test('refuses to run when a nameless player owns a score', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const nameless = await ctx.db.insert(
        'players',
        aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }),
      )
      await ctx.db.insert('dailyScores', {
        playerId: nameless,
        puzzleDay: '2026-08-01',
        date: 0,
        guesses: [],
      })
    })

    await expect(
      t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false }),
    ).rejects.toThrow(/owns dailyScores/)
  })

  test("deletes an emptied team's monthlyWinners and scoringSystems but not dailyScores", async () => {
    const t = convexTest(schema, modules)
    const { score } = await t.run(async (ctx) => {
      const nameless = await ctx.db.insert(
        'players',
        aPlayer({ email: 'x@a.test', firstName: undefined, lastName: undefined }),
      )
      const live = await ctx.db.insert('players', aPlayer({ email: 'live@a.test' }))
      const team = await ctx.db.insert('teams', aTeam({ playerIds: [nameless], creator: nameless }))
      await ctx.db.insert('monthlyWinners', {
        playerId: live,
        teamId: team,
        year: 2026,
        month: 7,
        hasSeenCelebration: [],
      })
      await ctx.db.insert('scoringSystems', {
        teamId: team,
        effectiveFrom: '2026-07',
        oneGuess: 5,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
      })
      const score = await ctx.db.insert('dailyScores', {
        playerId: live,
        puzzleDay: '2026-07-01',
        date: 0,
        guesses: [],
      })
      return { live, score }
    })

    await t.mutation(internal.migrate.deleteNamelessPlayers, { dryRun: false })

    await t.run(async (ctx) => {
      expect(await ctx.db.query('monthlyWinners').collect()).toEqual([])
      expect(await ctx.db.query('scoringSystems').collect()).toEqual([])
      expect(await ctx.db.get(score)).not.toBeNull()
    })
  })
})
