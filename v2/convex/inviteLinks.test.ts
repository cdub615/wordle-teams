import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { createLinkFor, revokeLinkFor } from './inviteLinks.ts'

const modules = import.meta.glob('./**/*.ts')

describe('createLinkFor', () => {
  test('stores a live row and returns its token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const token = await createLinkFor(ctx, ada, teamId)
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThanOrEqual(32)

      const rows = await ctx.db.query('inviteLinks').collect()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ teamId, token, createdBy: ada })
      expect(rows[0].revokedAt).toBeUndefined()
      expect(rows[0].expiresAt).toBeGreaterThan(Date.now())
    })
  })

  test('two links never collide', async () => {
    // THIS TEST IS THE POINT OF THE TASK. Nothing else in convex/ uses randomness,
    // so nothing in this repo demonstrates what the runtime permits inside a
    // mutation. If the generator is not actually random, this fails loudly here
    // rather than shipping guessable capability URLs.
    //
    // WHAT IT DOES NOT PROVE: distinctness is not unguessability. A counter
    // (`token = String(i++)`) passes this test — verified by planting exactly
    // that mutant — and would be catastrophic here, because the token is a
    // capability read on a pre-auth path. No test in this file can prove
    // unguessability; that property rests on crypto.getRandomValues being the
    // source, which is a code review obligation, not a covered assertion.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      const tokens = new Set<string>()
      for (let i = 0; i < 25; i++) tokens.add(await createLinkFor(ctx, ada, teamId))
      expect(tokens.size).toBe(25)
    })
  })

  test('a member who does not own the team cannot create one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await expect(createLinkFor(ctx, bob, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  test('a stranger to the team cannot create one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await expect(createLinkFor(ctx, outsider, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})

describe('revokeLinkFor', () => {
  test('stamps revokedAt', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      await revokeLinkFor(ctx, ada, token)
      const [row] = await ctx.db.query('inviteLinks').collect()
      expect(row.revokedAt).toBeGreaterThan(0)
    })
  })

  test('a non-owner cannot revoke', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const token = await createLinkFor(ctx, ada, teamId)

      await expect(revokeLinkFor(ctx, bob, token)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  test('an unknown token is refused as INVITE_LINK_INVALID', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await expect(revokeLinkFor(ctx, ada, 'nosuchtoken')).rejects.toMatchObject({
        data: { code: 'INVITE_LINK_INVALID' },
      })
    })
  })
})
