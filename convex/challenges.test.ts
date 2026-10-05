import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import {
  liveChallengeCountFor,
  liveChallengesFor,
  proposeByLinkFor,
  proposeToTeamFor,
} from './challenges.ts'
import { MAX_ACTIVE_CHALLENGES, PROPOSAL_TTL_DAYS } from './lib/challenge.ts'
import type { DataModel } from './_generated/dataModel'
import type { GenericDatabaseWriter } from 'convex/server'

/**
 * DRIVEN THROUGH ctx.db RATHER THAN THE PUBLIC MUTATIONS, which need a Better
 * Auth session the harness cannot mint (wordle-teams-obw). The *For helpers hold
 * all the logic for exactly this reason; the public wrappers only supply a
 * player id.
 */
const modules = import.meta.glob('./**/*.ts')
type Ctx = { db: GenericDatabaseWriter<DataModel> }

/** A player on two teams, Pro by default. */
async function seedTwoTeams(ctx: Ctx, { pro = true } = {}) {
  const playerId = await ctx.db.insert('players', aPlayer())
  if (pro) {
    await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
  }
  const challengerTeamId = await ctx.db.insert(
    'teams',
    aTeam({ name: 'Challengers', playerIds: [playerId], owner: playerId }),
  )
  const opponentTeamId = await ctx.db.insert(
    'teams',
    aTeam({ legacyId: 207, name: 'Opponents', playerIds: [playerId], owner: playerId }),
  )
  return { playerId, challengerTeamId, opponentTeamId }
}

describe('proposeToTeamFor', () => {
  test('a Pro member on both teams creates a pending challenge', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      const id = await proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId)
      const doc = await ctx.db.get(id)
      expect(doc?.status).toBe('pending')
      expect(doc?.opponentTeamId).toBe(opponentTeamId)
      expect(doc?.token).toBeUndefined()
      // DERIVED FROM THE CONSTANT, not from 604800000: an unasserted cap drifts,
      // and a literal keeps passing straight through the drift.
      expect(doc!.expiresAt - doc!.createdAt).toBe(PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000)
    })
  })

  test('a non-Pro member is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx, { pro: false })
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toMatchObject({ data: { code: 'PRO_REQUIRED' } })
    })
  })

  test('a team cannot challenge itself', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, challengerTeamId),
      ).rejects.toMatchObject({ data: { code: 'INVALID_TEAM' } })
    })
  })

  test('an opponent refusing incoming challenges is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      await ctx.db.patch(opponentTeamId, { acceptsChallenges: false })
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGES_REFUSED' } })
    })
  })

  test('a second active challenge against the SAME opponent is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      const id = await proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId)
      await ctx.db.patch(id, { status: 'active', startDay: '2026-10-05', endDay: '2026-10-31' })
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_EXISTS' } })
    })
  })

  test('the pair rule also catches the REVERSE direction', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId: opponentTeamId,
        opponentTeamId: challengerTeamId,
        proposedBy: playerId,
        status: 'active',
        expiresAt: Date.now() + 1000,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        createdAt: Date.now(),
      })
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_EXISTS' } })
    })
  })

  test('at MAX_ACTIVE_CHALLENGES the challenger is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES; i++) {
        const otherId = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 300 + i, name: `other ${i}`, playerIds: [playerId] }),
        )
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId: otherId,
          proposedBy: playerId,
          status: 'active',
          expiresAt: Date.now() + 1000,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_LIMIT_REACHED' } })
    })
  })

  test('one BELOW the cap is allowed — the boundary tested in both directions', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES - 1; i++) {
        const otherId = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 400 + i, name: `other ${i}`, playerIds: [playerId] }),
        )
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId: otherId,
          proposedBy: playerId,
          status: 'active',
          expiresAt: Date.now() + 1000,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).resolves.toBeDefined()
    })
  })

  test('counts a team on EITHER side toward its own cap', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const otherId = await ctx.db.insert('teams', aTeam({ legacyId: 500, name: 'other' }))
      await ctx.db.insert('teamChallenges', {
        challengerTeamId: otherId,
        opponentTeamId: challengerTeamId,
        proposedBy: playerId,
        status: 'active',
        expiresAt: Date.now() + 1000,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        createdAt: Date.now(),
      })
      expect(await liveChallengeCountFor(ctx, challengerTeamId)).toBe(1)
    })
  })

  test('a closed challenge does not count toward the cap', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      const id = await proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId)
      await ctx.db.patch(id, { status: 'closed' })
      expect(await liveChallengeCountFor(ctx, challengerTeamId)).toBe(0)
    })
  })

  test('an opponent at the cap is refused, though the challenger has room', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES; i++) {
        const otherId = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 600 + i, name: `other ${i}`, playerIds: [playerId] }),
        )
        await ctx.db.insert('teamChallenges', {
          challengerTeamId: otherId,
          opponentTeamId,
          proposedBy: playerId,
          status: 'active',
          expiresAt: Date.now() + 1000,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_LIMIT_REACHED' } })
    })
  })

  // KILLS the opponent-threshold mutant `>= MAX_ACTIVE_CHALLENGES - 1`: the
  // opponent holds a nonzero sub-cap count and the call must still succeed.
  test('an opponent ONE BELOW the cap is allowed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES - 1; i++) {
        const otherId = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 600 + i, name: `other ${i}`, playerIds: [playerId] }),
        )
        await ctx.db.insert('teamChallenges', {
          challengerTeamId: otherId,
          opponentTeamId,
          proposedBy: playerId,
          status: 'active',
          expiresAt: Date.now() + 1000,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).resolves.toBeDefined()
    })
  })

  test('PENDING proposals occupy slots too', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const otherId = await ctx.db.insert('teams', aTeam({ legacyId: 700, name: 'other' }))
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: otherId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + 1000,
        createdAt: Date.now(),
      })
      expect(await liveChallengeCountFor(ctx, challengerTeamId)).toBe(1)
    })
  })

  test('declined, withdrawn, expired and closed challenges occupy no slot', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      for (const status of ['declined', 'withdrawn', 'expired', 'closed'] as const) {
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId,
          proposedBy: playerId,
          status,
          expiresAt: Date.now() + 1000,
          createdAt: Date.now(),
        })
      }
      expect(await liveChallengeCountFor(ctx, challengerTeamId)).toBe(0)
      // And none of them blocks the pair either.
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).resolves.toBeDefined()
    })
  })

  test('a pending LINK proposal (no opponent yet) blocks no pair and lists once', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        proposedBy: playerId,
        status: 'pending',
        token: 'tok',
        expiresAt: Date.now() + 1000,
        createdAt: Date.now(),
      })
      expect(await liveChallengesFor(ctx, challengerTeamId)).toHaveLength(1)
      expect(await liveChallengesFor(ctx, opponentTeamId)).toHaveLength(0)
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, opponentTeamId),
      ).resolves.toBeDefined()
    })
  })

  test('a non-member of the opponent team is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const strangerTeam = await ctx.db.insert('teams', aTeam({ legacyId: 800, name: 'strangers' }))
      await expect(
        proposeToTeamFor(ctx, playerId, challengerTeamId, strangerTeam),
      ).rejects.toMatchObject({ data: { code: 'NOT_A_MEMBER' } })
    })
  })

  // THE CHALLENGER-SIDE MEMBERSHIP CHECK, which nothing else pins. Measured:
  // deleting it from proposeToTeamFor leaves every other test green, and the
  // opponent-side check would still pass - so a Pro player could name a team
  // they are not on as the challenger, consuming its cap.
  test('you cannot propose ON BEHALF OF a team you are not on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const strangersTeam = await ctx.db.insert('teams', aTeam({ legacyId: 810, name: 'Strangers' }))
      // ROLES REVERSED: the stranger team as CHALLENGER, a team we are on as opponent.
      await expect(
        proposeToTeamFor(ctx, playerId, strangersTeam, challengerTeamId),
      ).rejects.toMatchObject({ data: { code: 'NOT_A_MEMBER' } })
    })
  })

  // THE CHALLENGER-SIDE MEMBERSHIP CHECK, which nothing else pins. Measured:
  // deleting it from proposeToTeamFor leaves every other test green, and the
  // opponent-side check would still pass - so a Pro player could name a team
  // they are not on as the challenger, consuming its cap.
  test('you cannot propose ON BEHALF OF a team you are not on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const strangersTeam = await ctx.db.insert('teams', aTeam({ legacyId: 810, name: 'Strangers' }))
      // ROLES REVERSED: the stranger team as CHALLENGER, a team we are on as opponent.
      await expect(
        proposeToTeamFor(ctx, playerId, strangersTeam, challengerTeamId),
      ).rejects.toMatchObject({ data: { code: 'NOT_A_MEMBER' } })
    })
  })
})

describe('proposeByLinkFor', () => {
  // proposeByLinkFor's ONLY membership check. Without this test, deleting it
  // lets any Pro player mint a challenge link for any team in the product.
  test('you cannot mint a link for a team you are not on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId } = await seedTwoTeams(ctx)
      const strangersTeam = await ctx.db.insert('teams', aTeam({ legacyId: 811, name: 'Strangers' }))
      await expect(proposeByLinkFor(ctx, playerId, strangersTeam)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })


  test('a Pro member gets a token and no opponent', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      const doc = await ctx.db
        .query('teamChallenges')
        .withIndex('by_token', (q) => q.eq('token', token))
        .unique()
      expect(doc?.status).toBe('pending')
      expect(doc?.opponentTeamId).toBeUndefined()
      // DERIVED FROM THE CONSTANT, not from 604800000: an unasserted cap drifts,
      // and a literal keeps passing straight through the drift.
      expect(doc!.expiresAt - doc!.createdAt).toBe(PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000)
    })
  })

  test('a non-Pro member is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx, { pro: false })
      await expect(proposeByLinkFor(ctx, playerId, challengerTeamId)).rejects.toMatchObject({
        data: { code: 'PRO_REQUIRED' },
      })
    })
  })

  // PROVES THE CALL RUNS IN THIS RUNTIME; it does NOT prove unguessability — a
  // counter would satisfy this too. The source of the bytes is a code-review
  // obligation. Same note as inviteLinks' newToken.
  // EACH ROW IS WITHDRAWN BEFORE THE NEXT DRAW. proposeByLinkFor counts
  // 'pending' against MAX_ACTIVE_CHALLENGES, which is 5 — so an unguarded
  // 25-iteration loop throws CHALLENGE_LIMIT_REACHED at i = 5. Measured against
  // the real function, which is already on disk.
  //
  // THE SHAPE ASSERTION IS NOT DECORATION: 32 hex chars is the 16 bytes newToken
  // draws. Without it the suite cannot tell Uint8Array(16) from Uint8Array(2) —
  // 25 draws from 65536 collide only about 0.5% of the time, so the set-size
  // assertion alone survives that mutant.
  test('two tokens never collide', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const tokens = new Set<string>()
      for (let i = 0; i < 25; i++) {
        const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
        tokens.add(token)
        expect(token).toMatch(/^[0-9a-f]{32}$/)
        const doc = await ctx.db
          .query('teamChallenges')
          .withIndex('by_token', (q) => q.eq('token', token))
          .unique()
        if (doc !== null) await ctx.db.patch(doc._id, { status: 'withdrawn' })
      }
      expect(tokens.size).toBe(25)
    })
  })

  test('the challenger cap still applies to link proposals', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES; i++) {
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          proposedBy: playerId,
          status: 'pending',
          token: `token-${i}`,
          expiresAt: Date.now() + 1000,
          createdAt: Date.now(),
        })
      }
      await expect(proposeByLinkFor(ctx, playerId, challengerTeamId)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LIMIT_REACHED' },
      })
    })
  })
})
