import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
const today = toPuzzleDay(new Date())
const EMAIL = 'e2e+clue-seed@wordleteams.com'

beforeEach(() => {
  vi.stubEnv('E2E_TEST_MODE', 'true')
  vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
  vi.stubEnv('CLUE_LADDER_SEED', 'clue-ladder-test-secret-0123456789')
})
afterEach(() => vi.unstubAllEnvs())

describe('seedClueLadderFor', () => {
  test('opts the account’s own team in and returns today’s answer', async () => {
    const t = convexTest(schema, modules)
    const teamId = await t.mutation(api.e2eSeed.ensureTeamFor, { email: EMAIL })
    const { answer } = await t.mutation(api.e2eSeed.seedClueLadderFor, { email: EMAIL, today })
    await t.run(async (ctx) => {
      expect((await ctx.db.get(teamId))?.clueLadderEnabled).toBe(true)
      expect((await ctx.db.get(teamId))?.clueLadderOnSince).toBe(today)
      const puzzle = await ctx.db
        .query('clueLadderPuzzles')
        .withIndex('by_date', (q) => q.eq('date', today))
        .first()
      expect(answer).toEqual(puzzle?.answer)
    })
  })

  test('refuses an address that is not e2e traffic', async () => {
    const t = convexTest(schema, modules)
    await expect(t.mutation(api.e2eSeed.seedClueLadderFor, { email: 'ada@example.test', today })).rejects.toThrow(
      /only available in E2E test mode/,
    )
  })

  test('refuses an e2e address when E2E_TEST_MODE is not set', async () => {
    const t = convexTest(schema, modules)
    await t.mutation(api.e2eSeed.ensureTeamFor, { email: EMAIL })
    vi.stubEnv('E2E_TEST_MODE', '')
    await expect(t.mutation(api.e2eSeed.seedClueLadderFor, { email: EMAIL, today })).rejects.toThrow(
      /only available in E2E test mode/,
    )
  })
})
