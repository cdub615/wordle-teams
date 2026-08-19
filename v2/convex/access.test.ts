import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { playerForEmail, requireTeamMemberFor } from './access'

const modules = import.meta.glob('./**/*.ts')

const aPlayer = (over: Record<string, unknown> = {}) => ({
  legacyId: '11111111-1111-4111-8111-111111111111',
  email: 'member@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '18:00:00',
  ...over,
})

const aTeam = (over: Record<string, unknown> = {}) => ({
  legacyId: 206,
  name: 'team 206',
  playerIds: [],
  invited: [],
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
  playWeekends: true,
  showLetters: true,
  ...over,
})

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
