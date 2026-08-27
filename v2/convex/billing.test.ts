import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import {
  downgradeTeamRemovalFor,
  pendingInviteCountFor,
  resolvePlayerIdFor,
  upgradeTeamInvitesFor,
} from './billing.ts'
import { extractIdentityCandidates } from './lib/polarIdentity.ts'
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

// ---------------------------------------------------------------------------
// resolvePlayerIdFor — ACCEPTANCE CRITERION 2, a release gate. Both silent-202
// cases are pinned here, and both must be pinned before any Polar sandbox run.
// ---------------------------------------------------------------------------

// A v1 player id: a Postgres uuid, which v2 stores as players.legacyId. Same
// value as fixtures.ts's default legacyId, but written out here because these
// tests are about the string arriving from Polar, not about the fixture.
const V1_UUID = '11111111-1111-4111-8111-111111111111'

test('resolves a native Convex player id', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    expect(await resolvePlayerIdFor(ctx, [playerId])).toBe(playerId)
  })
})

// RELEASE GATE, case 1 — the v1 silent-202 failure, end to end from the body.
// Polar matched the checkout to an EXISTING customer by email, so
// customer.externalId came back null and only metadata.player_id carries the
// value. On v1's dev on 2026-08-03 this body was accepted with HTTP 202 and
// nobody was upgraded.
//
// DELIBERATELY GOES THROUGH extractIdentityCandidates rather than passing a
// hand-written array: the assertion is that this BODY resolves, and an array
// literal would assert only that resolution works on input the extraction might
// never produce.
test('resolves from checkout metadata when the customer external id was null', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const { candidates } = extractIdentityCandidates({
      customer: { id: 'cus_1', externalId: null },
      metadata: { player_id: playerId },
      checkoutId: 'ch_1',
    })

    expect(candidates).toEqual([playerId])
    expect(await resolvePlayerIdFor(ctx, candidates)).toBe(playerId)
  })
})

// RELEASE GATE, case 2 — the case that hits EVERY migrated customer, and hits
// them on revocation. v1's checkout.ts:22 set externalCustomerId to the v1
// player id, a Postgres uuid; v2 stores that uuid as players.legacyId. So the
// id here is POPULATED and well-formed — it simply belongs to the other
// namespace, and ctx.db.normalizeId rejects it. Resolving Convex ids alone
// would 202 every paying customer's renewal, cancellation and revocation.
test('resolves a v1 uuid through by_legacyId', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: V1_UUID }))
    const { candidates } = extractIdentityCandidates({
      customer: { id: 'cus_1', externalId: V1_UUID },
    })

    expect(candidates).toEqual([V1_UUID])
    expect(await resolvePlayerIdFor(ctx, candidates)).toBe(playerId)
  })
})

test('returns null when no candidate names a player', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    // Nothing inserted, so the uuid is well-formed and unowned — exactly an
    // event belonging to a different integration on the same organization.
    expect(await resolvePlayerIdFor(ctx, ['not-an-id', V1_UUID])).toBeNull()
  })
})

test('returns null for no candidates at all', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    expect(await resolvePlayerIdFor(ctx, [])).toBeNull()
  })
})

// THIS IS WHAT PINS THE EXISTENCE CHECK. normalizeId validates the SHAPE of an
// id for a table, not that the document is still there, so a deleted player's
// id normalizes fine and would be returned by a resolver that stopped at
// normalizeId. Upgrading a row that no longer exists throws inside the
// transaction, which is a 500 and an endless Polar retry over an event that can
// never succeed.
test('a well-formed Convex id for a deleted player does not resolve', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    await ctx.db.delete(playerId)
    expect(await resolvePlayerIdFor(ctx, [playerId])).toBeNull()
  })
})

// Order, asserted BOTH WAYS. One direction alone would pass on a resolver that
// ignored the array order entirely and always returned the Convex-id hit.
test('tries candidates in order and takes the first that resolves', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const native = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const legacy = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: V1_UUID, email: 'other@example.com' }),
    )

    expect(await resolvePlayerIdFor(ctx, [native, V1_UUID])).toBe(native)
    expect(await resolvePlayerIdFor(ctx, [V1_UUID, native])).toBe(legacy)
  })
})

// An unresolvable candidate is skipped rather than ending the search — the
// happy-path customer.externalId can be a stale or foreign value while the
// metadata we set ourselves is still correct.
test('skips a candidate that names nothing and keeps going', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: V1_UUID }))
    expect(await resolvePlayerIdFor(ctx, ['not-an-id', V1_UUID])).toBe(playerId)
  })
})

// ---------------------------------------------------------------------------
// upgradeTeamInvitesFor and pendingInviteCountFor — the port of v1's
// handle_upgrade_team_invites, and the badge count that decision G derives
// rather than stores.
// ---------------------------------------------------------------------------

const ADA = 'ada@example.com'

test('upgrading releases every parked invite, on all three teams at once', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined, email: ADA }))
    const teams = [
      await ctx.db.insert('teams', aTeam({ legacyId: 1, invited: [ADA] })),
      await ctx.db.insert('teams', aTeam({ legacyId: 2, invited: [ADA] })),
      await ctx.db.insert('teams', aTeam({ legacyId: 3, invited: [ADA] })),
    ]

    expect(await pendingInviteCountFor(ctx, playerId)).toBe(3)
    await upgradeTeamInvitesFor(ctx, playerId)

    for (const id of teams) {
      const team = (await ctx.db.get(id))!
      // BOTH HALVES, always together: dropping the address without adding the
      // player is the failure that leaves them invited to nothing.
      expect(team.playerIds).toContain(playerId)
      expect(team.invited).toEqual([])
    }
    expect(await pendingInviteCountFor(ctx, playerId)).toBe(0)
  })
})

// An upgrade is a billing event, not an invite event: the overwhelming majority
// of upgrades have nothing parked, and that path must not throw.
test('upgrading with no parked invites is a no-op, not an error', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined, email: ADA }))
    const untouched = await ctx.db.insert('teams', aTeam({ legacyId: 1, playerIds: [playerId] }))

    await expect(upgradeTeamInvitesFor(ctx, playerId)).resolves.toBeUndefined()

    expect((await ctx.db.get(untouched))!.playerIds).toEqual([playerId])
    expect(await pendingInviteCountFor(ctx, playerId)).toBe(0)
  })
})

// Pins that the scan is keyed on the address rather than on "any team with a
// pending invite" — without the comparison, an upgrade would sweep the upgrader
// onto every team in the table that has anyone parked on it.
test('a team that invited someone else is untouched', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined, email: ADA }))
    const theirs = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 4, invited: ['grace@example.com'] }),
    )

    expect(await pendingInviteCountFor(ctx, playerId)).toBe(0)
    await upgradeTeamInvitesFor(ctx, playerId)

    const team = (await ctx.db.get(theirs))!
    expect(team.playerIds).not.toContain(playerId)
    expect(team.invited).toEqual(['grace@example.com'])
  })
})

// A team listing the same person in BOTH playerIds and invited is exactly what
// the copy brings over, since v1 never removed an invite it could not match —
// and v1's own array_append here is unconditional, so the faithful port would
// put them on the roster twice. See invitePlayerFor, which documents the same
// hazard on its own already-a-member branch.
test('a player already on the team is not added twice, and their address is still cleared', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined, email: ADA }))
    const teamId = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 8, playerIds: [playerId], invited: [ADA] }),
    )

    await upgradeTeamInvitesFor(ctx, playerId)

    const team = (await ctx.db.get(teamId))!
    expect(team.playerIds).toEqual([playerId])
    // Clearing it is the whole reason this team is visited at all: while the
    // address sits there, getTeamInvitesFor shows the person as pending at the
    // same time as the roster shows them as a member.
    expect(team.invited).toEqual([])
  })
})

// THE COUNT AND THE RELEASE DELIBERATELY DISAGREE ABOUT THIS TEAM, and the
// asymmetry is the point: the release must visit it to clear the stale address,
// while the badge must not offer an invite to a team the player is already on —
// there would be nothing to accept and nothing to click. Counting it would have
// swapped v1's counter, which could drift, for a derivation that over-counts.
//
// This is not a hypothetical row: a member listed in both playerIds and invited
// is exactly what the copy brings over, since v1 never removed an invite it
// could not match.
test('a stale invite on a team the player is already on does not count', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: V1_UUID, email: ADA }))
    const joined = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 13, playerIds: [playerId], invited: [ADA] }),
    )
    // A real one beside it, so this pins the exclusion rather than a zero the
    // whole function could be returning.
    await ctx.db.insert('teams', aTeam({ legacyId: 14, invited: ['Ada@Example.COM'] }))

    expect(await pendingInviteCountFor(ctx, playerId)).toBe(1)

    // The release still visits BOTH — excluding the joined team from the scan
    // itself would strand its address forever.
    await upgradeTeamInvitesFor(ctx, playerId)
    expect((await ctx.db.get(joined))!.invited).toEqual([])
    expect(await pendingInviteCountFor(ctx, playerId)).toBe(0)
  })
})

// COPIED ROWS PREDATE THE LOWERCASE RULE. schema.ts's comment on `invited` says
// the table cannot hold a mixed-case invite, but that governs v2's writers; the
// copy gates map `e.toLowerCase()` and never trim, so a padded v1 address
// survives intact (cancelInviteFor spells out which half of this is defence in
// depth and which is not). An entry the upgrade misses is not strictly
// unclearable — invitePlayerFor's add branch and cancelInviteFor would clear it
// — but both need the team's OWNER to act again, and their invite list still
// shows the address as outstanding, so nothing prompts them to. This is the only
// exit the invited player can reach on their own.
test('a mixed-case or padded copied invited entry still matches', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: V1_UUID, email: ADA }))
    const mixedCase = await ctx.db.insert('teams', aTeam({ legacyId: 9, invited: ['Ada@Example.COM'] }))
    const padded = await ctx.db.insert('teams', aTeam({ legacyId: 10, invited: ['  ada@example.com  '] }))

    expect(await pendingInviteCountFor(ctx, playerId)).toBe(2)
    await upgradeTeamInvitesFor(ctx, playerId)

    for (const id of [mixedCase, padded]) {
      const team = (await ctx.db.get(id))!
      expect(team.playerIds).toContain(playerId)
      expect(team.invited).toEqual([])
    }
  })
})

// DECISION G, and the case that makes it more than a preference. A migrated
// user's v1 invites_pending_upgrade lives in auth.users.raw_app_meta_data,
// which the copy never reads — a stored counter would read 0 here while three
// real invites sat parked. Derived, it cannot.
//
// The badge that consumes this does not exist yet: the UI is Task 11
// (wordle-teams-ksh).
test('the pending count is derived from teams.invited for a migrated player', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: V1_UUID, email: ADA }))
    await ctx.db.insert('teams', aTeam({ legacyId: 5, invited: [ADA] }))
    await ctx.db.insert('teams', aTeam({ legacyId: 6, invited: ['ADA@example.com'] }))
    // Neither of these counts: one parks a different address, one parks none.
    await ctx.db.insert('teams', aTeam({ legacyId: 7, invited: ['grace@example.com'] }))
    await ctx.db.insert('teams', aTeam({ legacyId: 8, invited: [] }))

    expect(await pendingInviteCountFor(ctx, playerId)).toBe(2)

    await upgradeTeamInvitesFor(ctx, playerId)

    expect(await pendingInviteCountFor(ctx, playerId)).toBe(0)
  })
})

// Counts TEAMS, not entries. One address parked twice in two shapes on one team
// is one pending invite to the person holding it — the badge reads "N Invites
// Pending", and two lines for one team would be wrong.
test('the pending count counts a team once even if the address is parked twice', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined, email: ADA }))
    const teamId = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 11, invited: [ADA, 'Ada@example.com'] }),
    )

    expect(await pendingInviteCountFor(ctx, playerId)).toBe(1)

    await upgradeTeamInvitesFor(ctx, playerId)

    // EVERY matching entry goes, not the first, for the reason cancelInviteFor
    // gives: leaving the duplicate behind leaves an invite nothing can clear.
    expect((await ctx.db.get(teamId))!.invited).toEqual([])
  })
})

// A player row can be gone by the time a Polar event is processed — a deletion
// races the webhook. Neither half may throw: a 500 there is an endless Polar
// redelivery over an event that can never succeed.
test('a player id naming no row upgrades to nothing and counts 0', async () => {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined, email: ADA }))
    const teamId = await ctx.db.insert('teams', aTeam({ legacyId: 12, invited: [ADA] }))
    await ctx.db.delete(playerId)

    await expect(upgradeTeamInvitesFor(ctx, playerId)).resolves.toBeUndefined()
    expect(await pendingInviteCountFor(ctx, playerId)).toBe(0)
    expect((await ctx.db.get(teamId))!.invited).toEqual([ADA])
  })
})
