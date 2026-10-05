import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import {
  acceptChallengeFor,
  challengeScoreboardFor,
  challengesForTeamFor,
  claimChallengeLinkFor,
  declineChallengeFor,
  headToHeadFor,
  liveChallengeCountFor,
  liveChallengesFor,
  proposeByLinkFor,
  proposeToTeamFor,
  setAcceptsChallengesFor,
  withdrawChallengeFor,
} from './challenges.ts'
import { MAX_ACTIVE_CHALLENGES, MIN_CHALLENGE_BOARDS, PROPOSAL_TTL_DAYS } from './lib/challenge.ts'
import type { ChallengeOutcome } from './lib/challenge.ts'
import type { DataModel, Doc, Id } from './_generated/dataModel'
import type { GenericDatabaseWriter } from 'convex/server'

/**
 * DRIVEN THROUGH ctx.db RATHER THAN THE PUBLIC MUTATIONS, which need a Better
 * Auth session the harness cannot mint (wordle-teams-obw). The *For helpers hold
 * all the logic for exactly this reason; the public wrappers only supply a
 * player id.
 */
const modules = import.meta.glob('./**/*.ts')
const TTL = PROPOSAL_TTL_DAYS * 24 * 60 * 60 * 1000

/**
 * FROZEN CLOCK for the dated describes. `today` is the accepter's local day and
 * requirePlausibleToday bounds it to +-1 day of the server's, so a hardcoded date
 * would start failing by itself with INVALID_DATE. The expected window stays
 * literal rather than derived from windowFor, which would be tautological.
 * The hooks live INSIDE each dated describe, not at file scope.
 */
const NOW = new Date('2026-10-04T12:00:00Z')
const today = '2026-10-04'

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

/**
 * A second player on a third team, to accept as somebody else.
 *
 * ⚠️ THE EMAIL OVERRIDE IS LOAD-BEARING, NOT COSMETIC. aPlayer()'s default email
 * is 'member@example.com', and access.ts's playerForEmail resolves by_email with
 * `.first()` — so two players rows sharing that address make requirePlayer
 * silently resolve to whichever Convex returns first. Every extra player seeded
 * in this file MUST override `email`.
 */
async function seedAccepter(ctx: Ctx) {
  const accepterId = await ctx.db.insert('players', aPlayer({ email: 'accepter@example.com' }))
  const theirTeamId = await ctx.db.insert(
    'teams',
    aTeam({ legacyId: 600, name: 'Theirs', playerIds: [accepterId], owner: accepterId }),
  )
  return { accepterId, theirTeamId }
}

describe('acceptChallengeFor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('any member of the opponent team may accept, with no Pro', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })

      await acceptChallengeFor(ctx, accepterId, id, today)

      const doc = await ctx.db.get(id)
      expect(doc?.status).toBe('active')
      expect(doc?.acceptedBy).toBe(accepterId)
      expect(doc?.startDay).toBe('2026-10-05')
      expect(doc?.endDay).toBe('2026-10-31')
    })
  })

  test('a non-member of the opponent team may not accept', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(acceptChallengeFor(ctx, playerId, id, today)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  // A DECLINED PROPOSAL, which the status guard catches but nothing seeded. The
  // suite otherwise never writes 'declined' or 'expired' at all, so guard 1's
  // coverage was one status out of the five it refuses.
  test('a declined challenge may not be accepted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'declined',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(acceptChallengeFor(ctx, accepterId, id, today)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
    })
  })

  test('an expired proposal may not be accepted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        // === now, not now - 1: pins the <= boundary (the clock is frozen)
        expiresAt: Date.now(),
        createdAt: Date.now(),
      })
      await expect(acceptChallengeFor(ctx, accepterId, id, today)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
    })
  })

  // THE OFF-BY-ONE THAT NO PRESCRIBED TEST COULD SEE. The pending row being
  // accepted is itself counted by liveChallengeCountFor, so without `exceptId`
  // a proposal made in a team's FIFTH and last slot could never be activated —
  // it would be permanently pending. MAX - 1 others plus this one is exactly MAX.
  test('the proposal being accepted does not count ITSELF against either cap', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES - 1; i++) {
        const otherId = await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 900 + i, name: `c${i}` }),
        )
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId: otherId,
          proposedBy: playerId,
          status: 'active',
          expiresAt: Date.now() + TTL,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await acceptChallengeFor(ctx, accepterId, id, today)
      expect((await ctx.db.get(id))?.status).toBe('active')
    })
  })

  // §8.1 AT ACCEPTANCE: each blocking state is seeded AFTER the pending row, so
  // it reads as "re-checked at acceptance" rather than "refused at propose time".
  // Deleting the requireChallengeablePair call from acceptChallengeFor passes
  // every other accept test.
  test('an opponent that turned challenges OFF while pending is refused at acceptance', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await ctx.db.patch(theirTeamId, { acceptsChallenges: false })
      await expect(acceptChallengeFor(ctx, accepterId, id, today)).rejects.toMatchObject({
        data: { code: 'CHALLENGES_REFUSED' },
      })
    })
  })

  test('an opponent that FILLED UP while pending is refused at acceptance', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES; i++) {
        const otherId = await ctx.db.insert('teams', aTeam({ legacyId: 1000 + i, name: `f${i}` }))
        await ctx.db.insert('teamChallenges', {
          challengerTeamId: otherId,
          opponentTeamId: theirTeamId,
          proposedBy: accepterId,
          status: 'active',
          expiresAt: Date.now() + TTL,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      await expect(acceptChallengeFor(ctx, accepterId, id, today)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LIMIT_REACHED' },
      })
    })
  })

  test('a pair that gained another live challenge while pending is refused at acceptance', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await ctx.db.insert('teamChallenges', {
        challengerTeamId: theirTeamId,
        opponentTeamId: challengerTeamId,
        proposedBy: accepterId,
        status: 'active',
        expiresAt: Date.now() + TTL,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        createdAt: Date.now(),
      })
      await expect(acceptChallengeFor(ctx, accepterId, id, today)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_EXISTS' },
      })
    })
  })

  // THE opponentTeamId GUARD. Without it requireTeamMemberFor is handed
  // undefined and ctx.db.get(undefined) is what the caller sees instead.
  test('a link proposal cannot be accepted through the direct path', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId } = await seedAccepter(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      const doc = await ctx.db
        .query('teamChallenges')
        .withIndex('by_token', (q) => q.eq('token', token))
        .unique()
      await expect(
        acceptChallengeFor(ctx, accepterId, doc!._id, today),
      ).rejects.toMatchObject({ data: { code: 'INVALID_TEAM' } })
    })
  })

  test('an already-active challenge may not be accepted again', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(acceptChallengeFor(ctx, accepterId, id, today)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
    })
  })
})

describe('claimChallengeLinkFor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('binds the opponent and activates', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)

      const id = await claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today)

      const doc = await ctx.db.get(id)
      expect(doc?.status).toBe('active')
      expect(doc?.opponentTeamId).toBe(theirTeamId)
      expect(doc?.startDay).toBe('2026-10-05')
    })
  })

  test('an unknown token is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, 'nope', theirTeamId, today),
      ).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LINK_INVALID' },
      })
    })
  })

  // DESIGN §8.1 — THE BYPASS THAT MUST NOT EXIST.
  test('a link CANNOT bypass the claiming team refusing challenges', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await ctx.db.patch(theirTeamId, { acceptsChallenges: false })
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today),
      ).rejects.toMatchObject({
        data: { code: 'CHALLENGES_REFUSED' },
      })
    })
  })

  test('a link CANNOT bypass the claiming team being at its cap', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES; i++) {
        const otherId = await ctx.db.insert('teams', aTeam({ legacyId: 700 + i, name: `o${i}` }))
        await ctx.db.insert('teamChallenges', {
          challengerTeamId: otherId,
          opponentTeamId: theirTeamId,
          proposedBy: accepterId,
          status: 'active',
          expiresAt: Date.now() + TTL,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today),
      ).rejects.toMatchObject({
        data: { code: 'CHALLENGE_LIMIT_REACHED' },
      })
    })
  })

  test('a link CANNOT bypass the one-live-challenge-per-pair rule', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        expiresAt: Date.now() + TTL,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        createdAt: Date.now(),
      })
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today),
      ).rejects.toMatchObject({
        data: { code: 'CHALLENGE_EXISTS' },
      })
    })
  })

  // AN EMPTY TOKEN IS REFUSED — and note what this does NOT prove. '' is not
  // undefined, so the probe matches nothing and returns null, and the code is
  // CHALLENGE_LINK_INVALID with or without the guard. Measured: deleting the
  // guard leaves this test green. It is kept because '' reaching here from a
  // route param is the likely shape and the answer should be the link code
  // rather than some incidental error — but the test below is the one that
  // actually pins the guard.
  test('an empty token is refused', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(
        claimChallengeLinkFor(ctx, accepterId, '', theirTeamId, today),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_LINK_INVALID' } })
    })
  })

  // THE GUARD'S REAL HAZARD, and the only test that can kill it. teamChallenges
  // .token is OPTIONAL, so every DIRECT proposal keys on `undefined` in by_token
  // — and MEASURED: probing with undefined against two tokenless rows makes
  // .unique() throw "not unique", a confusing failure a long way from its cause.
  // The `string` signature makes undefined unreachable from TypeScript, which is
  // exactly why it needs `as never` and why the empty-string test above cannot
  // substitute. Task 13 feeds this from a route param, where a runtime undefined
  // is a real arrival.
  test('an undefined token is refused before the index is probed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      // TWO tokenless rows, so an unguarded probe matches both and .unique()
      // throws rather than returning.
      for (const opponentTeamId of [theirTeamId, challengerTeamId]) {
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId,
          proposedBy: playerId,
          status: 'pending',
          expiresAt: Date.now() + TTL,
          createdAt: Date.now(),
        })
      }
      await expect(
        claimChallengeLinkFor(ctx, accepterId, undefined as never, theirTeamId, today),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_LINK_INVALID' } })
    })
  })

  // THE CLAIM PATH'S STATUS GUARD. Without it the second claim RESOLVES:
  // activate's { opponentTeamId } overwrites the row, reassigning team B's active
  // challenge to team C, and the token stays reusable. The opponentTeamId
  // assertion is the one that matters: it separates "refused" from "refused after
  // the damage".
  test('a link already claimed cannot be claimed again, and the first claimant keeps it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const thirdId = await ctx.db.insert('players', aPlayer({ email: 'third@example.com' }))
      const thirdTeamId = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 650, name: 'Third', playerIds: [thirdId], owner: thirdId }),
      )
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      const id = await claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today)
      await expect(
        claimChallengeLinkFor(ctx, thirdId, token, thirdTeamId, today),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_LINK_INVALID' } })
      const doc = await ctx.db.get(id)
      expect(doc?.opponentTeamId).toBe(theirTeamId)
      expect(doc?.acceptedBy).toBe(accepterId)
    })
  })

  // THE CLAIM PATH'S expiresAt GUARD: without it PROPOSAL_TTL_DAYS is void on links.
  test('an expired link cannot be claimed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        proposedBy: playerId,
        status: 'pending',
        token: 'expired-token',
        expiresAt: Date.now() - 1,
        createdAt: Date.now(),
      })
      await expect(
        claimChallengeLinkFor(ctx, accepterId, 'expired-token', theirTeamId, today),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_LINK_INVALID' } })
    })
  })

  // THE CLAIM PATH'S exceptId: the link row is returned by by_challenger_and_status,
  // so without the exclusion a link minted in the fifth slot can never be claimed.
  test('a link minted in the challenger\'s last slot can still be claimed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      for (let i = 0; i < MAX_ACTIVE_CHALLENGES - 1; i++) {
        const otherId = await ctx.db.insert('teams', aTeam({ legacyId: 1100 + i, name: `l${i}` }))
        await ctx.db.insert('teamChallenges', {
          challengerTeamId,
          opponentTeamId: otherId,
          proposedBy: playerId,
          status: 'active',
          expiresAt: Date.now() + TTL,
          startDay: '2026-10-05',
          endDay: '2026-10-31',
          createdAt: Date.now(),
        })
      }
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      const id = await claimChallengeLinkFor(ctx, accepterId, token, theirTeamId, today)
      expect((await ctx.db.get(id))?.status).toBe('active')
    })
  })

  // NOT_A_MEMBER must win over a bad token, or it is a token-validity oracle.
  test('membership is checked before the token, so NOT_A_MEMBER cannot reveal a live token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId } = await seedAccepter(ctx)
      const strangersTeam = await ctx.db.insert('teams', aTeam({ legacyId: 820, name: 'Strangers2' }))
      const live = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      for (const token of [live, 'bogus']) {
        await expect(
          claimChallengeLinkFor(ctx, accepterId, token, strangersTeam, today),
        ).rejects.toMatchObject({ data: { code: 'NOT_A_MEMBER' } })
      }
    })
  })

  // THE SELF-CLAIM, and Task 5's duplicate-unreachability argument rests on it:
  // liveChallengesFor returns a row twice if a team is on both sides, which
  // would inflate every cap count thereafter. The claim path is the SECOND way
  // to reach that state and the only one nothing asserted.
  test("you cannot claim your own team's link", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, playerId, token, challengerTeamId, today),
      ).rejects.toMatchObject({ data: { code: 'INVALID_TEAM' } })
    })
  })

  test('you cannot claim on behalf of a team you are not on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId } = await seedAccepter(ctx)
      const strangersTeam = await ctx.db.insert('teams', aTeam({ legacyId: 800, name: 'Strangers' }))
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)
      await expect(
        claimChallengeLinkFor(ctx, accepterId, token, strangersTeam, today),
      ).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})

describe('declineChallengeFor', () => {
  test('a member of the challenged team declines', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await declineChallengeFor(ctx, accepterId, id)
      expect((await ctx.db.get(id))?.status).toBe('declined')
    })
  })

  test('a declined challenge frees its slot', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await declineChallengeFor(ctx, accepterId, id)
      expect(await liveChallengeCountFor(ctx, challengerTeamId)).toBe(0)
    })
  })
})

describe('declineChallengeFor guards', () => {
  // Without the status guard a member could "decline" a LIVE contest and flip it
  // to 'declined', ending it as though it were never agreed to.
  test('an ACTIVE challenge cannot be declined', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(declineChallengeFor(ctx, accepterId, id)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
      expect((await ctx.db.get(id))?.status).toBe('active')
    })
  })

  // A link proposal has no opponent bound, so there is no team whose member could
  // decline it. Refused with an accessError rather than a crash inside the lookup.
  test('a link proposal with no opponent cannot be declined', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(declineChallengeFor(ctx, accepterId, id)).rejects.toMatchObject({
        data: { code: 'INVALID_TEAM' },
      })
    })
  })
})

describe('withdrawChallengeFor', () => {
  test('the proposer withdraws their own pending proposal', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await withdrawChallengeFor(ctx, playerId, id)
      expect((await ctx.db.get(id))?.status).toBe('withdrawn')
    })
  })

  test('an unrelated member cannot withdraw it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(withdrawChallengeFor(ctx, accepterId, id)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  // NOT_TEAM_OWNER, NOT NOT_A_MEMBER. The test above uses seedAccepter's player,
  // who is on NO team of the challenger's, so requireTeamOwnerFor refuses at its
  // FIRST line and the owner branch's second line is never reached. This is the
  // only assertion that gets there.
  test('a member of the challenging team who did not propose it cannot withdraw', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const bystander = await ctx.db.insert(
        'players',
        aPlayer({ email: 'bystander@example.com', legacyId: '33333333-3333-4333-8333-333333333333' }),
      )
      const team = await ctx.db.get(challengerTeamId)
      await ctx.db.patch(challengerTeamId, { playerIds: [...(team?.playerIds ?? []), bystander] })
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(withdrawChallengeFor(ctx, bystander, id)).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })

  // THE ELSE BRANCH. seedTwoTeams' player is proposer AND owner, so the
  // happy-path test above cannot tell the two branches apart — a mutant
  // collapsing the if to a single requireTeamOwnerFor survives it, silently
  // taking withdrawal away from every non-owner proposer.
  test('a NON-OWNER proposer withdraws their own proposal', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const proposer = await ctx.db.insert(
        'players',
        aPlayer({ email: 'proposer@example.com', legacyId: '44444444-4444-4444-8444-444444444444' }),
      )
      const team = await ctx.db.get(challengerTeamId)
      await ctx.db.patch(challengerTeamId, { playerIds: [...(team?.playerIds ?? []), proposer] })
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: proposer,
        status: 'pending',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await withdrawChallengeFor(ctx, proposer, id)
      expect((await ctx.db.get(id))?.status).toBe('withdrawn')
    })
  })

  test('an ACTIVE challenge cannot be withdrawn — that is cancel', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const id = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'active',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now() + TTL,
        createdAt: Date.now(),
      })
      await expect(withdrawChallengeFor(ctx, playerId, id)).rejects.toMatchObject({
        data: { code: 'CHALLENGE_NOT_PENDING' },
      })
    })
  })
})

describe('setAcceptsChallengesFor', () => {
  test('the owner turns incoming challenges off', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      await setAcceptsChallengesFor(ctx, playerId, challengerTeamId, false)
      expect((await ctx.db.get(challengerTeamId))?.acceptsChallenges).toBe(false)
    })
  })

  // EXPLICIT true, not absence. requireChallengeablePair reads `=== false`, so
  // both representations of "yes" must round-trip — and a mutant hardcoding
  // { acceptsChallenges: false } survives a suite that only ever asserts false.
  test('the owner turns incoming challenges back on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      await ctx.db.patch(challengerTeamId, { acceptsChallenges: false })
      await setAcceptsChallengesFor(ctx, playerId, challengerTeamId, true)
      expect((await ctx.db.get(challengerTeamId))?.acceptsChallenges).toBe(true)
    })
  })

  test('a non-owner member cannot', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { challengerTeamId } = await seedTwoTeams(ctx)
      const otherId = await ctx.db.insert('players', aPlayer({ email: 'other@example.com' }))
      const team = await ctx.db.get(challengerTeamId)
      await ctx.db.patch(challengerTeamId, { playerIds: [...(team?.playerIds ?? []), otherId] })
      await expect(
        setAcceptsChallengesFor(ctx, otherId, challengerTeamId, false),
      ).rejects.toMatchObject({
        data: { code: 'NOT_TEAM_OWNER' },
      })
    })
  })
})

type SeedDay = { puzzleDay: string; entries: Array<{ playerId: Id<'players'>; attempts: number }> }

/** One teamMonthStats document. `members` is left empty: the projection reads days[] only. */
async function seedStats(
  ctx: Ctx,
  teamId: Id<'teams'>,
  month: { year: number; month: number },
  days: Array<SeedDay>,
) {
  await ctx.db.insert('teamMonthStats', {
    teamId,
    year: month.year,
    month: month.month,
    members: [],
    days,
    computedAt: Date.now(),
  })
}

const OCTOBER = { year: 2026, month: 10 }

/**
 * `count` boards of `attempts` each for one player, on consecutive October days
 * from the 5th. The window under test starts on the 5th, so every one is inside it.
 */
function octoberDays(playerId: Id<'players'>, attempts: number, count: number): Array<SeedDay> {
  // 5 + count - 1 must stay a real October day. MIN_CHALLENGE_BOARDS is 10 today;
  // if it ever passes 25 this helper needs a second month, and should say so loudly.
  if (count > 27) throw new Error('octoberDays: count runs past October 31')
  return Array.from({ length: count }, (_, i) => ({
    puzzleDay: `2026-10-${String(i + 5).padStart(2, '0')}`,
    entries: [{ playerId, attempts }],
  }))
}

/** Comfortably above the floor, derived rather than written as 12. */
const ENOUGH = MIN_CHALLENGE_BOARDS + 2

async function seedActive(
  ctx: Ctx,
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
  proposedBy: Id<'players'>,
  window = { startDay: '2026-10-05', endDay: '2026-10-31' },
) {
  const id = await ctx.db.insert('teamChallenges', {
    challengerTeamId,
    opponentTeamId,
    proposedBy,
    status: 'active',
    ...window,
    expiresAt: Date.now() + TTL,
    createdAt: Date.now(),
  })
  return (await ctx.db.get(id))!
}

describe('challengeScoreboardFor', () => {
  // BOTH DIRECTIONS, AND THAT IS WHAT PINS THE ARGUMENT ORDER. outcomeOf's two
  // parameters are structurally identical, so a transposed call compiles. These
  // two tests are the only thing that sees it at the query level.
  test('the lower average wins: challenger 3 against opponent 4', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, ENOUGH))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger).toMatchObject({
        teamId: challengerTeamId,
        teamName: 'Challengers',
        boards: ENOUGH,
        attempts: 3 * ENOUGH,
        average: 3,
      })
      expect(board.opponent).toMatchObject({ teamId: theirTeamId, teamName: 'Theirs', average: 4 })
      expect(board.outcome).toBe('challenger')
    })
  })

  test('the lower average wins: challenger 4 against opponent 3', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 4, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 3, ENOUGH))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.outcome).toBe('opponent')
    })
  })

  test('a side exactly AT the board floor is judged', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, MIN_CHALLENGE_BOARDS))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.opponent.boards).toBe(MIN_CHALLENGE_BOARDS)
      expect(board.outcome).toBe('challenger')
    })
  })

  test('a side one board BELOW the floor makes the result void', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, MIN_CHALLENGE_BOARDS - 1))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.outcome).toBe('void')
    })
  })

  test('boards before startDay are excluded — the retroactivity guard, end to end', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-01', entries: [{ playerId, attempts: 1 }] },
        { puzzleDay: '2026-10-04', entries: [{ playerId, attempts: 1 }] },
        ...octoberDays(playerId, 3, ENOUGH),
      ])
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, ENOUGH))

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger.boards).toBe(ENOUGH)
      expect(board.challenger.average).toBe(3) // not pulled down by the 1-attempt days
    })
  })

  test('reads BOTH monthly documents when the window crosses a month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-28', entries: [{ playerId, attempts: 3 }] },
      ])
      await seedStats(ctx, challengerTeamId, { year: 2026, month: 11 }, [
        { puzzleDay: '2026-11-01', entries: [{ playerId, attempts: 5 }] },
      ])
      await seedStats(ctx, theirTeamId, { year: 2026, month: 11 }, [
        { puzzleDay: '2026-11-01', entries: [{ playerId: accepterId, attempts: 5 }] },
      ])

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId, {
          startDay: '2026-10-28',
          endDay: '2026-11-30',
        }),
      )
      // 3 + 5 over two boards: one from EACH document. Reading only the start
      // month gives 1 board / 3 attempts; only the end month, 1 board / 5.
      expect(board.challenger.boards).toBe(2)
      expect(board.challenger.attempts).toBe(8)
      // The opponent has no October document at all — absent, not an error.
      expect(board.opponent.boards).toBe(1)
    })
  })

  test('reads EVERY month a window spans, not just its two ends', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // NO WINDOW SPANS THREE MONTHS TODAY — windowFor's short-window rule
      // reaches one month further at most. This pins the enumeration so a rule
      // that ever grows does not silently drop the middle month from both the
      // live board and the frozen snapshot.
      for (const [month, puzzleDay] of [[10, '2026-10-28'], [11, '2026-11-15'], [12, '2026-12-02']] as const) {
        await seedStats(ctx, challengerTeamId, { year: 2026, month }, [
          { puzzleDay, entries: [{ playerId, attempts: 3 }] },
        ])
      }

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId, {
          startDay: '2026-10-28',
          endDay: '2026-12-31',
        }),
      )
      expect(board.challenger.boards).toBe(3)
    })
  })

  test('the scoreboard carries its window, already narrowed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      // TYPED string, not string | undefined: the page renders "since <startDay>"
      // and should not need a non-null assertion to do it.
      const window: { startDay: string; endDay: string } = board
      expect(window).toMatchObject({ startDay: '2026-10-05', endDay: '2026-10-31' })
    })
  })

  test('a missing monthly document is zero boards, not a throw', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger.boards).toBe(0)
      expect(board.challenger.average).toBeNull()
      expect(board.challenger.members).toEqual([])
      expect(board.outcome).toBe('void')
    })
  })

  test('member rows lead with the lowest average, and more boards break a tie', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const second = await ctx.db.insert('players', aPlayer({ email: 'second@example.com' }))
      const third = await ctx.db.insert('players', aPlayer({ email: 'third@example.com' }))
      // FIRST-SEEN ORDER IS playerId, second, third — the order teamTotalsOver
      // emits. Expected is third, second, playerId: a missing sort gives the
      // first-seen order, and a reversed tiebreak gives third, playerId, second,
      // so neither can pass.
      //   playerId: 4,4      -> 4.0 over 2
      //   second:   4,4,4    -> 4.0 over 3   (ties playerId, more boards)
      //   third:    3        -> 3.0 over 1   (lowest average)
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-05', entries: [{ playerId, attempts: 4 }, { playerId: second, attempts: 4 }] },
        { puzzleDay: '2026-10-06', entries: [{ playerId, attempts: 4 }, { playerId: second, attempts: 4 }] },
        { puzzleDay: '2026-10-07', entries: [{ playerId: second, attempts: 4 }, { playerId: third, attempts: 3 }] },
      ])

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger.members.map((m) => m.playerId)).toEqual([third, second, playerId])
      expect(board.challenger.members[0]).toEqual({
        playerId: third,
        name: 'Former member',
        boards: 1,
        attempts: 3,
        average: 3,
      })
    })
  })

  test('member rows carry display names, with an initial only on a first-name collision', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx) // Ada Lovelace
      const { theirTeamId } = await seedAccepter(ctx)
      const adaB = await ctx.db.insert('players', aPlayer({ email: 'adab@example.com', lastName: 'Byron' }))
      const bo = await ctx.db.insert('players', aPlayer({ email: 'bo@example.com', firstName: 'Bo' }))
      // adaB IS ON THE ROSTER AND PLAYS NOTHING: the collision set is the whole
      // roster, so playerId is still 'Ada L'.
      await ctx.db.patch(challengerTeamId, { playerIds: [playerId, adaB, bo] })
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-05', entries: [{ playerId, attempts: 3 }, { playerId: bo, attempts: 4 }] },
      ])

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger.members.map((m) => m.name)).toEqual(['Ada L', 'Bo'])
    })
  })

  test('a row for a player no longer on the roster is a former member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const gone = await ctx.db.insert('players', aPlayer({ email: 'gone@example.com', firstName: 'Gus' }))
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-05', entries: [{ playerId: gone, attempts: 3 }] },
      ])

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      // 'Former member', NOT 'Gus': the row's player document exists, but they
      // are not on this roster, so naming them would be a lookup of anyone's id.
      expect(board.challenger.members).toEqual([
        { playerId: gone, name: 'Former member', boards: 1, attempts: 3, average: 3 },
      ])
    })
  })

  test('a roster id whose player document is gone is skipped, not a crash', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // A DANGLING ROSTER ID: nothing in the app should leave one, but a crash
      // here would take down the whole team page's Challenges section.
      const ghost = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.com' }))
      await ctx.db.patch(challengerTeamId, { playerIds: [playerId, ghost] })
      await ctx.db.delete(ghost)
      await seedStats(ctx, challengerTeamId, OCTOBER, [
        { puzzleDay: '2026-10-05', entries: [{ playerId, attempts: 3 }] },
      ])

      const board = await challengeScoreboardFor(
        ctx,
        await seedActive(ctx, challengerTeamId, theirTeamId, playerId),
      )
      expect(board.challenger.members.map((m) => m.name)).toEqual(['Ada'])
    })
  })

  test('a challenge that is not active is refused with CHALLENGE_NOT_ACTIVE', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // A CLOSED ROW STILL HAS ITS WINDOW AND ITS OPPONENT. So this is refused
      // by the status check and nothing else — a pending row with no startDay
      // would be refused by the narrowing below it too, and could not tell the
      // two apart. (Cancel is not a status: a cancelled challenge is 'closed'.)
      const active = await seedActive(ctx, challengerTeamId, theirTeamId, playerId)
      await ctx.db.patch(active._id, { status: 'closed' })
      await expect(
        challengeScoreboardFor(ctx, (await ctx.db.get(active._id))!),
      ).rejects.toMatchObject({ data: { code: 'CHALLENGE_NOT_ACTIVE' } })
    })
  })

  test('an active challenge whose team row is gone is refused with INVALID_TEAM', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      const active = await seedActive(ctx, challengerTeamId, theirTeamId, playerId)
      // UNREACHABLE ONCE TASK 11 CLOSES A TEAM'S CHALLENGES BEFORE DELETING IT.
      // Pinned so the guard is a known refusal rather than a crash on a null
      // team's `.name` if that ordering is ever lost.
      await ctx.db.delete(theirTeamId)
      await expect(challengeScoreboardFor(ctx, active)).rejects.toMatchObject({
        data: { code: 'INVALID_TEAM' },
      })
    })
  })
})

/** A closed row with a result, from challengerTeamId's point of view as the challenger. */
function closedRow(
  challengerTeamId: Id<'teams'>,
  opponentTeamId: Id<'teams'>,
  proposedBy: Id<'players'>,
  outcome: ChallengeOutcome,
  { challengerName = 'Challengers', opponentName = 'Theirs', closedAt = Date.now() } = {},
) {
  return {
    challengerTeamId,
    opponentTeamId,
    proposedBy,
    status: 'closed' as const,
    startDay: '2026-10-05',
    endDay: '2026-10-31',
    expiresAt: Date.now(),
    createdAt: Date.now(),
    result: {
      challenger: { teamId: challengerTeamId, name: challengerName, boards: ENOUGH, attempts: 3 * ENOUGH, average: 3, members: [] },
      opponent: { teamId: opponentTeamId, name: opponentName, boards: ENOUGH, attempts: 4 * ENOUGH, average: 4, members: [] },
      outcome,
      closedAt,
    },
  }
}

describe('headToHeadFor', () => {
  test('void counts as neither a win nor a loss', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      for (const outcome of ['challenger', 'opponent', 'tie', 'void'] as const) {
        await ctx.db.insert('teamChallenges', closedRow(challengerTeamId, theirTeamId, playerId, outcome))
      }

      expect(await headToHeadFor(ctx, challengerTeamId)).toEqual([
        {
          opponentTeamId: theirTeamId,
          opponentName: 'Theirs',
          record: { won: 1, lost: 1, tied: 1, noResult: 1 },
        },
      ])
    })
  })

  test("the record is from the VIEWING team's side", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', closedRow(challengerTeamId, theirTeamId, playerId, 'challenger'))

      expect(await headToHeadFor(ctx, challengerTeamId)).toEqual([
        { opponentTeamId: theirTeamId, opponentName: 'Theirs', record: { won: 1, lost: 0, tied: 0, noResult: 0 } },
      ])
      // From the other side the same row is a loss, labelled with the OTHER name.
      expect(await headToHeadFor(ctx, theirTeamId)).toEqual([
        { opponentTeamId: challengerTeamId, opponentName: 'Challengers', record: { won: 0, lost: 1, tied: 0, noResult: 0 } },
      ])
    })
  })

  test('each opponent gets its own tally', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId, opponentTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // OLDER INSERTED FIRST. The index returns rows in creation order, so
      // inserting newest-first would make the Map's insertion order already
      // match the expected order and a deleted sort would pass unnoticed.
      await ctx.db.insert(
        'teamChallenges',
        closedRow(challengerTeamId, opponentTeamId, playerId, 'opponent', { opponentName: 'Opponents', closedAt: 1000 }),
      )
      await ctx.db.insert(
        'teamChallenges',
        closedRow(challengerTeamId, theirTeamId, playerId, 'challenger', { closedAt: 2000 }),
      )

      // MOST RECENTLY PLAYED FIRST.
      expect(await headToHeadFor(ctx, challengerTeamId)).toEqual([
        { opponentTeamId: theirTeamId, opponentName: 'Theirs', record: { won: 1, lost: 0, tied: 0, noResult: 0 } },
        { opponentTeamId, opponentName: 'Opponents', record: { won: 0, lost: 1, tied: 0, noResult: 0 } },
      ])
    })
  })

  test('the label is the name from the most recent close, not the first one found', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // THREE ROWS, NEWEST IN THE MIDDLE. Rows come back in creation order, so
      // first-found is 'Original', last-found is 'Interim' and most recent is
      // 'Renamed' — all three disagree. With two rows, one insertion order lets
      // first-found-wins pass and the other lets last-found-wins pass; each
      // mutant survived one version of this test.
      for (const [opponentName, closedAt] of [['Original', 1000], ['Renamed', 3000], ['Interim', 2000]] as const) {
        await ctx.db.insert(
          'teamChallenges',
          closedRow(challengerTeamId, theirTeamId, playerId, 'tie', { opponentName, closedAt }),
        )
      }

      const [entry] = await headToHeadFor(ctx, challengerTeamId)
      expect(entry.opponentName).toBe('Renamed')
      expect(entry.record.tied).toBe(3)
    })
  })

  test("an 'opponent' outcome is a win for the team that was challenged", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', closedRow(challengerTeamId, theirTeamId, playerId, 'opponent'))

      expect(await headToHeadFor(ctx, theirTeamId)).toEqual([
        { opponentTeamId: challengerTeamId, opponentName: 'Challengers', record: { won: 1, lost: 0, tied: 0, noResult: 0 } },
      ])
    })
  })

  test('a closed row with no result is skipped, and live rows are never counted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      // SPEC §13: result-present <=> status-closed is load-bearing and not
      // expressible in the schema. A row breaking it must vanish from the record,
      // not appear as an opponent with an all-zero tally.
      await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'closed',
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        expiresAt: Date.now(),
        createdAt: Date.now(),
      })
      await seedActive(ctx, challengerTeamId, theirTeamId, playerId)

      expect(await headToHeadFor(ctx, challengerTeamId)).toEqual([])
    })
  })
})

describe('challengesForTeamFor', () => {
  test('a free member gets both averages, both board counts and the outcome — and no member rows', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx, { pro: false })
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, ENOUGH))
      const challenge = await seedActive(ctx, challengerTeamId, theirTeamId, playerId)

      const view = await challengesForTeamFor(ctx, playerId, challengerTeamId)
      expect(view.pro).toBe(false)
      expect(view.active).toHaveLength(1)
      const [row] = view.active
      expect(row).toMatchObject({
        challengeId: challenge._id,
        startDay: '2026-10-05',
        endDay: '2026-10-31',
        viewerIsChallenger: true,
      })
      expect(row.challenger).toMatchObject({ boards: ENOUGH, average: 3, members: [] })
      expect(row.opponent).toMatchObject({ boards: ENOUGH, average: 4, members: [] })
      expect(row.outcome).toBe('challenger')
      // NAMES ARE STRIPPED WITH THE ROWS: both rosters are Ada Lovelace.
      expect(JSON.stringify(view)).not.toContain('Ada')
    })
  })

  test('a Pro member gets the member rows on both sides', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      await seedStats(ctx, challengerTeamId, OCTOBER, octoberDays(playerId, 3, ENOUGH))
      await seedStats(ctx, theirTeamId, OCTOBER, octoberDays(accepterId, 4, ENOUGH))
      await seedActive(ctx, challengerTeamId, theirTeamId, playerId)

      const view = await challengesForTeamFor(ctx, playerId, challengerTeamId)
      expect(view.pro).toBe(true)
      expect(view.active[0].challenger.members.map((m) => m.playerId)).toEqual([playerId])
      expect(view.active[0].opponent.members.map((m) => m.playerId)).toEqual([accepterId])
    })
  })

  test('viewed from the challenged team, the viewer is not the challenger', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const challenge = await seedActive(ctx, challengerTeamId, theirTeamId, playerId)

      const view = await challengesForTeamFor(ctx, accepterId, theirTeamId)
      expect(view.active).toHaveLength(1)
      expect(view.active[0]).toMatchObject({ challengeId: challenge._id, viewerIsChallenger: false })
    })
  })

  test('a non-member is refused with NOT_A_MEMBER', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId } = await seedAccepter(ctx)
      await expect(
        challengesForTeamFor(ctx, accepterId, challengerTeamId),
      ).rejects.toMatchObject({ data: { code: 'NOT_A_MEMBER' } })
    })
  })

  test('an incoming proposal is labelled, carries no numbers, and no token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { accepterId, theirTeamId } = await seedAccepter(ctx)
      const expiresAt = Date.now() + TTL
      const challengeId = await ctx.db.insert('teamChallenges', {
        challengerTeamId,
        opponentTeamId: theirTeamId,
        proposedBy: playerId,
        status: 'pending',
        expiresAt,
        createdAt: Date.now(),
      })

      const view = await challengesForTeamFor(ctx, accepterId, theirTeamId)
      // toEqual, NOT toMatchObject: an EXACT shape, so a field added later — a
      // token, a board count — fails here rather than shipping. AC3: nothing
      // numeric about either team renders before acceptance.
      expect(view.pending).toEqual([
        {
          challengeId,
          direction: 'incoming',
          otherTeamName: 'Challengers',
          isLink: false,
          expiresAt,
          proposedByViewer: false,
        },
      ])
      expect(view.active).toEqual([])
    })
  })

  test('an outgoing link proposal has no opponent name and does not re-ship its token', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const token = await proposeByLinkFor(ctx, playerId, challengerTeamId)

      const view = await challengesForTeamFor(ctx, playerId, challengerTeamId)
      expect(view.pending).toHaveLength(1)
      expect(view.pending[0]).toMatchObject({
        direction: 'outgoing',
        otherTeamName: null,
        isLink: true,
        proposedByViewer: true,
      })
      expect(JSON.stringify(view)).not.toContain(token)
    })
  })

  test('the head-to-head record is part of the answer', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const { playerId, challengerTeamId } = await seedTwoTeams(ctx)
      const { theirTeamId } = await seedAccepter(ctx)
      await ctx.db.insert('teamChallenges', closedRow(challengerTeamId, theirTeamId, playerId, 'void'))

      const view = await challengesForTeamFor(ctx, playerId, challengerTeamId)
      expect(view.records).toEqual([
        { opponentTeamId: theirTeamId, opponentName: 'Theirs', record: { won: 0, lost: 0, tied: 0, noResult: 1 } },
      ])
    })
  })
})

// SPEC §13. ChallengeOutcome is declared twice — a TS union in lib/challenge.ts
// and four v.literals in schema.ts — and lib/challenge.ts must stay import-free,
// so the duplication is unavoidable. This makes the drift a TYPECHECK failure.
// It is a no-op at runtime: `pnpm typecheck` is what kills its mutant, not vitest.
test('ChallengeOutcome is exactly the schema result.outcome union', () => {
  expectTypeOf<ChallengeOutcome>().toEqualTypeOf<
    NonNullable<Doc<'teamChallenges'>['result']>['outcome']
  >()
})

describe('the CHALLENGES_ENABLED gate', () => {
  /**
   * The non-comment lines of `export const <name>`'s handler, up to the next
   * top-level export. The WHOLE body, not just its first line: a not-gated test
   * that read only the first line passed with the gate on the second.
   */
  function handlerLines(source: string, name: string): string[] {
    const start = source.indexOf(`export const ${name} = `)
    expect(start, `no export const ${name}`).toBeGreaterThan(-1)
    const rest = source.slice(start)
    const end = rest.indexOf('\nexport ', 1)
    const body = (end === -1 ? rest : rest.slice(0, end)).split(/handler: async \(.*?\) => \{/)[1]
    expect(body, `no handler in ${name}`).toBeDefined()
    return body!
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('//'))
  }

  const firstHandlerLine = (source: string, name: string) => handlerLines(source, name)[0]

  // THE FIVE THAT START, ACTIVATE OR DISPLAY A CHALLENGE. Decline, withdraw,
  // cancel and the owner's switch are deliberately NOT gated: they only end or
  // refuse, and switching the feature off must not strand a running challenge.
  test.each(['proposeToTeam', 'proposeByLink', 'acceptChallenge', 'claimChallengeLink', 'challengesForTeam'])(
    '%s checks CHALLENGES_ENABLED first',
    async (name) => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./challenges.ts', import.meta.url), 'utf8')
      expect(firstHandlerLine(source, name)).toContain('challengesEnabled(process.env.CHALLENGES_ENABLED)')
    },
  )

  // THE MUTATIONS REFUSE; THE QUERY ANSWERS. A query that threw on a dark
  // deployment would put the team page into its error boundary, so it must
  // RETURN { enabled: false }. Wrappers cannot be driven (wordle-teams-obw),
  // so this is pinned in source like the gate's position.
  test.each(['proposeToTeam', 'proposeByLink', 'acceptChallenge', 'claimChallengeLink'])(
    '%s refuses with CHALLENGES_DISABLED',
    async (name) => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./challenges.ts', import.meta.url), 'utf8')
      expect(firstHandlerLine(source, name)).toContain("throw accessError('CHALLENGES_DISABLED')")
    },
  )

  test('challengesForTeam answers { enabled: false } rather than throwing', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./challenges.ts', import.meta.url), 'utf8')
    expect(firstHandlerLine(source, 'challengesForTeam')).toContain('return { enabled: false as const }')
  })

  // cancelChallenge joins this list in Task 10, which is where it comes into
  // existence; listing it before then would fail on `no export const`.
  test.each(['declineChallenge', 'withdrawChallenge', 'setAcceptsChallenges'])(
    '%s is NOT gated, so a running challenge can always be ended',
    async (name) => {
      const { readFileSync } = await import('node:fs')
      const source = readFileSync(new URL('./challenges.ts', import.meta.url), 'utf8')
      expect(handlerLines(source, name).join('\n')).not.toContain('CHALLENGES_ENABLED')
    },
  )
})
