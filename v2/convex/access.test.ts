import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { isProFor, playerForEmail, requireTeamOwnerFor, requireTeamMemberFor } from './access'
import { aPlayer, aTeam } from './fixtures.ts'

const modules = import.meta.glob('./**/*.ts')

describe('playerForEmail', () => {
  test('matches case-insensitively', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('players', aPlayer())
      // Copied emails are always lowercase; a provider may hand back any case.
      const found = await playerForEmail(ctx, 'Member@Example.COM')
      expect(found?._id).toBe(id)
    })
  })

  test('returns null when no copied player matches', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      expect(await playerForEmail(ctx, 'nobody@example.com')).toBeNull()
    })
  })
})

describe('requireTeamMemberFor', () => {
  test('returns the team to a member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const team = await requireTeamMemberFor(ctx, playerId, teamId)
      expect(team._id).toBe(teamId)
    })
  })

  test('refuses a non-member — the RLS policy this replaces', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const memberId = await ctx.db.insert('players', aPlayer())
      const outsiderId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '22222222-2222-4222-8222-222222222222',
          email: 'outsider@example.com',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [memberId] }))

      await expect(requireTeamMemberFor(ctx, outsiderId, teamId)).rejects.toThrow(ConvexError)
      await expect(requireTeamMemberFor(ctx, outsiderId, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  test('refuses a team that does not exist', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.delete(teamId)
      await expect(requireTeamMemberFor(ctx, playerId, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})

describe('requireTeamOwnerFor', () => {
  test('returns the team for its owner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const team = await requireTeamOwnerFor(ctx, ada, teamId)
      expect(team._id).toBe(teamId)
    })
  })

  test('refuses a member who is not the owner, with NOT_TEAM_OWNER', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      await expect(requireTeamOwnerFor(ctx, bob, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  test('refuses a non-member with NOT_A_MEMBER, so a probe cannot tell the two apart', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await expect(requireTeamOwnerFor(ctx, outsider, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  test('refuses everyone when the owner was not copied', async () => {
    // A scoped copy may not include the team's owner, so `owner` is
    // optional. Such a team has nobody who can edit it. Honest, but it looks
    // like a bug on beta unless it is asserted somewhere.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: undefined }))
      await expect(requireTeamOwnerFor(ctx, ada, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })
})

describe('isProFor', () => {
  test('is true only for membershipStatus pro', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      expect(await isProFor(ctx, ada)).toBe(false)

      await ctx.db.insert('playerMembership', {
        legacyId: 'lm-1',
        playerId: ada,
        membershipStatus: 'pro',
      })
      expect(await isProFor(ctx, ada)).toBe(true)
    })
  })

  test('is false for every non-pro status', async () => {
    const t = convexTest(schema, modules)
    for (const status of ['new', 'free', 'cancelled', 'expired'] as const) {
      await t.run(async (ctx) => {
        const ada = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('playerMembership', {
          legacyId: `lm-${status}`,
          playerId: ada,
          membershipStatus: status,
        })
        expect(await isProFor(ctx, ada)).toBe(false)
      })
    }
  })
})
