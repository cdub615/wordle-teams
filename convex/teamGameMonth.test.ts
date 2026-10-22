import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { addDays, addMonths, monthOf, toPuzzleDay } from './lib/puzzleDay.ts'
import { GAMES } from './lib/games.ts'
import { monthTotal, wordleDays } from './lib/scoring.ts'
import { getTeamGameMonthFor, getTeamMonthFor, monthWindowInputsFor } from './scores'

const modules = import.meta.glob('./**/*.ts')

// Days and months derive from the real clock, for the reasons scores.test.ts's
// header gives: the month gate moves with the calendar.
const today = toPuzzleDay(new Date())
const thisMonth = monthOf(today)
const ancientMonth = addMonths(thisMonth, -30)

afterEach(() => vi.unstubAllEnvs())

const aPlay = (over: Record<string, unknown> = {}) => ({
  date: today,
  cluesRevealed: 1,
  status: 'playing' as const,
  scratch: [null, null, null, null, null],
  startedAt: 1_760_000_000_000,
  ...over,
})

describe('getTeamGameMonthFor — wordle', () => {
  test('totals match getTeamMonthFor for every player', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const board = { date: 1_755_500_000_000, answer: 'SPEED' }
      const day = (n: number) => `${thisMonth}-${String(n).padStart(2, '0')}`
      await ctx.db.insert('dailyScores', { ...board, playerId: ada, puzzleDay: day(1), guesses: ['SPEED'] })
      // A duplicate day: the first row must win in both paths.
      await ctx.db.insert('dailyScores', { ...board, playerId: ada, puzzleDay: day(1), guesses: ['CRANE', 'SPEED'] })
      await ctx.db.insert('dailyScores', {
        ...board,
        playerId: bob,
        puzzleDay: day(2),
        guesses: ['CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE'],
      })

      const boards = await getTeamMonthFor(ctx, ada, teamId, thisMonth)
      const game = await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'wordle')
      const opts = { month: thisMonth, playWeekends: boards.team.playWeekends, today }
      for (const player of boards.players) {
        const twin = game.players.find((p) => p.id === player.id)
        expect(twin).toBeDefined()
        expect(monthTotal({ ...opts, system: game.team.system, days: twin!.results })).toBe(
          monthTotal({ ...opts, system: boards.team.system, days: wordleDays(player.scores) }),
        )
      }
      expect(game.team.system).toEqual(boards.team.system)
      expect(game.game).toBe('wordle')
    })
  })

  test('refuses a non-member before reading anything', async () => {
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await expect(getTeamGameMonthFor(ctx, outsider, teamId, thisMonth, 'wordle')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})

describe('getTeamGameMonthFor — clue ladder', () => {
  test('refuses while the deployment switch is off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', '')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      await expect(getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'CLUE_LADDER_DISABLED' },
      })
    })
  })

  test('refuses a team whose owner switched it off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: false }))
      await expect(getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'CLUE_LADDER_NOT_ON_TEAM' },
      })
    })
  })

  test('a non-member hears NOT_A_MEMBER, not which games the team plays', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))
      await expect(getTeamGameMonthFor(ctx, outsider, teamId, thisMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  test('returns each member’s results and the team’s points with X fixed at -1', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada, bob], owner: ada, clueLadderEnabled: true, failed: -3, fourGuesses: 1 }),
      )
      await ctx.db.insert('clueLadderPlays', {
        ...aPlay({ status: 'solved', cluesRevealed: 4, lockedAtClue: 4 }),
        playerId: ada,
      })
      await ctx.db.insert('clueLadderPlays', { ...aPlay(), playerId: bob })

      const month = await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')
      expect(month.game).toBe('clueLadder')
      expect(month.team.system.failed).toBe(-1)
      expect(month.team.system.fourGuesses).toBe(1)
      expect(month.players.map((p) => [p.firstName, p.results])).toEqual([
        ['Ada', [{ puzzleDay: today, attempts: 4 }]],
        ['Bob', []],
      ])
    })
  })

  test('the Pro window comes from clue ladder plays, not Wordle boards', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      await ctx.db.insert('playerMembership', { playerId: ada, membershipStatus: 'pro' })
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: `${ancientMonth}-14`,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      // The ancient Wordle board opens that month for Wordle...
      await expect(getTeamGameMonthFor(ctx, ada, teamId, ancientMonth, 'wordle')).resolves.toBeDefined()
      // ...but the clue ladder has no plays that old, so it stays shut.
      await expect(getTeamGameMonthFor(ctx, ada, teamId, ancientMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'MONTH_OUT_OF_WINDOW' },
      })
      expect(await monthWindowInputsFor(ctx, ada, teamId, 'clueLadder')).toEqual({ earliestMonth: null })
      expect(await monthWindowInputsFor(ctx, ada, teamId)).toEqual({ earliestMonth: ancientMonth })
    })
  })

  test('the month window refuses the clue ladder for a team whose owner switched it off', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: false }))
      await expect(monthWindowInputsFor(ctx, ada, teamId, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'CLUE_LADDER_NOT_ON_TEAM' },
      })
    })
  })

  test('a passed unfinished play counts as an X on the board', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      const passed = addDays(today, -3)
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: passed }), playerId: ada })
      const month = await getTeamGameMonthFor(ctx, ada, teamId, monthOf(passed), 'clueLadder')
      expect(month.players[0].results).toEqual([{ puzzleDay: passed, attempts: 7 }])
    })
  })

  test('a malformed play date neither opens old months nor breaks the current one', async () => {
    // '' sorts below every real day, so firstDay returns it as the earliest. No
    // writer can store it now (start bounds the date), but inserts that bypass
    // the writers can, as scores.test.ts notes for Wordle boards. A Pro member,
    // so the window's floor comes from earliestMonth rather than the free rule.
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      await ctx.db.insert('playerMembership', { playerId: ada, membershipStatus: 'pro' })
      await ctx.db.insert('clueLadderPlays', { ...aPlay({ date: '' }), playerId: ada })

      expect(await GAMES.clueLadder.firstDay(ctx, ada)).toBe('')
      await expect(getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).resolves.toBeDefined()
      await expect(getTeamGameMonthFor(ctx, ada, teamId, ancientMonth, 'clueLadder')).rejects.toMatchObject({
        data: { code: 'MONTH_OUT_OF_WINDOW' },
      })
    })
  })

  test('returns the day the team turned the clue ladder on, for the grid to count from', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true, clueLadderOnSince: today }),
      )
      expect((await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).countsFrom).toBe(today)
      // Wordle has no such day, whatever the team's clue ladder holds.
      expect((await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'wordle')).countsFrom).toBeNull()
    })
  })

  test('a team with no stored day counts every day (rows from before the field existed)', async () => {
    vi.stubEnv('CLUE_LADDER_ENABLED', 'true')
    await convexTest(schema, modules).run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada, clueLadderEnabled: true }))
      expect((await getTeamGameMonthFor(ctx, ada, teamId, thisMonth, 'clueLadder')).countsFrom).toBeNull()
    })
  })
})
