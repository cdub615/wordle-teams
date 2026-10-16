import { convexTest } from 'convex-test'
import type { GenericDatabaseWriter } from 'convex/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import type { DataModel } from './_generated/dataModel'
import { aPlayer, aTeam } from './fixtures.ts'
import { setTeamClueLadderFor } from './games'
import { addDays, toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
// The real clock: requirePlausibleToday reads it.
const today = toPuzzleDay(new Date())

afterEach(() => vi.unstubAllEnvs())

type Ctx = { db: GenericDatabaseWriter<DataModel> }

async function seedTeam(ctx: Ctx) {
  const owner = await ctx.db.insert('players', aPlayer())
  const member = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
  const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [owner, member], owner }))
  return { owner, member, teamId }
}

describe('setTeamClueLadderFor', () => {
  test('the owner switches it on, and back off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await setTeamClueLadderFor(ctx, owner, teamId, true, today)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(true)
      await setTeamClueLadderFor(ctx, owner, teamId, false, today)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })

  test('a member who is not the owner is refused', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { member, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, member, teamId, true, today)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBeUndefined()
    })
  })

  test('switching on is refused while the deployment switch is off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, owner, teamId, true, today)).rejects.toMatchObject({
        data: { code: 'CLUE_LADDER_DISABLED' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBeUndefined()
    })
  })

  test('switching off works even while the deployment switch is off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await ctx.db.patch(teamId, { clueLadderEnabled: true })
      await setTeamClueLadderFor(ctx, owner, teamId, false, today)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })
})

describe('clueLadderOnSince (wordle-teams-k1v5)', () => {
  test('switching on stores the owner’s today', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await setTeamClueLadderFor(ctx, owner, teamId, true, today)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(today)
    })
  })

  test('switching off leaves it; switching on again moves it to the new day', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      const earlier = addDays(today, -20)
      await ctx.db.patch(teamId, { clueLadderEnabled: true, clueLadderOnSince: earlier })

      await setTeamClueLadderFor(ctx, owner, teamId, false, today)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(earlier)

      await setTeamClueLadderFor(ctx, owner, teamId, true, today)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(today)
    })
  })

  test('switching on what is already on keeps its day', async () => {
    // A second tab, or a double tap on the switch, must not wipe out the days
    // the team has already played.
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      const earlier = addDays(today, -20)
      await ctx.db.patch(teamId, { clueLadderEnabled: true, clueLadderOnSince: earlier })
      await setTeamClueLadderFor(ctx, owner, teamId, true, today)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(earlier)
    })
  })

  test('switching on refuses an implausible today; switching off never does', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, owner, teamId, true, addDays(today, -5))).rejects.toMatchObject({
        data: { code: 'INVALID_DATE' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBeUndefined()

      await ctx.db.patch(teamId, { clueLadderEnabled: true })
      await setTeamClueLadderFor(ctx, owner, teamId, false, 'not-a-day')
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })
})
