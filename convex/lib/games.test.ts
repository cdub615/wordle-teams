import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from '../schema'
import { aPlayer, aTeam } from '../fixtures.ts'
import { SHAPES } from './clueLadder/orders.ts'
import {
  clueLadderAttempts,
  FAILED_ATTEMPTS,
  GAMES,
  isPassedDate,
  requireGameOnTeam,
} from './games.ts'
import { addDays, toPuzzleDay } from './puzzleDay.ts'

const modules = import.meta.glob('../**/*.ts')
const today = toPuzzleDay(new Date())

afterEach(() => vi.unstubAllEnvs())

/** The ConvexError code a synchronous guard throws, or undefined if it passes. */
function codeOf(guard: () => void): string | undefined {
  try {
    guard()
  } catch (error) {
    return (error as { data?: { code?: string } }).data?.code
  }
  return undefined
}

/** aTeam's fixture type predates clueLadderEnabled, so narrow it to what the guard reads. */
const teamWith = (over: Record<string, unknown> = {}) => aTeam(over) as { clueLadderEnabled?: boolean }

const aPlay = (over: Record<string, unknown> = {}) => ({
  date: today,
  cluesRevealed: 1,
  status: 'playing' as const,
  scratch: [null, null, null, null, null],
  startedAt: 1_760_000_000_000,
  ...over,
})

describe('isPassedDate', () => {
  test('a date stays live while any time zone can still be on it', () => {
    expect(isPassedDate(addDays(today, 1), today)).toBe(false)
    expect(isPassedDate(today, today)).toBe(false)
    expect(isPassedDate(addDays(today, -1), today)).toBe(false)
  })

  test('two days back has passed everywhere', () => {
    expect(isPassedDate(addDays(today, -2), today)).toBe(true)
  })
})

describe('clueLadderAttempts', () => {
  test('a solved play scores the clue it locked in on', () => {
    expect(clueLadderAttempts({ status: 'solved', lockedAtClue: 4, cluesRevealed: 4, date: today }, today)).toBe(4)
  })

  test('a failed play is an X', () => {
    expect(clueLadderAttempts({ status: 'failed', lockedAtClue: 2, cluesRevealed: 2, date: today }, today)).toBe(
      FAILED_ATTEMPTS,
    )
  })

  test('an unfinished play on a live date has no result yet', () => {
    expect(clueLadderAttempts({ status: 'playing', cluesRevealed: 3, date: addDays(today, -1) }, today)).toBeNull()
  })

  test('an unfinished play on a passed date is an X', () => {
    expect(clueLadderAttempts({ status: 'playing', cluesRevealed: 3, date: addDays(today, -2) }, today)).toBe(
      FAILED_ATTEMPTS,
    )
  })

  test('FAILED_ATTEMPTS is the count pointsFor scores as a failure', () => {
    expect(FAILED_ATTEMPTS).toBe(7)
  })
})

describe('GAMES.wordle', () => {
  test('reads boards in the range as attempts, in index order', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const board = { playerId, date: 1_755_500_000_000, answer: 'SPEED' }
      await ctx.db.insert('dailyScores', { ...board, puzzleDay: '2026-08-02', guesses: ['SPEED'] })
      await ctx.db.insert('dailyScores', { ...board, puzzleDay: '2026-08-03', guesses: ['CRANE', 'SPEED'] })
      await ctx.db.insert('dailyScores', { ...board, puzzleDay: '2026-09-01', guesses: ['SPEED'] })

      expect(await GAMES.wordle.resultsFor(ctx, playerId, '2026-08-01', '2026-08-31')).toEqual([
        { puzzleDay: '2026-08-02', attempts: 1 },
        { puzzleDay: '2026-08-03', attempts: 2 },
      ])
      expect(await GAMES.wordle.hasPlayed(ctx, playerId, '2026-08-03')).toBe(true)
      expect(await GAMES.wordle.hasPlayed(ctx, playerId, '2026-08-04')).toBe(false)
      expect(await GAMES.wordle.firstDay(ctx, playerId)).toBe('2026-08-02')
    })
  })

  test('a player with no boards has no first day', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      expect(await GAMES.wordle.firstDay(ctx, playerId)).toBeNull()
    })
  })
})

describe('GAMES.clueLadder', () => {
  test('reads plays in the range, leaving out a live unfinished one', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const old = addDays(today, -5)
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: addDays(today, -6) }), playerId })
      await ctx.db.insert(
        'clueLadderPlays',
        { ...aPlay({ date: old, status: 'solved', cluesRevealed: 4, lockedAtClue: 4 }), playerId },
      )
      await ctx.db.insert(
        'clueLadderPlays',
        { ...aPlay({ date: addDays(today, -4), status: 'failed', cluesRevealed: 3, lockedAtClue: 3 }), playerId },
      )
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: today }), playerId })

      expect(await GAMES.clueLadder.resultsFor(ctx, playerId, addDays(today, -6), today)).toEqual([
        { puzzleDay: addDays(today, -6), attempts: 7 },
        { puzzleDay: old, attempts: 4 },
        { puzzleDay: addDays(today, -4), attempts: 7 },
      ])
    })
  })

  test('has played means finished, not started', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: today }), playerId })
      await ctx.db.insert(
        'clueLadderPlays',
        { ...aPlay({ date: addDays(today, -1), status: 'solved', cluesRevealed: 5, lockedAtClue: 5 }), playerId },
      )
      expect(await GAMES.clueLadder.hasPlayed(ctx, playerId, today)).toBe(false)
      expect(await GAMES.clueLadder.hasPlayed(ctx, playerId, addDays(today, -1))).toBe(true)
      expect(await GAMES.clueLadder.hasPlayed(ctx, playerId, addDays(today, -2))).toBe(false)
      expect(await GAMES.clueLadder.firstDay(ctx, playerId)).toBe(addDays(today, -1))
    })
  })

  test('the plays table accepts exactly the engine’s five shapes', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('clueLadderPlays', {
        ...aPlay({ scratch: [...SHAPES], lockedOrder: [...SHAPES] }),
        playerId,
      })
      await expect(
        ctx.db.insert('clueLadderPlays', { ...aPlay({ scratch: ['hexagon', null, null, null, null] }), playerId }),
      ).rejects.toThrow()
    })
  })
})

describe('requireGameOnTeam', () => {
  test('Wordle needs nothing', () => {
    expect(codeOf(() => requireGameOnTeam(teamWith(), 'wordle'))).toBeUndefined()
  })

  test('the clue ladder refuses while the deployment switch is off, even for an opted-in team', () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    expect(codeOf(() => requireGameOnTeam(teamWith({ clueLadderEnabled: true }), 'clueLadder'))).toBe(
      'CLUE_LADDER_DISABLED',
    )
  })

  test('the clue ladder refuses a team that has not opted in', () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    for (const clueLadderEnabled of [undefined, false]) {
      expect(codeOf(() => requireGameOnTeam(teamWith({ clueLadderEnabled }), 'clueLadder'))).toBe(
        'CLUE_LADDER_NOT_ON_TEAM',
      )
    }
  })

  test('the clue ladder passes with the switch on and the team opted in', () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    expect(codeOf(() => requireGameOnTeam(teamWith({ clueLadderEnabled: true }), 'clueLadder'))).toBeUndefined()
  })
})
