import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

// Insert/read coverage for each of the six ported tables, plus the three
// corrections the 2026-07-16 design could not have known about. These are
// schema tests: they exercise the shape and the indexes, not business logic,
// which arrives with the phases that own it.

const aPlayer = (over: Partial<Record<string, unknown>> = {}) => ({
  legacyId: '11111111-1111-4111-8111-111111111111',
  email: 'player@example.com',
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '18:00:00',
  ...over,
})

const aTeam = (over: Partial<Record<string, unknown>> = {}) => ({
  legacyId: 206,
  name: 'team 206',
  playerIds: [],
  invited: [],
  oneGuess: 6,
  twoGuesses: 5,
  threeGuesses: 4,
  fourGuesses: 3,
  fiveGuesses: 2,
  sixGuesses: 1,
  failed: 0,
  nA: 0,
  playWeekends: true,
  showLetters: true,
  ...over,
})

describe('players', () => {
  test('round-trips and is reachable by legacyId and by email', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('players', aPlayer({ firstName: 'Ada' }))

      const byLegacy = await ctx.db
        .query('players')
        .withIndex('by_legacyId', (q) => q.eq('legacyId', '11111111-1111-4111-8111-111111111111'))
        .unique()
      expect(byLegacy?._id).toBe(id)
      expect(byLegacy?.firstName).toBe('Ada')
      // Optional in the port because Supabase allows null: a player invited but
      // not yet through complete-profile has no name at all.
      expect(byLegacy?.lastName).toBeUndefined()

      const byEmail = await ctx.db
        .query('players')
        .withIndex('by_email', (q) => q.eq('email', 'player@example.com'))
        .unique()
      expect(byEmail?._id).toBe(id)
    })
  })
})

describe('teams', () => {
  test('round-trips with player references and per-team scoring', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      const team = await ctx.db.get(teamId)
      expect(team?.playerIds).toEqual([playerId])
      expect(team?.oneGuess).toBe(6)
      expect(team?.creator).toBeUndefined()
    })
  })

  test('invited holds lowercase addresses — the bug a faithful port would inherit', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      // What the copy script must write: normalised on the way in. v1 stored
      // 'Case.Test@example.com' here while auth stored the lowercase form, so
      // handle_invited_signup never matched and the invitee never joined.
      const teamId = await ctx.db.insert('teams', aTeam({ invited: ['case.test@example.com'] }))
      const team = await ctx.db.get(teamId)
      expect(team?.invited).toEqual(['case.test@example.com'])
      expect(team?.invited.every((e) => e === e.toLowerCase())).toBe(true)
    })
  })
})

describe('dailyScores', () => {
  test('round-trips and is reachable by player and puzzle day', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('dailyScores', {
        legacyId: 1,
        playerId,
        puzzleDay: '2026-08-11',
        date: Date.parse('2026-08-11T06:00:00Z'),
        guesses: ['crane', 'slate', 'tests'],
        answer: 'tests',
      })

      const found = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) =>
          q.eq('playerId', playerId).eq('puzzleDay', '2026-08-11'),
        )
        .unique()
      expect(found?.guesses).toHaveLength(3)
      expect(found?.answer).toBe('tests')
    })
  })

  test('a board is found by its puzzle day regardless of the viewer, which is the v1 bug', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())

      // A traveller in Auckland (UTC+13) enters the 12 August puzzle at 09:00
      // local — which is 2026-08-11T20:00Z, still the 11th in UTC and the 11th
      // in the US. v1 stored only that instant and each viewer re-derived the
      // day locally, so a teammate in Chicago looked for the 12th and found
      // nothing. Here the day is a stored fact, so the lookup is viewer-independent.
      await ctx.db.insert('dailyScores', {
        legacyId: 3,
        playerId,
        puzzleDay: '2026-08-12',
        date: Date.parse('2026-08-11T20:00:00Z'),
        guesses: ['crane'],
      })

      const asTeammateSees = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) =>
          q.eq('playerId', playerId).eq('puzzleDay', '2026-08-12'),
        )
        .unique()
      expect(asTeammateSees).not.toBeNull()

      // And it must NOT appear on the day a naive UTC read of the instant gives.
      const naiveUtcDay = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) =>
          q.eq('playerId', playerId).eq('puzzleDay', '2026-08-11'),
        )
        .unique()
      expect(naiveUtcDay).toBeNull()
    })
  })

  test('answer is optional — v1 rows exist without one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const id = await ctx.db.insert('dailyScores', {
        legacyId: 2,
        playerId,
        puzzleDay: '2026-08-10',
        date: Date.parse('2026-08-10T06:00:00Z'),
        guesses: [],
      })
      expect((await ctx.db.get(id))?.answer).toBeUndefined()
    })
  })
})

describe('monthlyWinners', () => {
  test('round-trips and is reachable by team, year and month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('monthlyWinners', {
        legacyId: 1,
        playerId,
        teamId,
        year: 2026,
        month: 7,
        hasSeenCelebration: [playerId],
      })

      const found = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) =>
          q.eq('teamId', teamId).eq('year', 2026).eq('month', 7),
        )
        .unique()
      expect(found?.playerId).toBe(playerId)
      expect(found?.hasSeenCelebration).toEqual([playerId])
    })
  })
})

describe('playerMembership', () => {
  test('round-trips every status the Postgres enum allowed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      for (const status of ['new', 'free', 'pro', 'cancelled', 'expired'] as const) {
        const id = await ctx.db.insert('playerMembership', {
          legacyId: `legacy-${status}`,
          playerId,
          membershipStatus: status,
        })
        expect((await ctx.db.get(id))?.membershipStatus).toBe(status)
      }
    })
  })

  test('carries no customerId or membershipVariant — the Polar migration dropped both', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const id = await ctx.db.insert('playerMembership', {
        legacyId: 'legacy-1',
        playerId,
        membershipStatus: 'pro',
      })
      const row = await ctx.db.get(id)
      // Guards against someone "restoring parity" with the pre-migration schema.
      expect(row).not.toHaveProperty('customerId')
      expect(row).not.toHaveProperty('membershipVariant')
    })
  })
})

describe('webhookEvents', () => {
  test('accepts a Standard Webhooks id, which is not a uuid', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      // The literal example from the Standard Webhooks spec. A uuid column
      // rejected exactly this in v1 and put Polar into an infinite retry loop.
      const webhookId = 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W'
      await ctx.db.insert('webhookEvents', {
        legacyId: 1,
        webhookId,
        playerId,
        eventName: 'subscription.active',
        body: { data: { id: 'sub_123' } },
        processed: true,
      })

      const found = await ctx.db
        .query('webhookEvents')
        .withIndex('by_webhookId', (q) => q.eq('webhookId', webhookId))
        .unique()
      expect(found?.eventName).toBe('subscription.active')
    })
  })

  test('by_webhookId supports the replay guard Convex cannot express as a constraint', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const webhookId = 'msg_duplicate'
      const base = {
        playerId,
        eventName: 'subscription.active',
        body: {},
        processed: true,
        webhookId,
      }
      await ctx.db.insert('webhookEvents', { ...base, legacyId: 1 })
      await ctx.db.insert('webhookEvents', { ...base, legacyId: 2 })

      // Convex has no unique index, so a duplicate CAN be written. Phase 5's
      // handler must look here first and return early — this asserts the index
      // makes that lookup possible, and documents why the guard is code.
      const all = await ctx.db
        .query('webhookEvents')
        .withIndex('by_webhookId', (q) => q.eq('webhookId', webhookId))
        .collect()
      expect(all).toHaveLength(2)
    })
  })

  test('webhookId is optional — legacy Lemon Squeezy rows predate it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const id = await ctx.db.insert('webhookEvents', {
        legacyId: 3,
        playerId,
        eventName: 'subscription_created',
        body: {},
        processed: true,
      })
      expect((await ctx.db.get(id))?.webhookId).toBeUndefined()
    })
  })
})

describe('natively-created rows', () => {
  test('a board entered in v2 needs no legacyId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      // No legacyId: this row was born in v2, not copied from Supabase.
      const id = await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-08-18',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['GEESE', 'SPEED'],
      })
      const row = await ctx.db.get(id)
      expect(row?.legacyId).toBeUndefined()
    })
  })

  test('a winner row computed in v2 needs no legacyId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const id = await ctx.db.insert('monthlyWinners', {
        playerId,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })
      const row = await ctx.db.get(id)
      expect(row?.legacyId).toBeUndefined()
    })
  })
})

describe('teams.legacyId', () => {
  test('accepts a team created natively in v2, with no legacyId', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('teams', {
        name: 'Born in v2',
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
      })
      const team = await ctx.db.get(id)
      expect(team?.legacyId).toBeUndefined()
    })
  })

  test('still accepts a copied team carrying its Supabase primary key', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const id = await ctx.db.insert('teams', {
        legacyId: 206,
        name: 'Copied',
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
      })
      expect((await ctx.db.get(id))?.legacyId).toBe(206)
    })
  })
})
