import { convexTest } from 'convex-test'
import type { GenericDatabaseWriter } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { requireCurrentSomewhere } from './access'
import { aPlayer, aTeam, authenticatedAs, makeRegisterBetterAuth } from './fixtures.ts'
import {
  ensurePuzzleFor,
  lockInFor,
  nextClueFor,
  playOn,
  puzzleOn,
  saveScratchFor,
  startFor,
  todayFor,
  writePlayFor,
  type PlayWrite,
} from './clueLadder'
import { clueText } from './lib/clueLadder/clues.ts'
import { survivors } from './lib/clueLadder/ladder.ts'
import { SHAPES } from './lib/clueLadder/orders.ts'
import { puzzleForDate } from './lib/clueLadder/seed.ts'
import { FAILED_ATTEMPTS, GAMES, isPassedDate } from './lib/games.ts'
import { addDays, toPuzzleDay } from './lib/puzzleDay.ts'

const modules = import.meta.glob('./**/*.ts')
const registerBetterAuth = makeRegisterBetterAuth(import.meta.glob('./betterAuth/**/*.ts'))
const SECRET = 'clue-ladder-test-secret-0123456789'
// A FIXED CLOCK, at noon UTC. requireCurrentSomewhere reads it, and its window
// moves with the hour: at noon the dates current somewhere are today and
// tomorrow, so a real clock would make every tomorrow test depend on when it ran.
const NOON = Date.parse('2026-06-08T12:00:00Z')
const today = '2026-06-08'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOON)
  vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
  vi.stubEnv('CLUE_LADDER_SEED', SECRET)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

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
    // ensurePuzzleFor throws the same code for the seed, so the seed half of clueLadderPlayable is pinned by the `today` query test.
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

  test('refuses tomorrow while it has started nowhere, and allows it once it has (wordle-teams-9j7o.2.3.3)', async () => {
    const tomorrow = addDays(today, 1)
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      vi.setSystemTime(Date.parse(`${today}T09:59:59Z`))
      await expect(startFor(ctx, playerId, tomorrow)).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })
      await nothingWritten(ctx)
      vi.setSystemTime(Date.parse(`${today}T10:00:00Z`))
      await startFor(ctx, playerId, tomorrow)
      expect(await playOn(ctx, playerId, tomorrow)).toMatchObject({ status: 'playing', cluesRevealed: 1 })
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

  test('every day requireCurrentSomewhere accepts is live by isPassedDate, at any hour', () => {
    // The two rules must agree, or a writer could accept a day the scoreboard has
    // already scored X. Pinned here, where both are used. Every hour of the UTC
    // day, because the accepted days move with it.
    const accepted = new Set<number>()
    for (let hour = 0; hour < 24; hour++) {
      vi.setSystemTime(Date.parse(`${today}T${String(hour).padStart(2, '0')}:30:00Z`))
      const serverToday = toPuzzleDay(new Date())
      for (let delta = -5; delta <= 5; delta++) {
        const day = addDays(serverToday, delta)
        try {
          requireCurrentSomewhere(day)
        } catch {
          continue
        }
        accepted.add(delta)
        expect(isPassedDate(day, serverToday)).toBe(false)
      }
    }
    expect([...accepted].sort()).toEqual([-1, 0, 1])
    expect(isPassedDate(addDays(today, -2), today)).toBe(true)
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

  test('a team that never touched the setting counts (wordle-teams-9j7o.2.11)', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId], owner: playerId }))
      await startFor(ctx, playerId, today)
      expect(await playOn(ctx, playerId, today)).toMatchObject({ status: 'playing' })
    })
  })
})

describe('writePlayFor, the shape of a write', () => {
  const playing = { cluesRevealed: 1, status: 'playing' as const, scratch: EMPTY }
  const finished = { ...playing, status: 'solved' as const, lockedAtClue: 1, lockedOrder: [...SHAPES], finishedAt: 1 }

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
      const write = { ...finished, cluesRevealed: 6, lockedAtClue: 6 }
      await writePlayFor(ctx, playerId, addDays(today, -1), null, write)
      const plays = await ctx.db.query('clueLadderPlays').collect()
      expect(plays).toHaveLength(1)
      expect(plays[0]).toMatchObject({ playerId, date: addDays(today, -1), ...write })
    })
  })

  test.each([
    ['four shapes', [...SHAPES].slice(0, 4)],
    ['six shapes', [...SHAPES, SHAPES[0]]],
    ['a repeated shape', [SHAPES[0], SHAPES[0], SHAPES[2], SHAPES[3], SHAPES[4]]],
  ])('refuses a lockedOrder of %s', async (_name, lockedOrder) => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(writePlayFor(ctx, playerId, today, null, { ...finished, lockedOrder })).rejects.toThrow(/lockedOrder/)
      await nothingWritten(ctx)
    })
  })

  test('refuses a finished write without finishedAt, and finishedAt on a play still playing', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      await expect(writePlayFor(ctx, playerId, today, null, { ...finished, finishedAt: undefined })).rejects.toThrow(
        /finishedAt/,
      )
      await expect(writePlayFor(ctx, playerId, today, null, { ...playing, finishedAt: 5 })).rejects.toThrow(/finishedAt/)
      await nothingWritten(ctx)
    })
  })
})

describe('writePlayFor, rewriting an existing play', () => {
  const playing = { cluesRevealed: 2, status: 'playing' as const, scratch: EMPTY }
  const finished = { ...playing, status: 'solved' as const, lockedAtClue: 2, lockedOrder: [...SHAPES], finishedAt: 1 }

  async function aStartedPlay(ctx: Ctx, write: PlayWrite = playing) {
    const playerId = await aClueLadderPlayer(ctx)
    await writePlayFor(ctx, playerId, today, null, write)
    const existing = await playOn(ctx, playerId, today)
    if (!existing) throw new Error('no play')
    return { playerId, existing }
  }

  test('patches the same player’s play on the same date, with the same or more clues', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, existing } = await aStartedPlay(ctx)
      await writePlayFor(ctx, playerId, today, existing, { ...playing, cluesRevealed: 3 })
      expect((await playOn(ctx, playerId, today))?.cluesRevealed).toBe(3)
    })
  })

  test('refuses another player’s play', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { existing } = await aStartedPlay(ctx)
      const otherId = await ctx.db.insert('players', aPlayer({ email: 'other@example.com' }))
      await expect(writePlayFor(ctx, otherId, today, existing, { ...playing, cluesRevealed: 3 })).rejects.toThrow(/is not/)
      expect((await ctx.db.get(existing._id))?.cluesRevealed).toBe(2)
    })
  })

  test('refuses a play from another date', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, existing } = await aStartedPlay(ctx)
      const tomorrow = addDays(today, 1)
      await expect(writePlayFor(ctx, playerId, tomorrow, existing, { ...playing, cluesRevealed: 3 })).rejects.toThrow(
        /is not/,
      )
      expect((await ctx.db.get(existing._id))?.cluesRevealed).toBe(2)
    })
  })

  test('never rewrites a finished play', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, existing } = await aStartedPlay(ctx, finished)
      await expect(writePlayFor(ctx, playerId, today, existing, { ...playing, cluesRevealed: 3 })).rejects.toThrow(
        /already solved/,
      )
      expect(await ctx.db.get(existing._id)).toMatchObject({ status: 'solved', cluesRevealed: 2 })
    })
  })

  test('never takes a clue back', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, existing } = await aStartedPlay(ctx)
      await expect(writePlayFor(ctx, playerId, today, existing, { ...playing, cluesRevealed: 1 })).rejects.toThrow(
        /go back/,
      )
      expect((await ctx.db.get(existing._id))?.cluesRevealed).toBe(2)
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

  test('uses the client’s today when it is current somewhere', async () => {
    const asMe = await asOptedInPlayer()
    const tomorrow = addDays(today, 1)
    expect(await asMe.query(api.clueLadder.today, { today: tomorrow })).toEqual({
      enabled: true,
      play: { status: 'not-started', date: tomorrow },
    })
  })

  test('falls back to the server’s day for a tomorrow that has started nowhere yet', async () => {
    // 01:00 UTC: tomorrow begins at UTC+14 midnight, nine hours away.
    vi.setSystemTime(Date.parse(`${today}T01:00:00Z`))
    const asMe = await asOptedInPlayer()
    expect(await asMe.query(api.clueLadder.today, { today: addDays(today, 1) })).toEqual({
      enabled: true,
      play: { status: 'not-started', date: today },
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

async function started(ctx: Ctx) {
  const playerId = await aClueLadderPlayer(ctx)
  await startFor(ctx, playerId, today)
  const puzzle = await puzzleOn(ctx, today)
  if (!puzzle) throw new Error('no puzzle')
  return { playerId, puzzle }
}

describe('nextClueFor', () => {
  test('reveals one clue at a time, then says there are no more and changes nothing', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      for (let n = 2; n <= puzzle.clues.length; n++) {
        expect(await nextClueFor(ctx, playerId, today, n - 1)).toEqual({ noMoreClues: false, cluesRevealed: n })
      }
      expect(await nextClueFor(ctx, playerId, today, puzzle.clues.length)).toEqual({ noMoreClues: true })
      expect((await playOn(ctx, playerId, today))?.cluesRevealed).toBe(puzzle.clues.length)
    })
  })

  test('a double tap reveals one clue, not two', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId } = await started(ctx)
      // Both taps were sent while the page showed clue 1.
      expect(await nextClueFor(ctx, playerId, today, 1)).toEqual({ noMoreClues: false, cluesRevealed: 2 })
      expect(await nextClueFor(ctx, playerId, today, 1)).toEqual({ noMoreClues: false, cluesRevealed: 2 })
      expect((await playOn(ctx, playerId, today))?.cluesRevealed).toBe(2)
    })
  })

  test('refuses a day once it has ended everywhere, even with a play on it', async () => {
    const yesterday = addDays(today, -1)
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      // 11:00 UTC: still yesterday at UTC-12, for one more hour.
      vi.setSystemTime(Date.parse(`${today}T11:00:00Z`))
      await startFor(ctx, playerId, yesterday)
      vi.setSystemTime(Date.parse(`${today}T12:00:00Z`))
      await expect(nextClueFor(ctx, playerId, yesterday, 1)).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })
      expect((await playOn(ctx, playerId, yesterday))?.cluesRevealed).toBe(1)
    })
  })
})

describe('lockInFor', () => {
  test('the answer solves on the clue revealed, and the scoreboard scores that clue', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await nextClueFor(ctx, playerId, today, 1)
      expect(await lockInFor(ctx, playerId, today, [...puzzle.answer])).toEqual({ status: 'solved', lockedAtClue: 2 })
      expect(await GAMES.clueLadder.resultsFor(ctx, playerId, today, today)).toEqual([{ puzzleDay: today, attempts: 2 }])
    })
  })

  test('any other order is an X', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      const wrong = [...puzzle.answer].reverse()
      expect(await lockInFor(ctx, playerId, today, wrong)).toEqual({ status: 'failed', lockedAtClue: 1 })
      expect(await GAMES.clueLadder.resultsFor(ctx, playerId, today, today)).toEqual([
        { puzzleDay: today, attempts: FAILED_ATTEMPTS },
      ])
    })
  })

  test('one swap from the answer is still an X: every slot must match', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      const [a, b, c, d, e] = puzzle.answer
      expect(await lockInFor(ctx, playerId, today, [a, b, c, e, d])).toEqual({ status: 'failed', lockedAtClue: 1 })
    })
  })

  test('one lock-in only: a second, or another clue, is ALREADY_FINISHED', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await lockInFor(ctx, playerId, today, [...puzzle.answer].reverse())
      await expect(lockInFor(ctx, playerId, today, [...puzzle.answer])).rejects.toMatchObject({
        data: { code: 'ALREADY_FINISHED' },
      })
      await expect(nextClueFor(ctx, playerId, today, 1)).rejects.toMatchObject({ data: { code: 'ALREADY_FINISHED' } })
      expect((await playOn(ctx, playerId, today))?.status).toBe('failed')
    })
  })

  test('refuses an order that is not the five shapes once each', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId } = await started(ctx)
      await expect(
        lockInFor(ctx, playerId, today, ['star', 'star', 'circle', 'square', 'triangle']),
      ).rejects.toMatchObject({ data: { code: 'INVALID_ORDER' } })
      expect((await playOn(ctx, playerId, today))?.status).toBe('playing')
    })
  })

  test('afterwards, today shows the answer, the ladder and the orders possible at lock-in', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await lockInFor(ctx, playerId, today, [...puzzle.answer])
      const view = await todayFor(ctx, playerId, today)
      if (view.status !== 'solved') throw new Error(`expected solved, got ${view.status}`)
      expect(view).toMatchObject({ lockedAtClue: 1, answer: puzzle.answer, remaining: puzzle.remaining })
      expect(view.possibleAtLockIn).toHaveLength(puzzle.remaining[0])
      expect(view.possibleAtLockIn).toContainEqual(puzzle.answer)
    })
  })

  test('locked in at a later clue, the orders possible are those that survived every clue shown', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await nextClueFor(ctx, playerId, today, 1)
      await lockInFor(ctx, playerId, today, [...puzzle.answer])
      const view = await todayFor(ctx, playerId, today)
      if (view.status !== 'solved') throw new Error(`expected solved, got ${view.status}`)
      expect(view.lockedAtClue).toBe(2)
      expect(view.possibleAtLockIn).toHaveLength(puzzle.remaining[1])
      expect(view.possibleAtLockIn).toEqual(survivors(puzzle.clues.slice(0, 2)))
    })
  })

  test('no play yet is a plain Error, not a player-facing code', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await aClueLadderPlayer(ctx)
      const calls = [
        () => nextClueFor(ctx, playerId, today, 1),
        () => saveScratchFor(ctx, playerId, today, [...EMPTY]),
        () => lockInFor(ctx, playerId, today, [...SHAPES]),
      ]
      for (const call of calls) {
        const error = await call().then(
          () => null,
          (e: unknown) => e,
        )
        expect(error).toBeInstanceOf(Error)
        expect(error).toMatchObject({ message: expect.stringMatching(/no play for/) })
        expect(error).not.toHaveProperty('data.code')
      }
    })
  })
})

describe('saveScratchFor', () => {
  test('stores the arrangement, and never checks it against the answer', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId } = await started(ctx)
      const scratch = ['star', null, null, null, 'circle'] as const
      await saveScratchFor(ctx, playerId, today, [...scratch])
      expect((await playOn(ctx, playerId, today))?.scratch).toEqual([...scratch])
    })
  })

  test.each([
    [['star', 'star', null, null, null]],
    [[null, null, null, null]],
  ] as const)('refuses %j', async (scratch) => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId } = await started(ctx)
      await expect(saveScratchFor(ctx, playerId, today, [...scratch])).rejects.toMatchObject({
        data: { code: 'INVALID_ORDER' },
      })
    })
  })

  test('a save that lands after lockIn is ignored, not refused', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await lockInFor(ctx, playerId, today, [...puzzle.answer])
      await saveScratchFor(ctx, playerId, today, [...EMPTY])
      expect((await playOn(ctx, playerId, today))?.scratch).toEqual([...puzzle.answer])
    })
  })

  test('a malformed save after lockIn is ignored too, and changes nothing', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId, puzzle } = await started(ctx)
      await lockInFor(ctx, playerId, today, [...puzzle.answer])
      const before = await playOn(ctx, playerId, today)
      await saveScratchFor(ctx, playerId, today, ['star', 'star', null, null, null])
      await saveScratchFor(ctx, playerId, today, [null])
      expect(await playOn(ctx, playerId, today)).toEqual(before)
    })
  })

  test('an unchanged arrangement writes nothing', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const { playerId } = await started(ctx)
      const scratch = ['star', null, null, null, 'circle'] as const
      await saveScratchFor(ctx, playerId, today, [...scratch])
      const patch = vi.spyOn(ctx.db, 'patch')
      await saveScratchFor(ctx, playerId, today, [...scratch])
      expect(patch).not.toHaveBeenCalled()
      await saveScratchFor(ctx, playerId, today, ['circle', null, null, null, 'star'])
      expect(patch).toHaveBeenCalledTimes(1)
    })
  })
})

describe('the public functions', () => {
  const ME = 'member@example.com'

  test('start, nextClue, saveScratch and lockIn play a day through api.clueLadder', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    await t.run(async (ctx) => {
      await aClueLadderPlayer(ctx)
    })
    const asMe = await authenticatedAs(t, ME)

    await asMe.mutation(api.clueLadder.start, { today })
    expect(await asMe.mutation(api.clueLadder.nextClue, { today, expectedRevealed: 1 })).toEqual({
      noMoreClues: false,
      cluesRevealed: 2,
    })
    const scratch = ['star', null, null, null, 'circle'] as const
    await asMe.mutation(api.clueLadder.saveScratch, { today, scratch: [...scratch] })
    expect(await asMe.query(api.clueLadder.today, { today })).toMatchObject({
      play: { status: 'playing', cluesRevealed: 2, scratch: [...scratch] },
    })

    const result = await asMe.mutation(api.clueLadder.lockIn, { today, order: [...SHAPES] })
    expect(result).toMatchObject({ lockedAtClue: 2 })
    expect(await asMe.query(api.clueLadder.today, { today })).toMatchObject({
      play: { status: result.status, lockedAtClue: 2, lockedOrder: [...SHAPES] },
    })
  })
})
