import { convexTest } from 'convex-test'
import type { GenericDatabaseWriter } from 'convex/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import type { DataModel } from './_generated/dataModel'
import { aPlayer, aTeam } from './fixtures.ts'
import { setTeamClueLadderFor } from './games'

const modules = import.meta.glob('./**/*.ts')

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
      await setTeamClueLadderFor(ctx, owner, teamId, true)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(true)
      await setTeamClueLadderFor(ctx, owner, teamId, false)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })

  test('a member who is not the owner is refused', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const { member, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, member, teamId, true)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBeUndefined()
    })
  })

  test('switching on is refused while the deployment switch is off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    await convexTest(schema, modules).run(async (ctx) => {
      const { owner, teamId } = await seedTeam(ctx)
      await expect(setTeamClueLadderFor(ctx, owner, teamId, true)).rejects.toMatchObject({
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
      await setTeamClueLadderFor(ctx, owner, teamId, false)
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(false)
    })
  })
})
