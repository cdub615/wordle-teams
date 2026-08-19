import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { getTeamMonthFor } from './scores'

const modules = import.meta.glob('./**/*.ts')

export const aPlayer = (over: Record<string, unknown> = {}) => ({
  legacyId: '11111111-1111-4111-8111-111111111111',
  email: 'member@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '18:00:00',
  ...over,
})

export const aTeam = (over: Record<string, unknown> = {}) => ({
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

describe('getTeamMonthFor', () => {
  test('returns only the requested month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      for (const puzzleDay of ['2026-07-31', '2026-08-01', '2026-08-31', '2026-09-01']) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }

      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(result.players[0].scores.map((s) => s.puzzleDay)).toEqual([
        '2026-08-01',
        '2026-08-31',
      ])
    })
  })

  test('carries the team settings and scoring system the table needs', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId], playWeekends: false }))
      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(result.team.playWeekends).toBe(false)
      expect(result.team.system.oneGuess).toBe(5)
      expect(result.team.system.failed).toBe(-3)
    })
  })

  test('does not leak the team doc onto the wire — `invited` holds real email addresses', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [playerId], invited: ['someone@example.com'] }),
      )
      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')

      // A `teams` doc structurally satisfies the payload shape, so a change
      // that swaps the explicit `system: {...}` pick for `system: team` (or
      // otherwise spreads the raw doc onto `result.team`) would leak `invited`
      // — this is a public repo and that array holds real user email
      // addresses. Assert both that it's absent and that `system` carries
      // exactly the scoring fields, not the whole team doc.
      expect(result.team).not.toHaveProperty('invited')
      expect(Object.keys(result.team.system).sort()).toEqual(
        [
          'failed',
          'fiveGuesses',
          'fourGuesses',
          'nA',
          'oneGuess',
          'sixGuesses',
          'threeGuesses',
          'twoGuesses',
        ].sort(),
      )
    })
  })

  test('reads only the target month, not the whole history — a bandwidth regression guard', async () => {
    // wordle-teams-dcu: database BANDWIDTH, not function calls, is the binding
    // free-tier limit, and Convex re-pushes a query's whole read-set to every
    // subscriber on every write that touches it. The property that matters is
    // the NUMBER OF DOCUMENTS READ, not the returned rows — an implementation
    // that swaps the index range query for `.collect()` + a JS `.filter()`
    // returns an IDENTICAL result (all the other tests in this file would
    // still pass) while reading every score the player has ever submitted.
    // `transactionLimits.documentsRead` is what catches that: convex-test
    // throws mid-query the moment the read count crosses the budget,
    // regardless of what the query eventually returns. DO NOT "simplify" this
    // into an assertion on `result` — that is exactly the shape that failed
    // to catch the regression this test exists to prevent.
    const t = convexTest({
      schema,
      modules,
      // A bounded read costs 1 (team) + 1 (member) + 2 (in-range scores) = 4
      // documents. 20 leaves comfortable headroom above that while staying
      // far below the ~64 an unbounded collect-then-filter would read.
      transactionLimits: { documentsRead: 20 },
    })
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      // 60 scores well outside the requested month...
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
          date: 1_700_000_000_000 + i,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }
      // ...and 2 inside it.
      for (const puzzleDay of ['2026-08-01', '2026-08-31']) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }

      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(result.players[0].scores).toHaveLength(2)
    })
  })

  test('omits players who have not completed their profile', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const namedId = await ctx.db.insert('players', aPlayer())
      // A just-accepted invitee is in player_ids but has no name yet. v1's
      // getTeams filters these out because fromDbPlayer throws without names.
      const namelessId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '33333333-3333-4333-8333-333333333333',
          email: 'invited@example.com',
          firstName: undefined,
          lastName: undefined,
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [namedId, namelessId] }))

      const result = await getTeamMonthFor(ctx, namedId, teamId, '2026-08')
      expect(result.players).toHaveLength(1)
      expect(result.players[0].id).toBe(namedId)
    })
  })

  test('refuses a non-member', async () => {
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

      await expect(getTeamMonthFor(ctx, outsiderId, teamId, '2026-08')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})
