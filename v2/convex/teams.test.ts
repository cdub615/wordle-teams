import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { getMyTeamsFor } from './teams.ts'

const modules = import.meta.glob('./**/*.ts')

describe('getMyTeamsFor', () => {
  test('returns only the teams the caller belongs to', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const mine = await ctx.db.insert('teams', aTeam({ name: 'Mine', playerIds: [ada], creator: ada }))
      await ctx.db.insert('teams', aTeam({ legacyId: 207, name: 'Theirs', playerIds: [bob], creator: bob }))

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams.map((team) => team.id)).toEqual([mine])
    })
  })

  test('carries members, creator flag and settings', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob', lastName: 'Ross' }))
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], creator: ada, playWeekends: false, showLetters: false }),
      )

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.isCreator).toBe(true)
      expect(team.playWeekends).toBe(false)
      expect(team.showLetters).toBe(false)
      expect(team.members.map((member) => member.firstName)).toEqual(['Ada', 'Bob'])
    })
  })

  test('isCreator is false for a member who did not create the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], creator: ada }))

      const [team] = await getMyTeamsFor(ctx, bob)
      expect(team.isCreator).toBe(false)
    })
  })

  test('isCreator is false when the team is a scoped copy with no creator', async () => {
    // A scoped copy may omit `creator` entirely — see access.ts's
    // requireTeamCreatorFor and its "refuses everyone when the creator was
    // not copied" test. isCreator is a UI-trust boolean shipped to every
    // client and gates the team-management buttons, so this is pinned rather
    // than left to fall out of `undefined === playerId` by accident.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [ada], creator: undefined }))

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.isCreator).toBe(false)
    })
  })

  test('returns an empty array for a player on no teams', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [bob], creator: bob }))

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams).toEqual([])
    })
  })

  test('excludes profile-incomplete members, as the scores table does', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const invitee = await ctx.db.insert(
        'players',
        aPlayer({ email: 'new@example.com', firstName: undefined, lastName: undefined }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [ada, invitee], creator: ada }))

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(team.members).toHaveLength(1)
    })
  })

  test('does not leak the invite list onto the wire', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada], creator: ada, invited: ['someone@example.com'] }),
      )

      const [team] = await getMyTeamsFor(ctx, ada)
      expect(JSON.stringify(team)).not.toContain('someone@example.com')
    })
  })

  test('orders by createdAt, oldest first', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ name: 'Second', playerIds: [ada], creator: ada, createdAt: 2000 }))
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 207, name: 'First', playerIds: [ada], creator: ada, createdAt: 1000 }),
      )

      const teams = await getMyTeamsFor(ctx, ada)
      expect(teams.map((team) => team.name)).toEqual(['First', 'Second'])
    })
  })
})
