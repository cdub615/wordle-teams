import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { ensurePuzzleFor } from './clueLadder'
import { puzzleForDate } from './lib/clueLadder/seed.ts'
import { toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
const SECRET = 'clue-ladder-test-secret-0123456789'
// The real clock, as teamGameMonth.test.ts does: requirePlausibleToday reads it.
const today = toPuzzleDay(new Date())

beforeEach(() => {
  vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
  vi.stubEnv('CLUE_LADDER_SEED', SECRET)
})
afterEach(() => vi.unstubAllEnvs())

describe('ensurePuzzleFor', () => {
  test('creates the date’s puzzle once, from the secret', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const first = await ensurePuzzleFor(ctx, today)
      const again = await ensurePuzzleFor(ctx, today)
      expect(again._id).toBe(first._id)
      expect(await ctx.db.query('clueLadderPuzzles').collect()).toHaveLength(1)

      const expected = await puzzleForDate(SECRET, today)
      expect(first).toMatchObject({
        date: today,
        answer: [...expected.answer],
        clues: expected.clues,
        remaining: expected.remaining,
        generatorVersion: 1,
        fallback: expected.fallback,
      })
    })
  })

  test.each([[undefined], [''], ['too-short']])('refuses with seed %j, writing nothing', async (secret) => {
    vi.stubEnv('CLUE_LADDER_SEED', secret)
    await convexTest(schema, modules).run(async (ctx) => {
      await expect(ensurePuzzleFor(ctx, today)).rejects.toMatchObject({ data: { code: 'CLUE_LADDER_DISABLED' } })
      expect(await ctx.db.query('clueLadderPuzzles').collect()).toEqual([])
    })
  })

  test('refuses to store a ladder that breaks the rules', async () => {
    const broken = async (secret: string, date: string) => ({ ...(await puzzleForDate(secret, date)), clues: [] })
    await convexTest(schema, modules).run(async (ctx) => {
      await expect(ensurePuzzleFor(ctx, today, broken)).rejects.toThrow(/breaks rule 'length'/)
      expect(await ctx.db.query('clueLadderPuzzles').collect()).toEqual([])
    })
  })
})
