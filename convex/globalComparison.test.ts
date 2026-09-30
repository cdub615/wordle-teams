import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer } from './fixtures.ts'
import { MIN_GLOBAL_CONTRIBUTORS } from './lib/globalThreshold.ts'
import type { Id } from './_generated/dataModel'
import type { DataModel } from './_generated/dataModel'
import type { GenericDatabaseWriter } from 'convex/server'

/**
 * LAYER 4, AT BOTH SIDES OF THE THRESHOLD.
 *
 * The rule itself is unit-tested in lib/globalThreshold.test.ts. What is proven
 * here is the property the layer's whole design rests on: that against REAL DATA
 * VOLUMES nothing renders, and that it lights up on its own — no flag, nothing to
 * remember to switch.
 *
 * Driven through the db rather than the public query, which needs a Better Auth
 * session the harness cannot mint (wordle-teams-obw). The slice arithmetic is
 * exercised directly against the same helper the query uses.
 */

const modules = import.meta.glob('./**/*.ts')
type Ctx = { db: GenericDatabaseWriter<DataModel> }

const DAY = '2026-09-08'

/** `players` distinct people, each with one board on DAY. */
async function seedDay(ctx: Ctx, players: number, attempts = 4): Promise<Id<'players'>[]> {
  const ids: Id<'players'>[] = []
  for (let i = 0; i < players; i++) {
    const playerId = await ctx.db.insert('players', aPlayer({ email: `p${i}@example.com` }))
    ids.push(playerId)
    await ctx.db.insert('dailyScores', {
      playerId,
      puzzleDay: DAY,
      date: Date.now(),
      answer: 'SPEED',
      guesses: ['CRANE', ...Array.from({ length: attempts - 2 }, () => 'MOIST'), 'SPEED'].slice(
        0,
        attempts,
      ),
    })
  }
  return ids
}

const boardsOn = async (ctx: Ctx, puzzleDay: string) =>
  await ctx.db
    .query('dailyScores')
    .withIndex('by_puzzleDay', (q) => q.eq('puzzleDay', puzzleDay))
    .collect()

describe('the day slice against real data volumes', () => {
  /**
   * THE PROPERTY THE WHOLE LAYER RESTS ON. Production has 70 activated players
   * with ten holding most of the boards, so a single day's cohort is nowhere near
   * 30 — the layer is dark BY CONSTRUCTION rather than by a switch.
   */
  test('a day at today’s real volumes has too few contributors to render', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      // Generous: more players on one day than production sees.
      await seedDay(ctx, 12)
      const boards = await boardsOn(ctx, DAY)
      const contributors = new Set(boards.map((b) => b.playerId)).size

      expect(contributors).toBeLessThan(MIN_GLOBAL_CONTRIBUTORS)
    })
  })

  test('one prolific player is one contributor, however many boards they hold', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      // Same player, many DIFFERENT days — the day slice still sees one of them.
      for (let i = 1; i <= 28; i++) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay: `2026-09-${String(i).padStart(2, '0')}`,
          date: Date.now(),
          answer: 'SPEED',
          guesses: ['CRANE', 'SPEED'],
        })
      }
      const boards = await boardsOn(ctx, '2026-09-08')
      expect(new Set(boards.map((b) => b.playerId)).size).toBe(1)
    })
  })

  test('one below the threshold is still too few', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedDay(ctx, MIN_GLOBAL_CONTRIBUTORS - 1)
      const boards = await boardsOn(ctx, DAY)
      expect(new Set(boards.map((b) => b.playerId)).size).toBe(MIN_GLOBAL_CONTRIBUTORS - 1)
    })
  })

  /**
   * The other direction, which is what makes the pair non-vacuous: the layer is
   * dark because of the DATA, not because it cannot light up.
   */
  test('at exactly the threshold the slice becomes renderable', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedDay(ctx, MIN_GLOBAL_CONTRIBUTORS)
      const boards = await boardsOn(ctx, DAY)
      expect(new Set(boards.map((b) => b.playerId)).size).toBe(MIN_GLOBAL_CONTRIBUTORS)
    })
  })

  test('the day slice counts only that day, not the whole table', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      await seedDay(ctx, 5)
      for (let i = 0; i < 40; i++) {
        const playerId = await ctx.db.insert('players', aPlayer({ email: `other${i}@example.com` }))
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay: '2026-09-01',
          date: Date.now(),
          answer: 'SPEED',
          guesses: ['CRANE', 'SPEED'],
        })
      }
      const boards = await boardsOn(ctx, DAY)
      // Forty players on another day must not light up this one.
      expect(new Set(boards.map((b) => b.playerId)).size).toBe(5)
    })
  })
})
