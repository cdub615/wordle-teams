import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import { aPlayer, aTeam } from './fixtures.ts'
import type { PruneBatchReport } from './e2ePrune.ts'
import type { Id } from './_generated/dataModel'

const modules = import.meta.glob('./**/*.ts')

// Throwaway e2e shapes and RFC-reserved domains only, never anybody's real
// address — this repository is public. `REAL` here means "not e2e debris", which
// is the only distinction these tests turn on.
const E2E_ADDRESS = 'e2e+prune-1@wordleteams.com'
const E2E_ADDRESS_2 = 'e2e+prune-2@wordleteams.com'
// The shape the 32 rows measured on the local backend actually had: an older
// spec's `second-e2e+…` local part, which does NOT match the anchored address
// regex and is reachable only through the seed's `e2e-` legacyId.
const E2E_ONLY_BY_LEGACY_ID = 'second-e2e+1755555555555-1@wordleteams.com'
const REAL_ADDRESS = 'ada@example.test'

beforeEach(() => vi.stubEnv('E2E_TEST_MODE', 'true'))
afterEach(() => vi.unstubAllEnvs())

/** Runs every batch to completion and sums the reports, as the script does. */
async function prune(t: ReturnType<typeof convexTest>, execute: boolean, pageSize = 100) {
  let cursor: string | null = null
  const totals: Record<string, number> = {}
  for (;;) {
    const report: PruneBatchReport = await t.mutation(internal.e2ePrune.pruneBatch, {
      execute,
      cursor,
      pageSize,
    })
    // Summed by walking the report rather than by naming its fields, so a
    // counter added to the mutation is totalled here without this helper having
    // to be remembered. `cursor` is the only non-numeric field and is skipped by
    // the typeof, which is also what keeps `isDone` out of the totals.
    for (const [key, value] of Object.entries(report)) {
      if (typeof value === 'number') totals[key] = (totals[key] ?? 0) + value
    }
    if (report.isDone) break
    cursor = report.cursor
  }
  return totals
}

/** Everything left in the tables the prune touches. Counts and ids only. */
async function census(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    players: await ctx.db.query('players').collect(),
    teams: await ctx.db.query('teams').collect(),
    dailyScores: await ctx.db.query('dailyScores').collect(),
    monthlyWinners: await ctx.db.query('monthlyWinners').collect(),
    scoringSystems: await ctx.db.query('scoringSystems').collect(),
    playerMembership: await ctx.db.query('playerMembership').collect(),
    pushSubscriptions: await ctx.db.query('pushSubscriptions').collect(),
  }))
}

const aPushSubscription = (playerId: Id<'players'>, over: Record<string, unknown> = {}) => ({
  playerId,
  endpoint: 'https://push.example.test/endpoint',
  p256dh: 'p256dh-key',
  auth: 'auth-secret',
  createdAt: Date.parse('2026-08-01T12:00:00Z'),
  ...over,
})

const aScore = (playerId: Id<'players'>, over: Record<string, unknown> = {}) => ({
  playerId,
  puzzleDay: '2026-08-01',
  date: Date.parse('2026-08-01T12:00:00Z'),
  guesses: ['crane'],
  ...over,
})

describe('the E2E_TEST_MODE gate', () => {
  // Matched to e2eSeed.ts and testOtps.ts, which is why it is pinned rather than
  // left to the reader: those two throw plain Errors, this one must throw a
  // ConvexError, because a plain Error's message is redacted in production and
  // the operator would be told only "Server Error" at the exact moment they need
  // to be told they are pointed at the wrong deployment.
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['the string "false"', 'false'],
    // PINS THE EXACT COMPARISON, and it is the dangerous direction: a truthiness
    // check rather than `=== 'true'` would let any non-empty value through.
    ['some other truthy string', '1'],
  ])('refuses when E2E_TEST_MODE is %s', async (_label, value) => {
    vi.stubEnv('E2E_TEST_MODE', value)
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: E2E_ADDRESS, legacyId: undefined }))
    })

    await expect(
      t.mutation(internal.e2ePrune.pruneBatch, { execute: true, cursor: null }),
    ).rejects.toThrow(ConvexError)

    // AND WROTE NOTHING. The throw is only worth having if it happens before any
    // deletion, so the row surviving is the actual assertion.
    expect((await census(t)).players).toHaveLength(1)
  })

  test('rejects a nonsense page size', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(internal.e2ePrune.pruneBatch, { execute: false, cursor: null, pageSize: 0 }),
    ).rejects.toThrow(ConvexError)
  })
})

describe('e2e debris is removed', () => {
  test('a seeded player, their team and everything hanging off both', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const player = await ctx.db.insert(
        'players',
        aPlayer({ email: E2E_ADDRESS, legacyId: `e2e-${E2E_ADDRESS}` }),
      )
      const team = await ctx.db.insert(
        'teams',
        aTeam({ legacyId: Date.now(), name: 'E2E Team', playerIds: [player], owner: player }),
      )
      await ctx.db.insert('dailyScores', aScore(player))
      await ctx.db.insert('dailyScores', aScore(player, { puzzleDay: '2026-08-02' }))
      await ctx.db.insert('monthlyWinners', {
        playerId: player,
        teamId: team,
        year: 2026,
        month: 8,
        hasSeenCelebration: [player],
      })
      await ctx.db.insert('scoringSystems', {
        teamId: team,
        effectiveFrom: '2026-08',
        oneGuess: 5,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
      })
      await ctx.db.insert('playerMembership', { playerId: player, membershipStatus: 'free' })
      await ctx.db.insert('pushSubscriptions', aPushSubscription(player))
    })

    const totals = await prune(t, true)
    expect(totals.playersDeleted).toBe(1)
    expect(totals.teamsDeleted).toBe(1)
    expect(totals.dailyScoresDeleted).toBe(2)
    // This row leaves with its TEAM, through cascadeDeleteTeam, not with its
    // player — so it is counted in the team-deletion branch. Counting only the
    // by_player sweep reported 0 here while the row was in fact destroyed, which
    // is how this assertion came to exist.
    expect(totals.monthlyWinnersDeleted).toBe(1)
    expect(totals.scoringSystemsDeleted).toBe(1)
    expect(totals.playerMembershipsDeleted).toBe(1)
    expect(totals.pushSubscriptionsDeleted).toBe(1)

    const left = await census(t)
    expect(left.players).toHaveLength(0)
    expect(left.teams).toHaveLength(0)
    expect(left.dailyScores).toHaveLength(0)
    expect(left.monthlyWinners).toHaveLength(0)
    // THE cascadeDeleteTeam ASSERTION. A bare db.delete(team._id) leaves this
    // row behind — nothing else in the prune touches scoringSystems, so this is
    // the only thing standing between the cascade and a silent orphan.
    expect(left.scoringSystems).toHaveLength(0)
    expect(left.playerMembership).toHaveLength(0)
    expect(left.pushSubscriptions).toHaveLength(0)
  })

  test('a player reachable ONLY by the e2e- legacyId, whose address fails the regex', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert(
        'players',
        aPlayer({
          email: E2E_ONLY_BY_LEGACY_ID,
          legacyId: `e2e-${E2E_ONLY_BY_LEGACY_ID}`,
        }),
      )
    })

    expect((await prune(t, true)).playersDeleted).toBe(1)
    expect((await census(t)).players).toHaveLength(0)
  })

  test('a player reachable ONLY by address, with no legacyId at all', async () => {
    // 605 of the rows measured locally were this: created by the real
    // signup/invite flow during a test, so the seed never stamped a marker.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: E2E_ADDRESS, legacyId: undefined }))
    })

    expect((await prune(t, true)).playersDeleted).toBe(1)
    expect((await census(t)).players).toHaveLength(0)
  })
})

describe('legitimate data is left alone', () => {
  test('a real player, their team, their boards and their winner row all survive', async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx) => {
      const real = await ctx.db.insert('players', aPlayer({ email: REAL_ADDRESS }))
      const team = await ctx.db.insert(
        'teams',
        aTeam({ name: 'Real Team', playerIds: [real], owner: real }),
      )
      await ctx.db.insert('dailyScores', aScore(real))
      await ctx.db.insert('monthlyWinners', {
        playerId: real,
        teamId: team,
        year: 2026,
        month: 8,
        hasSeenCelebration: [real],
      })
      await ctx.db.insert('pushSubscriptions', aPushSubscription(real))
      // And an unrelated e2e player, so the prune has something to do and this
      // is not merely a test that a no-op changes nothing.
      await ctx.db.insert('players', aPlayer({ email: E2E_ADDRESS, legacyId: undefined }))
      return { real, team }
    })

    const totals = await prune(t, true)
    expect(totals.playersDeleted).toBe(1)
    expect(totals.teamsDeleted).toBe(0)
    expect(totals.pushSubscriptionsDeleted).toBe(0)

    const left = await census(t)
    expect(left.players.map((p) => p._id)).toEqual([ids.real])
    expect(left.teams.map((tm) => tm._id)).toEqual([ids.team])
    expect(left.teams[0].playerIds).toEqual([ids.real])
    expect(left.dailyScores).toHaveLength(1)
    expect(left.monthlyWinners).toHaveLength(1)
    // The real player's own celebration reference is not collateral damage.
    expect(left.monthlyWinners[0].hasSeenCelebration).toEqual([ids.real])
    // The real player's push subscription is not collateral damage either.
    expect(left.pushSubscriptions).toHaveLength(1)
  })

  test('a team with a surviving member is NOT deleted, only trimmed', async () => {
    const t = convexTest(schema, modules)
    const ids = await t.run(async (ctx) => {
      const real = await ctx.db.insert('players', aPlayer({ email: REAL_ADDRESS }))
      const debris = await ctx.db.insert(
        'players',
        aPlayer({ email: E2E_ADDRESS, legacyId: `e2e-${E2E_ADDRESS}` }),
      )
      const team = await ctx.db.insert(
        'teams',
        aTeam({
          name: 'Shared Team',
          playerIds: [real, debris],
          owner: real,
          invited: [E2E_ADDRESS_2, REAL_ADDRESS],
        }),
      )
      await ctx.db.insert('monthlyWinners', {
        playerId: real,
        teamId: team,
        year: 2026,
        month: 8,
        // The departing e2e player sits in a SURVIVING team's celebration list.
        // Nothing else in the prune would reach this, and left behind it is a
        // dangling id('players').
        hasSeenCelebration: [real, debris],
      })
      return { real, debris, team }
    })

    const totals = await prune(t, true)
    expect(totals.teamsDeleted).toBe(0)
    expect(totals.teamRostersPatched).toBe(1)
    expect(totals.teamInvitesCleared).toBe(1)
    expect(totals.celebrationRefsCleared).toBe(1)

    const left = await census(t)
    expect(left.teams).toHaveLength(1)
    // NO DANGLING ROSTER ENTRY. Deleting the player does not do this by itself;
    // this is the exact hazard the prune exists to avoid.
    expect(left.teams[0].playerIds).toEqual([ids.real])
    // The e2e invite is retired; the non-e2e one is untouched.
    expect(left.teams[0].invited).toEqual([REAL_ADDRESS])
    expect(left.monthlyWinners[0].hasSeenCelebration).toEqual([ids.real])
  })

  test('an already-empty team with no e2e member is not swept up', async () => {
    // Condition 1 of the deletion rule, and the only thing that makes it
    // non-redundant: on condition 2 alone this team qualifies vacuously.
    const t = convexTest(schema, modules)
    const emptyTeam = await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: E2E_ADDRESS, legacyId: undefined }))
      return await ctx.db.insert('teams', aTeam({ name: 'Abandoned', playerIds: [] }))
    })

    expect((await prune(t, true)).teamsDeleted).toBe(0)
    expect((await census(t)).teams.map((tm) => tm._id)).toEqual([emptyTeam])
  })

  test('an unresolvable roster id keeps the team, and is counted', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ghost = await ctx.db.insert('players', aPlayer({ email: REAL_ADDRESS }))
      const debris = await ctx.db.insert(
        'players',
        aPlayer({ email: E2E_ADDRESS, legacyId: undefined }),
      )
      await ctx.db.insert('teams', aTeam({ name: 'Haunted', playerIds: [ghost, debris] }))
      // Delete the player document but leave the roster entry pointing at it —
      // the state a bare db.delete produces, which is what this whole file is
      // defending against.
      await ctx.db.delete(ghost)
    })

    const totals = await prune(t, true)
    expect(totals.teamsDeleted).toBe(0)
    expect(totals.teamsKeptWithUnresolvableMembers).toBe(1)
    expect((await census(t)).teams).toHaveLength(1)
  })
})

describe('push subscriptions', () => {
  // ONE PLAYER, MANY ROWS (schema.ts). A subscription belongs to a browser
  // profile on a device, not to a person, so a single e2e player can leave
  // several behind — one per browser the test drove.
  test('all of an e2e player’s subscriptions are counted and deleted', async () => {
    const t = convexTest(schema, modules)
    const player = await t.run(async (ctx) => {
      const player = await ctx.db.insert(
        'players',
        aPlayer({ email: E2E_ADDRESS, legacyId: undefined }),
      )
      await ctx.db.insert('pushSubscriptions', aPushSubscription(player, { endpoint: 'a' }))
      await ctx.db.insert('pushSubscriptions', aPushSubscription(player, { endpoint: 'b' }))
      await ctx.db.insert('pushSubscriptions', aPushSubscription(player, { endpoint: 'c' }))
      return player
    })

    const totals = await prune(t, true)
    expect(totals.pushSubscriptionsDeleted).toBe(3)

    const left = await census(t)
    expect(left.pushSubscriptions).toHaveLength(0)
    expect(left.players.map((p) => p._id)).not.toContain(player)
  })

  test('a non-e2e player’s subscription survives', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const real = await ctx.db.insert('players', aPlayer({ email: REAL_ADDRESS }))
      await ctx.db.insert('pushSubscriptions', aPushSubscription(real))
      // An unrelated e2e player with no subscription at all, so the prune has
      // something to do.
      await ctx.db.insert('players', aPlayer({ email: E2E_ADDRESS, legacyId: undefined }))
    })

    const totals = await prune(t, true)
    expect(totals.playersDeleted).toBe(1)
    expect(totals.pushSubscriptionsDeleted).toBe(0)
    expect((await census(t)).pushSubscriptions).toHaveLength(1)
  })

  test('the dry run predicts the exact count the write then deletes, and deletes nothing itself', async () => {
    const build = async (t: ReturnType<typeof convexTest>) =>
      await t.run(async (ctx) => {
        const real = await ctx.db.insert('players', aPlayer({ email: REAL_ADDRESS }))
        await ctx.db.insert('pushSubscriptions', aPushSubscription(real))
        const a = await ctx.db.insert(
          'players',
          aPlayer({ email: E2E_ADDRESS, legacyId: undefined }),
        )
        await ctx.db.insert('pushSubscriptions', aPushSubscription(a, { endpoint: 'a-1' }))
        await ctx.db.insert('pushSubscriptions', aPushSubscription(a, { endpoint: 'a-2' }))
        const b = await ctx.db.insert(
          'players',
          aPlayer({ email: E2E_ADDRESS_2, legacyId: undefined }),
        )
        await ctx.db.insert('pushSubscriptions', aPushSubscription(b, { endpoint: 'b-1' }))
      })

    const dry = convexTest(schema, modules)
    await build(dry)
    const before = await census(dry)
    const predicted = await prune(dry, false)
    const after = await census(dry)

    // A BROKEN COUNTER THAT ONLY WORKS UNDER EXECUTE WOULD PASS A TEST THAT
    // ONLY CHECKED THE WRITE. This is the check that catches it: the same
    // number must come back with nothing deleted.
    expect(predicted.pushSubscriptionsDeleted).toBe(3)
    expect(after.pushSubscriptions.map((s) => s._id)).toEqual(
      before.pushSubscriptions.map((s) => s._id),
    )

    const wet = convexTest(schema, modules)
    await build(wet)
    const executed = await prune(wet, true)
    expect(executed.pushSubscriptionsDeleted).toBe(predicted.pushSubscriptionsDeleted)
    expect((await census(wet)).pushSubscriptions).toHaveLength(1)
  })
})

describe('the dry run', () => {
  test('writes nothing at all, and predicts exactly what the write then does', async () => {
    const seed = async (t: ReturnType<typeof convexTest>) =>
      await t.run(async (ctx) => {
        const real = await ctx.db.insert('players', aPlayer({ email: REAL_ADDRESS }))
        const a = await ctx.db.insert(
          'players',
          aPlayer({ email: E2E_ADDRESS, legacyId: `e2e-${E2E_ADDRESS}` }),
        )
        const b = await ctx.db.insert(
          'players',
          aPlayer({ email: E2E_ADDRESS_2, legacyId: undefined }),
        )
        await ctx.db.insert('teams', aTeam({ name: 'Doomed', playerIds: [a, b], owner: a }))
        await ctx.db.insert('teams', aTeam({ name: 'Mixed', playerIds: [real, a], owner: real }))
        await ctx.db.insert('dailyScores', aScore(a))
        await ctx.db.insert('dailyScores', aScore(real))
      })

    const t = convexTest(schema, modules)
    await seed(t)
    const before = await census(t)

    const predicted = await prune(t, false)
    const after = await census(t)

    // NOTHING MOVED. Compared table by table rather than by a single row count,
    // because a dry run that deleted a player and inserted nothing would still
    // change the total, and one that patched a roster would not change it at all.
    expect(after.players.map((p) => p._id)).toEqual(before.players.map((p) => p._id))
    expect(after.teams.map((tm) => tm._id)).toEqual(before.teams.map((tm) => tm._id))
    expect(after.teams.map((tm) => tm.playerIds)).toEqual(before.teams.map((tm) => tm.playerIds))
    expect(after.dailyScores.map((s) => s._id)).toEqual(before.dailyScores.map((s) => s._id))

    expect(predicted.playersDeleted).toBe(2)
    expect(predicted.teamsDeleted).toBe(1)
    expect(predicted.dailyScoresDeleted).toBe(1)
    expect(predicted.teamRostersPatched).toBe(1)

    // THE PREDICTION IS THE POINT. A dry run whose numbers did not match the
    // write it precedes would be worse than no dry run, because the script uses
    // exactly these counts to decide whether to write at all.
    const executed = await prune(t, true)
    expect(executed.playersDeleted).toBe(predicted.playersDeleted)
    expect(executed.teamsDeleted).toBe(predicted.teamsDeleted)
    expect(executed.dailyScoresDeleted).toBe(predicted.dailyScoresDeleted)
    expect(executed.teamRostersPatched).toBe(predicted.teamRostersPatched)
  })

  test('a dry run makes progress rather than looping on the same page', async () => {
    // The reason the scan pages over ALL players and not just matching ones: in
    // dry-run mode nothing is deleted, so a "take the first N still matching"
    // cursor would hand back the same page forever. A page size below the row
    // count is what makes this test able to fail.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (let i = 0; i < 7; i++) {
        await ctx.db.insert('players', aPlayer({ email: `e2e+loop-${i}@wordleteams.com` }))
      }
    })

    const totals = await prune(t, false, 2)
    expect(totals.playersScanned).toBe(7)
    expect(totals.e2ePlayersFound).toBe(7)
  })
})

describe('paging', () => {
  test('a surviving team’s stale invite is counted once, not once per page', async () => {
    // REGRESSION. "Is this an e2e address" does not depend on which page is
    // being processed, so sweeping invites on every page re-counted every
    // surviving team's stale invites every time: the first run against the local
    // backend reported 375 cleared invites for 15 addresses across 25 pages. The
    // dry run is the mode that was wrong, which is the worse half — it is what
    // the operator reads before deciding to write.
    const build = async (t: ReturnType<typeof convexTest>) =>
      await t.run(async (ctx) => {
        const real = await ctx.db.insert('players', aPlayer({ email: REAL_ADDRESS }))
        await ctx.db.insert('teams', aTeam({ name: 'Live', playerIds: [real], invited: [E2E_ADDRESS_2] }))
        for (let i = 0; i < 6; i++) {
          await ctx.db.insert('players', aPlayer({ email: `e2e+inv-${i}@wordleteams.com` }))
        }
      })

    // A page size of 1 forces seven pages; the count must not scale with them.
    const dry = convexTest(schema, modules)
    await build(dry)
    expect((await prune(dry, false, 1)).teamInvitesCleared).toBe(1)

    const wet = convexTest(schema, modules)
    await build(wet)
    expect((await prune(wet, true, 1)).teamInvitesCleared).toBe(1)
    expect((await census(wet)).teams[0].invited).toEqual([])
  })

  test('a team whose members straddle a page boundary is still deleted by the write', async () => {
    // The limitation documented on the deletion rule, pinned in both
    // directions: the WRITE gets the team on the same sweep — the first page
    // trims the roster, the second finds it empty — while the DRY RUN cannot,
    // because nothing was trimmed for the second page to see. A dry run's
    // teamsDeleted is a lower bound, and this is the shape that makes it one.
    const build = async (t: ReturnType<typeof convexTest>) =>
      await t.run(async (ctx) => {
        const a = await ctx.db.insert('players', aPlayer({ email: E2E_ADDRESS }))
        const b = await ctx.db.insert('players', aPlayer({ email: E2E_ADDRESS_2 }))
        await ctx.db.insert('teams', aTeam({ name: 'Straddler', playerIds: [a, b], owner: a }))
      })

    const dry = convexTest(schema, modules)
    await build(dry)
    expect((await prune(dry, false, 1)).teamsDeleted).toBe(0)

    const wet = convexTest(schema, modules)
    await build(wet)
    expect((await prune(wet, true, 1)).teamsDeleted).toBe(1)
    expect((await census(wet)).teams).toHaveLength(0)
  })


  test('the same rows are found whatever the page size', async () => {
    // Guards the one-.paginate()-per-execution limit too: Convex fails at
    // runtime on a second call in one function, so any refactor that added an
    // inner paginate would take these multi-batch runs down.
    const build = async (t: ReturnType<typeof convexTest>) =>
      await t.run(async (ctx) => {
        for (let i = 0; i < 9; i++) {
          const p = await ctx.db.insert(
            'players',
            aPlayer({ email: `e2e+page-${i}@wordleteams.com`, legacyId: undefined }),
          )
          await ctx.db.insert('teams', aTeam({ name: `T${i}`, playerIds: [p], owner: p }))
          await ctx.db.insert('dailyScores', aScore(p))
        }
        await ctx.db.insert('players', aPlayer({ email: REAL_ADDRESS }))
      })

    for (const pageSize of [1, 2, 4, 100]) {
      const t = convexTest(schema, modules)
      await build(t)
      const totals = await prune(t, true, pageSize)
      expect({ pageSize, ...totals }).toMatchObject({
        pageSize,
        playersScanned: 10,
        e2ePlayersFound: 9,
        playersDeleted: 9,
        teamsDeleted: 9,
        dailyScoresDeleted: 9,
      })
      const left = await census(t)
      expect(left.players).toHaveLength(1)
      expect(left.teams).toHaveLength(0)
    }
  })
})
