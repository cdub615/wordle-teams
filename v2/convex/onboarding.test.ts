import { describe, expect, test } from 'vitest'
import { convexTest } from 'convex-test'
import betterAuthTest from '@convex-dev/better-auth/test'
import schema from './schema.ts'
import { api } from './_generated/api'
import { aPlayer, authenticatedAs } from './fixtures.ts'

// Every convexTest call site in this repo passes `modules`; see chat.test.ts:35.
const modules = import.meta.glob('./**/*.ts')

describe('onboarding.getStatus', () => {
  test('is null for a caller with no player row', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const as = await authenticatedAs(t, 'nobody@example.com')
    expect(await as.query(api.onboarding.getStatus, {})).toBeNull()
  })

  test('enteredBoard is false with no boards at all', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'a@example.com' }))
    })
    const as = await authenticatedAs(t, 'a@example.com')
    expect(await as.query(api.onboarding.getStatus, {})).toEqual({
      enteredBoard: false,
      dismissed: false,
    })
  })

  test('a row with EMPTY guesses does not count as entered', async () => {
    // Migrated v1 rows predate v2's delete-on-empty rule (scores.ts:233), so
    // empty-guess rows exist in copied data. wordle-teams-456 counts non-empty
    // guesses for exactly this reason: without the filter every migrated empty
    // row reads as an activation and the number is inflated.
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ email: 'b@example.com' }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-01',
        date: Date.now(),
        answer: '',
        guesses: [],
      })
    })
    const as = await authenticatedAs(t, 'b@example.com')
    expect((await as.query(api.onboarding.getStatus, {}))?.enteredBoard).toBe(false)
  })

  test('a row with real guesses counts as entered', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ email: 'c@example.com' }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-01',
        date: Date.now(),
        answer: 'crane',
        guesses: ['stare', 'crane'],
      })
    })
    const as = await authenticatedAs(t, 'c@example.com')
    expect((await as.query(api.onboarding.getStatus, {}))?.enteredBoard).toBe(true)
  })

  test('finds a non-empty row even when an empty one sorts first', async () => {
    // The scan must not stop at the first row it sees.
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer({ email: 'd@example.com' }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-01',
        date: Date.now(),
        answer: '',
        guesses: [],
      })
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-02',
        date: Date.now(),
        answer: 'crane',
        guesses: ['crane'],
      })
    })
    const as = await authenticatedAs(t, 'd@example.com')
    expect((await as.query(api.onboarding.getStatus, {}))?.enteredBoard).toBe(true)
  })

  test("does not see another player's boards", async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'mine@example.com' }))
      const otherId = await ctx.db.insert('players', aPlayer({ email: 'other@example.com' }))
      await ctx.db.insert('dailyScores', {
        playerId: otherId,
        puzzleDay: '2026-09-01',
        date: Date.now(),
        answer: 'crane',
        guesses: ['crane'],
      })
    })
    const as = await authenticatedAs(t, 'mine@example.com')
    expect((await as.query(api.onboarding.getStatus, {}))?.enteredBoard).toBe(false)
  })
})

describe('onboarding.dismiss and replay', () => {
  test('dismiss sets the flag and replay clears it', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'e@example.com' }))
    })
    const as = await authenticatedAs(t, 'e@example.com')

    await as.mutation(api.onboarding.dismiss, {})
    expect((await as.query(api.onboarding.getStatus, {}))?.dismissed).toBe(true)

    await as.mutation(api.onboarding.replay, {})
    expect((await as.query(api.onboarding.getStatus, {}))?.dismissed).toBe(false)
  })

  test('dismiss is idempotent', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run(async (ctx) => {
      await ctx.db.insert('players', aPlayer({ email: 'f@example.com' }))
    })
    const as = await authenticatedAs(t, 'f@example.com')
    await as.mutation(api.onboarding.dismiss, {})
    await as.mutation(api.onboarding.dismiss, {})
    expect((await as.query(api.onboarding.getStatus, {}))?.dismissed).toBe(true)
  })
})
