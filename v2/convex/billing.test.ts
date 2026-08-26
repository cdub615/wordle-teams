import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { downgradeTeamRemovalFor } from './billing.ts'
import { aPlayer, aTeam } from './fixtures.ts'

const modules = import.meta.glob('./**/*.ts')

// EVERY TEAM HERE HAS A SECOND MEMBER, and that is what makes this a test of
// the ORDERING alone: a dropped team still has someone on it, so it survives
// and can be asked whether the player is still on it. With solo teams the three
// dropped ones are correctly deleted and every assertion below dereferences a
// null — the empty-remainder delete has its own test further down.
test('a downgrade with 5 teams keeps exactly 2, owned first then oldest', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const other = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'other@example.com' }),
    )
    const owned = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 10, playerIds: [me, other], owner: me, createdAt: 500 }),
    )
    const oldest = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 11, playerIds: [me, other], owner: other, createdAt: 100 }),
    )
    const middle = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 12, playerIds: [me, other], owner: other, createdAt: 200 }),
    )
    const newer = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 13, playerIds: [me, other], owner: other, createdAt: 300 }),
    )
    const newest = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 14, playerIds: [me, other], owner: other, createdAt: 400 }),
    )

    await downgradeTeamRemovalFor(ctx, me)

    // Owned first even though it is the NEWEST, then the oldest of the rest.
    expect((await ctx.db.get(owned))!.playerIds).toContain(me)
    expect((await ctx.db.get(oldest))!.playerIds).toContain(me)
    for (const id of [middle, newer, newest]) {
      expect((await ctx.db.get(id))!.playerIds).not.toContain(me)
    }
  })
})

// DIVERGENCE 12. v1 DELETES these, taking every other member's scores and
// monthly-winner history with them. A billing event on one account must not
// destroy a third party's data.
test('a team the player owned and left survives with a reassigned owner', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const first = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'first@example.com' }),
    )
    const second = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'second@example.com' }),
    )
    // Three owned teams: two are kept, the third is the one under test.
    await ctx.db.insert('teams', aTeam({ legacyId: 20, playerIds: [me], owner: me, createdAt: 1 }))
    await ctx.db.insert('teams', aTeam({ legacyId: 21, playerIds: [me], owner: me, createdAt: 2 }))
    const third = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 22, playerIds: [me, first, second], owner: me, createdAt: 3 }),
    )

    await downgradeTeamRemovalFor(ctx, me)

    const team = await ctx.db.get(third)
    expect(team).not.toBeNull()
    expect(team!.playerIds).toEqual([first, second])
    // playerIds is append-ordered, so [0] of the remainder is earliest-joined.
    expect(team!.owner).toBe(first)
  })
})

test('a team left with nobody is deleted, with its cascade', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    await ctx.db.insert('teams', aTeam({ legacyId: 30, playerIds: [me], owner: me, createdAt: 1 }))
    await ctx.db.insert('teams', aTeam({ legacyId: 31, playerIds: [me], owner: me, createdAt: 2 }))
    const solo = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 32, playerIds: [me], owner: me, createdAt: 3 }),
    )
    const winnerId = await ctx.db.insert('monthlyWinners', {
      teamId: solo,
      year: 2026,
      month: 1,
      playerId: me,
      hasSeenCelebration: [],
    })
    const systemId = await ctx.db.insert('scoringSystems', {
      teamId: solo,
      effectiveFrom: '2026-01',
      oneGuess: 5,
      twoGuesses: 3,
      threeGuesses: 2,
      fourGuesses: 1,
      fiveGuesses: 0,
      sixGuesses: -1,
      failed: -3,
      nA: 0,
    })

    await downgradeTeamRemovalFor(ctx, me)

    expect(await ctx.db.get(solo)).toBeNull()
    // The cascade ran — a bare db.delete would orphan both of these rows.
    expect(await ctx.db.get(winnerId)).toBeNull()
    expect(await ctx.db.get(systemId)).toBeNull()
  })
})

test('a team containing another member is NEVER deleted', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const other = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'other@example.com' }),
    )
    await ctx.db.insert('teams', aTeam({ legacyId: 40, playerIds: [me], owner: me, createdAt: 1 }))
    await ctx.db.insert('teams', aTeam({ legacyId: 41, playerIds: [me], owner: me, createdAt: 2 }))
    const shared = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 42, playerIds: [me, other], owner: me, createdAt: 3 }),
    )

    await downgradeTeamRemovalFor(ctx, me)

    expect(await ctx.db.get(shared)).not.toBeNull()
    expect((await ctx.db.get(shared))!.playerIds).toEqual([other])
  })
})

test('a downgrade with 2 or fewer teams changes nothing', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const a = await ctx.db.insert('teams', aTeam({ legacyId: 50, playerIds: [me], createdAt: 1 }))
    const b = await ctx.db.insert('teams', aTeam({ legacyId: 51, playerIds: [me], createdAt: 2 }))

    await downgradeTeamRemovalFor(ctx, me)

    expect((await ctx.db.get(a))!.playerIds).toContain(me)
    expect((await ctx.db.get(b))!.playerIds).toContain(me)
  })
})

// A team they are a MEMBER of but do not own is never deleted and never
// reassigned — they simply leave it.
test('leaving a team owned by someone else does not touch its owner', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const other = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'other@example.com' }),
    )
    await ctx.db.insert('teams', aTeam({ legacyId: 60, playerIds: [me], owner: me, createdAt: 1 }))
    await ctx.db.insert('teams', aTeam({ legacyId: 61, playerIds: [me], owner: me, createdAt: 2 }))
    const theirs = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 62, playerIds: [other, me], owner: other, createdAt: 3 }),
    )

    await downgradeTeamRemovalFor(ctx, me)

    const team = (await ctx.db.get(theirs))!
    expect(team.owner).toBe(other)
    expect(team.playerIds).toEqual([other])
  })
})

// Another player's teams are not touched at all, which is what pins the
// `mine` filter — without it, the slice would run over the whole table.
test('a downgrade never touches a team the player is not on', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const me = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const other = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'other@example.com' }),
    )
    for (const createdAt of [1, 2, 3]) {
      await ctx.db.insert(
        'teams',
        aTeam({ legacyId: 70 + createdAt, playerIds: [me], owner: me, createdAt }),
      )
    }
    const stranger = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 79, playerIds: [other], owner: other, createdAt: 0 }),
    )

    await downgradeTeamRemovalFor(ctx, me)

    const team = (await ctx.db.get(stranger))!
    expect(team.playerIds).toEqual([other])
    expect(team.owner).toBe(other)
  })
})
