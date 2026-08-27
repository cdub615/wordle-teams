import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import {
  downgradeTeamRemovalFor,
  pendingInviteCountFor,
  resolvePlayerIdFor,
  upgradeTeamInvitesFor,
} from './billing.ts'
import { internal } from './_generated/api'
import { extractIdentityCandidates } from './lib/polarIdentity.ts'
import { FREE_TEAM_LIMIT } from './lib/teamLimits.ts'
import { aPlayer, aTeam } from './fixtures.ts'
import type { TestConvex } from 'convex-test'
import type { Id } from './_generated/dataModel'

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
// customer.external_id came back null and only metadata.player_id carries the
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
      customer: { id: 'cus_1', external_id: null },
      metadata: { player_id: playerId },
      checkout_id: 'ch_1',
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
      customer: { id: 'cus_1', external_id: V1_UUID },
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

// ---------------------------------------------------------------------------
// processPolarEvent and recordWebhookFailure — Task 10 (wordle-teams-p8m), the
// point at which a verified Polar delivery becomes a membership change.
//
// WHAT THESE COVER AND WHAT THEY DO NOT. Everything below drives the two
// mutations directly, because that is where the rules are: the replay guard,
// the transition, the effect, and the audit row. The transport half — signature
// verification, the header the delivery id comes from, and the status codes —
// lives in convex/http.ts and is exercised by the sandbox pass in Task 13
// (wordle-teams-02c); a convex-test harness cannot sign a Standard Webhooks
// request against a secret no deployment has yet (wordle-teams-3bl).
//
// ACCEPTANCE CRITERION 3 HAS TWO HALVES and both are here: a duplicate must not
// reprocess, and a FAILED delivery must. The second is divergence 13 — the one
// v1 gets wrong — and the two tests are written so that guarding on row
// existence rather than on `processed` fails the second while leaving the first
// green, which is exactly the mutation this task's CONTROL A applies.
// ---------------------------------------------------------------------------

// A Standard Webhooks delivery id. NOT a uuid: v1 lost a day to a uuid column
// that rejected exactly this shape, answered 500, and put Polar into an
// infinite retry loop over an event that could never be stored.
const WEBHOOK_ID = 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W'

// The mutation's arguments, not a Polar body. Identity is resolved BEFORE the
// mutation runs (the httpAction answers 202 when it cannot be), so what arrives
// here is already a playerId plus the raw JSON to keep for the audit trail.
const anEvent = (over: Record<string, unknown> = {}) => ({
  webhookId: WEBHOOK_ID,
  eventName: 'subscription.active',
  body: { type: 'subscription.active', data: { id: 'sub_1' } },
  ...over,
})

const statusOf = async (t: TestConvex<typeof schema>, playerId: Id<'players'>) =>
  await t.run(
    async (ctx) =>
      (
        await ctx.db
          .query('playerMembership')
          .withIndex('by_player', (q) => q.eq('playerId', playerId))
          .first()
      )?.membershipStatus ?? null,
  )

const rowsFor = async (t: TestConvex<typeof schema>, webhookId = WEBHOOK_ID) =>
  await t.run(
    async (ctx) =>
      await ctx.db
        .query('webhookEvents')
        .withIndex('by_webhookId', (q) => q.eq('webhookId', webhookId))
        .collect(),
  )

// The grant, end to end: the membership row AND the effect that goes with it.
// Asserting only the status would pass against a handler that never released
// the invites, which is half the transition.
test('an active event upgrades the player and releases parked invites', async () => {
  const t = convexTest(schema, modules)
  const { playerId, teamId } = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined, email: ADA }))
    const teamId = await ctx.db.insert('teams', aTeam({ legacyId: 200, invited: [ADA] }))
    return { playerId, teamId }
  })

  expect(await t.mutation(internal.billing.processPolarEvent, { ...anEvent(), playerId })).toBe(
    'processed',
  )

  expect(await statusOf(t, playerId)).toBe('pro')
  await t.run(async (ctx) => {
    const team = (await ctx.db.get(teamId))!
    expect(team.playerIds).toContain(playerId)
    expect(team.invited).toEqual([])
  })

  const rows = await rowsFor(t)
  expect(rows).toHaveLength(1)
  expect(rows[0].processed).toBe(true)
  expect(rows[0].eventName).toBe('subscription.active')
  // The raw delivery, kept verbatim. The audit trail is what a stored event is
  // for; a transition can be re-derived from the name, the body cannot.
  expect(rows[0].body).toEqual({ type: 'subscription.active', data: { id: 'sub_1' } })
})

// A player born in v2 has no membership row at all until they pay — Task 3
// (wordle-teams-h9k) is what made inserting one legal, by making legacyId
// optional. `legacyId === undefined` has to stay meaningful: it is how Phase 7's
// reconciliation tells a native row from a copied one.
test('a player with no membership row gets one, with no legacyId', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))

  await t.mutation(internal.billing.processPolarEvent, { ...anEvent(), playerId })

  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .collect()
    expect(rows).toHaveLength(1)
    expect(rows[0].membershipStatus).toBe('pro')
    expect(rows[0].legacyId).toBeUndefined()
  })
})

// ACCEPTANCE CRITERION 3, FIRST HALF.
//
// THE MEMBERSHIP IS CHANGED BEHIND THE HANDLER'S BACK between the two
// deliveries, and that is the whole design of this test: asserting only that
// the second call returns 'duplicate' would pass just as happily against a
// handler that reprocessed and then said so. The 'free' below can only survive
// if nothing ran.
test('a duplicate webhook id returns success WITHOUT reprocessing', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))

  await t.mutation(internal.billing.processPolarEvent, { ...anEvent(), playerId })
  expect(await statusOf(t, playerId)).toBe('pro')

  await t.run(async (ctx) => {
    const row = (await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first())!
    await ctx.db.patch(row._id, { membershipStatus: 'free' })
  })

  expect(await t.mutation(internal.billing.processPolarEvent, { ...anEvent(), playerId })).toBe(
    'duplicate',
  )

  expect(await statusOf(t, playerId)).toBe('free')
  // And no second audit row: Convex has no unique constraint to lean on, so
  // the guard's lookup is the only thing stopping one delivery from
  // accumulating a row per redelivery.
  expect(await rowsFor(t)).toHaveLength(1)
})

// ACCEPTANCE CRITERION 3, SECOND HALF — DIVERGENCE 13, and the one v1 gets
// wrong.
//
// v1 inserts the row before processing and marks it processed even when
// processing fails, so the redelivery's INSERT hits the unique index, is mapped
// to 'duplicate', answers 200, and the event is lost forever while the audit row
// claims it was handled. v2 keys the guard on `processed`, so a row that exists
// but never completed is a delivery this app still owes.
test('a previously FAILED event IS reprocessed on redelivery', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))

  // Exactly what the httpAction's catch block does after processPolarEvent has
  // thrown and rolled back: the audit row is written OUTSIDE the failed
  // transaction, unprocessed.
  await t.mutation(internal.billing.recordWebhookFailure, {
    ...anEvent(),
    playerId,
    processingError: 'boom',
  })

  expect(await statusOf(t, playerId)).toBeNull()

  expect(await t.mutation(internal.billing.processPolarEvent, { ...anEvent(), playerId })).toBe(
    'processed',
  )

  expect(await statusOf(t, playerId)).toBe('pro')
  const rows = await rowsFor(t)
  // Reused, not duplicated.
  expect(rows).toHaveLength(1)
  expect(rows[0].processed).toBe(true)
  // The error from the failed attempt is GONE. A row that is processed and
  // still carries an error is v1's terminal state, and it must be unreachable
  // here.
  expect(rows[0].processingError).toBeUndefined()
})

// The row a failure leaves behind is the input to the test above, so what it
// contains is worth pinning on its own: processed:false is not bookkeeping, it
// is the thing that lets the redelivery pick the event up.
test('a failed delivery is stored unprocessed, carrying its error', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))

  await t.mutation(internal.billing.recordWebhookFailure, {
    ...anEvent(),
    playerId,
    processingError: 'Uncaught Error: boom',
  })

  const rows = await rowsFor(t)
  expect(rows).toHaveLength(1)
  expect(rows[0].processed).toBe(false)
  expect(rows[0].processingError).toBe('Uncaught Error: boom')

  // A second failure patches the same row rather than adding another.
  await t.mutation(internal.billing.recordWebhookFailure, {
    ...anEvent(),
    playerId,
    processingError: 'boom again',
  })
  const after = await rowsFor(t)
  expect(after).toHaveLength(1)
  expect(after[0].processingError).toBe('boom again')
})

// THE ONE CASE THAT WOULD REPLAY AN APPLIED EVENT. The normal path cannot reach
// it — a processed row returns 'duplicate' and never throws — but a mutation
// that COMMITTED and then failed to report back to the action would land here,
// and flipping the row to processed:false would hand the redelivery a
// membership change that already happened.
test('recording a failure never un-processes an already-processed row', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))

  await t.mutation(internal.billing.processPolarEvent, { ...anEvent(), playerId })
  await t.mutation(internal.billing.recordWebhookFailure, {
    ...anEvent(),
    playerId,
    processingError: 'the mutation committed but the action never heard back',
  })

  const rows = await rowsFor(t)
  expect(rows).toHaveLength(1)
  expect(rows[0].processed).toBe(true)
  expect(
    await t.mutation(internal.billing.processPolarEvent, { ...anEvent(), playerId }),
  ).toBe('duplicate')
})

// RECOGNISED BUT DELIBERATELY INERT. Polar splits Lemon Squeezy's single
// cancellation in two: `canceled` means the customer SCHEDULED a cancellation
// and keeps paid access to the end of the period they already bought, and
// `past_due` means a payment failed but is still recoverable. Downgrading on
// either would strip a paying customer's teams weeks early — which is what
// CONTROL B of this task's mutation testing does, to prove this test sees it.
test('canceled and past_due change no membership and remove no teams', async () => {
  for (const eventName of ['subscription.canceled', 'subscription.past_due']) {
    const t = convexTest(schema, modules)
    const { playerId, teams } = await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
      const other = await ctx.db.insert(
        'players',
        aPlayer({ legacyId: undefined, email: 'other@example.com' }),
      )
      await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
      // MORE THAN FREE_TEAM_LIMIT, or "no teams removed" would be true of a
      // downgrade too and the test would prove nothing. Each keeps a second
      // member so a wrongly-dropped team still exists to be asked about.
      const teams = []
      for (let i = 0; i <= FREE_TEAM_LIMIT; i++) {
        teams.push(
          await ctx.db.insert(
            'teams',
            aTeam({ legacyId: 210 + i, playerIds: [playerId, other], owner: playerId }),
          ),
        )
      }
      return { playerId, teams }
    })

    expect(
      await t.mutation(internal.billing.processPolarEvent, {
        ...anEvent({ eventName, webhookId: `msg_${eventName}` }),
        playerId,
      }),
    ).toBe('processed')

    expect(await statusOf(t, playerId)).toBe('pro')
    await t.run(async (ctx) => {
      for (const id of teams) {
        expect((await ctx.db.get(id))!.playerIds).toContain(playerId)
      }
    })
    // Stored anyway: the audit trail is the point of the row, not the
    // transition.
    const rows = await rowsFor(t, `msg_${eventName}`)
    expect(rows).toHaveLength(1)
    expect(rows[0].processed).toBe(true)
  }
})

// The revocation is where access actually ends, and it carries the softened
// downgrade with it (divergence 12): the player leaves the surplus teams, which
// survive for everyone else on them.
test('revoked downgrades the membership and applies the team limit', async () => {
  const t = convexTest(schema, modules)
  const { playerId, teams } = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    const other = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'other@example.com' }),
    )
    await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
    // FREE_TEAM_LIMIT + 1 teams, oldest first, each with a second member so the
    // surplus one survives its owner leaving and can still be inspected.
    const teams = []
    for (let i = 0; i <= FREE_TEAM_LIMIT; i++) {
      teams.push(
        await ctx.db.insert(
          'teams',
          aTeam({ legacyId: 220 + i, playerIds: [playerId, other], owner: other, createdAt: i }),
        ),
      )
    }
    return { playerId, teams }
  })

  expect(
    await t.mutation(internal.billing.processPolarEvent, {
      ...anEvent({ eventName: 'subscription.revoked' }),
      playerId,
    }),
  ).toBe('processed')

  // Patched, not inserted: this player already had a row.
  expect(await statusOf(t, playerId)).toBe('expired')
  await t.run(async (ctx) => {
    const kept = teams.slice(0, FREE_TEAM_LIMIT)
    for (const id of kept) expect((await ctx.db.get(id))!.playerIds).toContain(playerId)
    for (const id of teams.slice(FREE_TEAM_LIMIT)) {
      expect((await ctx.db.get(id))!.playerIds).not.toContain(playerId)
    }
  })
})

// An event nobody taught this app about. It is STORED — the audit trail is why
// the table exists — and acknowledged, because a 500 would put Polar into an
// endless redelivery loop over something no retry can change. `isAcknowledged
// Event` is what tells this apart from canceled/past_due, so that only this one
// is logged as unhandled.
//
// `subscription.created` is deliberately the example: Polar sends it when a
// subscription record is established, which is not the same as it being paid
// for, and treating it as the grant would hand out Pro on an unpaid checkout.
test('an unrecognised event is stored and acknowledged with no membership change', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))

  expect(
    await t.mutation(internal.billing.processPolarEvent, {
      ...anEvent({ eventName: 'subscription.created' }),
      playerId,
    }),
  ).toBe('processed')

  expect(await statusOf(t, playerId)).toBeNull()
  const rows = await rowsFor(t)
  expect(rows).toHaveLength(1)
  expect(rows[0].processed).toBe(true)
  expect(rows[0].eventName).toBe('subscription.created')
})

// The Map in lib/polarEvents.ts is a Map and not a Record precisely so that a
// key off the prototype chain cannot resolve to something truthy. This is that
// rule seen from the mutation: a hostile event name reaches the database as a
// stored row and nothing else, never as an `undefined` membership status.
test('a prototype-chain event name changes nothing', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))

  expect(
    await t.mutation(internal.billing.processPolarEvent, {
      ...anEvent({ eventName: '__proto__' }),
      playerId,
    }),
  ).toBe('processed')

  expect(await statusOf(t, playerId)).toBeNull()
})

// The httpAction has no ctx.db, so resolution has to cross a runQuery. This is
// that crossing, and it is thin on purpose — resolvePlayerIdFor's own tests
// above are where the two-namespace rule is pinned.
test('resolvePlayerId answers across the query boundary, and null for nobody', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: V1_UUID })))

  expect(
    await t.query(internal.billing.resolvePlayerId, { candidates: ['nope', V1_UUID] }),
  ).toBe(playerId)
  expect(await t.query(internal.billing.resolvePlayerId, { candidates: [] })).toBeNull()
})
