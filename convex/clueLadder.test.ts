import { convexTest } from 'convex-test'
import type { GenericDatabaseWriter } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { requirePlausibleToday } from './access'
import { aPlayer, aTeam, authenticatedAs, makeRegisterBetterAuth } from './fixtures.ts'
import { ensurePuzzleFor, puzzleOn, startFor, todayFor, writePlayFor } from './clueLadder'
import { clueText } from './lib/clueLadder/clues.ts'
import { SHAPES } from './lib/clueLadder/orders.ts'
import { puzzleForDate } from './lib/clueLadder/seed.ts'
import { isPassedDate } from './lib/games.ts'
import { addDays, toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
const registerBetterAuth = makeRegisterBetterAuth(import.meta.glob('./betterAuth/**/*.ts'))
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

type Ctx = { db: GenericDatabaseWriter<DataModel> }

const EMPTY = [null, null, null, null, null]

/** A player on one team, opted in unless told otherwise. */
async function aClueLadderPlayer(ctx: Ctx, optedIn = true) {
  const playerId = await ctx.db.insert('players', aPlayer())
  await ctx.db.insert('teams', aTeam({ playerIds: [playerId], owner: playerId, clueLadderEnabled: optedIn }))
  return playerId
}

async function nothingWritten(ctx: Ctx) {
  expect(await ctx.db.query('clueLadderPlays').collect()).toEqual([])
  expect(await ctx.db.query('clueLadderPuzzles').collect()).toEqual([])
}

describe('startFor', () => {
  test('creates the puzzle and the play, with clue 1 revealed, once', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await startFor(ctx, playerId, today)
      await startFor(ctx, playerId, today)
      const plays = await ctx.db.query('clueLadderPlays').collect()
      expect(plays).toHaveLength(1)
      expect(plays[0]).toMatchObject({ playerId, date: today, cluesRevealed: 1, status: 'playing', scratch: EMPTY })
      expect(await ctx.db.query('clueLadderPuzzles').collect()).toHaveLength(1)
    })
  })

  test.each([
    ['CLUE_LADDER_ENABLED', ''],
    ['CLUE_LADDER_SEED', ''],
  ])('refuses with %s=%j, writing nothing', async (name, value) => {
    vi.stubEnv(name, value)
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(startFor(ctx, playerId, today)).rejects.toMatchObject({ data: { code: 'CLUE_LADDER_DISABLED' } })
      await nothingWritten(ctx)
    })
  })

  test('refuses a player on no opted-in team', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx, false)
      await expect(startFor(ctx, playerId, today)).rejects.toMatchObject({ data: { code: 'CLUE_LADDER_NOT_ON_TEAM' } })
      await nothingWritten(ctx)
    })
  })

  test('refuses a past date: there is no backfill', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(startFor(ctx, playerId, addDays(today, -2))).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })
      await nothingWritten(ctx)
    })
  })
})

describe('todayFor', () => {
  test('before start: not started, and nothing about the puzzle', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await ensurePuzzleFor(ctx, today)
      expect(await todayFor(ctx, playerId, today)).toEqual({ status: 'not-started', date: today })
    })
  })

  test('while playing: the revealed clues only, and no answer', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await startFor(ctx, playerId, today)
      const puzzle = await puzzleOn(ctx, today)
      if (!puzzle) throw new Error('no puzzle')

      const view = await todayFor(ctx, playerId, today)
      // toEqual is exact, so no answer, remaining or later clue can ride along.
      expect(view).toEqual({
        status: 'playing',
        date: today,
        cluesRevealed: 1,
        clues: [clueText(puzzle.clues[0])],
        scratch: EMPTY,
      })
      const json = JSON.stringify(view)
      for (const hidden of puzzle.clues.slice(1)) expect(json).not.toContain(clueText(hidden))
    })
  })
})

describe('writePlayFor', () => {
  const playing = { cluesRevealed: 1, status: 'playing' as const, scratch: EMPTY }

  test('refuses a passed date, which the scoreboard already counts as X', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(writePlayFor(ctx, playerId, addDays(today, -2), null, playing)).rejects.toMatchObject({
        data: { code: 'INVALID_DATE' },
      })
      await nothingWritten(ctx)
    })
  })

  test.each([0, 7, 1.5])('refuses cluesRevealed %s', async (cluesRevealed) => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(writePlayFor(ctx, playerId, today, null, { ...playing, cluesRevealed })).rejects.toThrow(
        /cluesRevealed/,
      )
      await nothingWritten(ctx)
    })
  })

  test('refuses a lock-in on a different clue from the one revealed', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      const write = { ...playing, status: 'solved' as const, cluesRevealed: 3, lockedAtClue: 2, lockedOrder: [...SHAPES] }
      await expect(writePlayFor(ctx, playerId, today, null, write)).rejects.toThrow(/lockedAtClue/)
      await nothingWritten(ctx)
    })
  })

  test('refuses a finished status without a lock-in', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(writePlayFor(ctx, playerId, today, null, { ...playing, status: 'failed' })).rejects.toThrow(
        /status failed/,
      )
      await nothingWritten(ctx)
    })
  })

  test('every day requirePlausibleToday accepts is live by isPassedDate', () => {
    // The two rules must agree, or a writer could accept a day the scoreboard has
    // already scored X. Pinned here, where both are used.
    const serverToday = toPuzzleDay(new Date())
    for (const delta of [-1, 0, 1]) expect(isPassedDate(addDays(serverToday, delta), serverToday)).toBe(false)
    expect(isPassedDate(addDays(serverToday, -2), serverToday)).toBe(true)
    expect(() => requirePlausibleToday(addDays(serverToday, -2))).toThrow()
  })
})

describe('who may play', () => {
  test('an opted-in team the player is not on does not count', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx, false)
      const otherId = await ctx.db.insert('players', aPlayer({ email: 'other@example.com' }))
      await ctx.db.insert('teams', aTeam({ playerIds: [otherId], owner: otherId, clueLadderEnabled: true }))
      await expect(startFor(ctx, playerId, today)).rejects.toMatchObject({ data: { code: 'CLUE_LADDER_NOT_ON_TEAM' } })
      await nothingWritten(ctx)
    })
  })
})

describe('writePlayFor, the shape of a write', () => {
  const playing = { cluesRevealed: 1, status: 'playing' as const, scratch: EMPTY }

  test('refuses a scratch that is not five slots', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(writePlayFor(ctx, playerId, today, null, { ...playing, scratch: [null] })).rejects.toThrow(
        /scratch has 1 slots/,
      )
      await nothingWritten(ctx)
    })
  })

  test('refuses a lock-in on a play still playing', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      const write = { ...playing, lockedAtClue: 1, lockedOrder: [...SHAPES] }
      await expect(writePlayFor(ctx, playerId, today, null, write)).rejects.toThrow(/status playing/)
      await nothingWritten(ctx)
    })
  })

  test('refuses a finished status with a lock-in clue but no locked order', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      const write = { ...playing, status: 'solved' as const, lockedAtClue: 1 }
      await expect(writePlayFor(ctx, playerId, today, null, write)).rejects.toThrow(/status solved/)
      await nothingWritten(ctx)
    })
  })

  test('accepts a well-formed finished write and stores it', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      const write = { ...playing, status: 'solved' as const, cluesRevealed: 6, lockedAtClue: 6, lockedOrder: [...SHAPES] }
      await writePlayFor(ctx, playerId, addDays(today, -1), null, write)
      const plays = await ctx.db.query('clueLadderPlays').collect()
      expect(plays).toHaveLength(1)
      expect(plays[0]).toMatchObject({ playerId, date: addDays(today, -1), ...write })
    })
  })
})

describe('today (the query)', () => {
  const ME = 'member@example.com'

  async function asOptedInPlayer(optedIn = true) {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    await t.run(async (ctx) => {
      await aClueLadderPlayer(ctx, optedIn)
    })
    return await authenticatedAs(t, ME)
  }

  test.each([
    ['CLUE_LADDER_ENABLED', ''],
    ['CLUE_LADDER_SEED', ''],
  ])('answers enabled: false with %s=%j', async (name, value) => {
    vi.stubEnv(name, value)
    const asMe = await asOptedInPlayer()
    expect(await asMe.query(api.clueLadder.today, { today })).toEqual({ enabled: false })
  })

  test('answers enabled: false to a player on no opted-in team', async () => {
    const asMe = await asOptedInPlayer(false)
    expect(await asMe.query(api.clueLadder.today, { today })).toEqual({ enabled: false })
  })

  test('uses the client’s today when it is plausible', async () => {
    const asMe = await asOptedInPlayer()
    const tomorrow = addDays(today, 1)
    expect(await asMe.query(api.clueLadder.today, { today: tomorrow })).toEqual({
      enabled: true,
      play: { status: 'not-started', date: tomorrow },
    })
  })

  test.each([[addDays(today, -2)], [addDays(today, 2)], ['not-a-date']])(
    'falls back to the server’s day for %j instead of throwing',
    async (clientToday) => {
      const asMe = await asOptedInPlayer()
      expect(await asMe.query(api.clueLadder.today, { today: clientToday })).toEqual({
        enabled: true,
        play: { status: 'not-started', date: today },
      })
    },
  )

  test('start, then today shows the game in play', async () => {
    const asMe = await asOptedInPlayer()
    await asMe.mutation(api.clueLadder.start, { today })
    const res = await asMe.query(api.clueLadder.today, { today })
    expect(res).toMatchObject({ enabled: true, play: { status: 'playing', date: today, cluesRevealed: 1 } })
  })
})
