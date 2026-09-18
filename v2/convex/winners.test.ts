import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { addMonths, monthOf, toPuzzleDay, type PuzzleMonth } from './lib/puzzleDay.ts'
import { aPlayer, aTeam } from './fixtures.ts'
import {
  lastMonthWinnerFor,
  markCelebrationSeenFor,
  monthsWithWinners,
  recomputeTeamMonth,
  recomputeTeamMonths,
} from './winners.ts'

const today = toPuzzleDay(new Date())
const modules = import.meta.glob('./**/*.ts')

/**
 * MONTHS RELATIVE TO THE CLOCK, FOR THE `lastMonthWinnerFor` SUITE ONLY, and
 * they are not cosmetic. That function is month-gated since wordle-teams-kusd's
 * task 4, and its floor is derived from the SERVER'S current month — so a
 * hardcoded '2026-08' is a fixture with an expiry date. Every one of those tests
 * would have gone red in October 2026 and reported a failure of the gate rather
 * than of the fixture, which is the worst kind of red to hand the next reader.
 *
 * The `recomputeTeamMonth` and `markCelebrationSeenFor` suites keep their literal
 * months on purpose: neither function has a month rule, so nothing about them
 * depends on where the clock is.
 */
const thisMonth = monthOf(today)
/** Last month. The only month the celebration dialog ever asks for. */
const lastMonth = addMonths(thisMonth, -1)
const twoBack = addMonths(thisMonth, -2)
/** SERVER_SLACK_MONTHS: offered by no dropdown, served by the server. */
const slackMonth = addMonths(thisMonth, -3)
/** The first month below the free floor. */
const belowFloor = addMonths(thisMonth, -4)
const ancientMonth = '2019-04'

/** The (year, month) number pair `monthlyWinners` is keyed on, for a 'YYYY-MM'. */
const keyOf = (month: PuzzleMonth) => ({
  year: Number(month.slice(0, 4)),
  month: Number(month.slice(5, 7)),
})

/** A board scoring `attempts` guesses, on the given day. */
const aScore = (playerId: string, puzzleDay: string, guesses: Array<string>) => ({
  playerId: playerId as never,
  puzzleDay,
  date: 1_755_500_000_000,
  answer: 'SPEED',
  guesses,
})

describe('recomputeTeamMonth', () => {
  test('writes a winner row for the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      // Ada solves in one (5 points); Bob solves in four (1 point).
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-08-03', ['CRANE', 'SLATE', 'SPELL', 'SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.playerId).toBe(ada)
      // The whole reason this diverges from the SQL — see the module doc —
      // is what happens to hasSeenCelebration. A fresh row must start empty.
      expect(row?.hasSeenCelebration).toEqual([])
    })
  })

  test('breaks a tie in favour of the earlier player in team order', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [bob, ada] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-08-03', ['SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      // Bob is first in playerIds, so Bob wins the tie.
      expect(row?.playerId).toBe(bob)
    })
  })

  test('deletes the row when the team has no member who can win', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row).toBeNull()
    })
  })

  test('is a pure no-op when there is no winner and no existing row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      // No prior monthlyWinners row this time — unlike the "deletes the row"
      // case above, there is nothing for the `!winnerId` branch to delete.
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [] }))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row).toBeNull()
      expect(await ctx.db.query('monthlyWinners').collect()).toHaveLength(0)
    })
  })

  test('preserves hasSeenCelebration when the winner is unchanged', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [ada],
      })

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.hasSeenCelebration).toEqual([ada])
    })
  })

  test('resets hasSeenCelebration when the winner changes', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['SPEED']))
      await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [bob],
      })

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.playerId).toBe(ada)
      expect(row?.hasSeenCelebration).toEqual([])
    })
  })

  test('excludes a roster entry whose player document is gone from winning', async () => {
    // Convex ids are not foreign keys, so a `playerIds` entry can outlive the
    // row it names — and dailyScores are keyed by playerId, so the ghost's
    // boards outlive it too and still total up. recomputeTeamMonth never
    // dereferences the member doc, so an unguarded loop would not throw here;
    // it would just hand the month to somebody who does not exist. Constructed
    // by deleting the row out from under a live roster, which is the only way
    // to reach the state now that a nameless player is unrepresentable — this
    // test replaces the profile-completeness one that Phase 4's schema
    // narrowing made impossible to write.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const ghost = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ghost, ada] }))
      // The ghost solves in one (5 points) and Ada in four (1 point), so the
      // ghost outscores her and — first in `playerIds` — would also take a tie.
      // Anything less and the assertion below would pass without the guard.
      await ctx.db.insert('dailyScores', aScore(ghost, '2026-08-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-08-03', ['CRANE', 'SLATE', 'SPELL', 'SPEED']))
      await ctx.db.delete(ghost)

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-08', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 8))
        .first()
      expect(row?.playerId).toBe(ada)
    })
  })
})

describe('monthsWithWinners', () => {
  test('returns every month the team has a winner row for, as YYYY-MM', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      const other = await ctx.db.insert('teams', aTeam({ legacyId: 207, playerIds: [ada] }))
      for (const [year, month] of [
        [2026, 6],
        [2026, 7],
        [2025, 12],
      ] as const) {
        await ctx.db.insert('monthlyWinners', {
          playerId: ada,
          teamId,
          year,
          month,
          hasSeenCelebration: [],
        })
      }
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId: other,
        year: 2026,
        month: 1,
        hasSeenCelebration: [],
      })

      expect((await monthsWithWinners(ctx, teamId)).sort()).toEqual(['2025-12', '2026-06', '2026-07'])
    })
  })
})

describe('recomputeTeamMonths', () => {
  test('recomputes each month it is given, independently', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      // Ada wins June, Bob wins July.
      await ctx.db.insert('dailyScores', aScore(ada, '2026-06-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-07-03', ['SPEED']))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonths(ctx, team, ['2026-06', '2026-07'], today)

      const june = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 6))
        .first()
      const july = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 7))
        .first()
      expect(june?.playerId).toBe(ada)
      expect(july?.playerId).toBe(bob)
    })
  })
})

describe('recomputeTeamMonth — scoring version resolution', () => {
  // The write half of wordle-teams-1j3. recomputeTeamMonth used to pass the
  // team doc straight to monthTotal, so a scoring edit rewrote the stored
  // winner for every month it recomputed — including months that were played
  // under a different system. These pin the resolution, and they FAIL if the
  // `system` argument is reverted to `team`.
  const failedSix = ['CRANE', 'SLATE', 'SPELL', 'SPILL', 'STEEL', 'SPEND']

  /** Inverts the default: failing beats solving in one. */
  const inverted = (teamId: string, effectiveFrom: string) => ({
    teamId: teamId as never,
    effectiveFrom,
    oneGuess: -50,
    twoGuesses: 3,
    threeGuesses: 2,
    fourGuesses: 1,
    fiveGuesses: 0,
    sixGuesses: -1,
    failed: 50,
    nA: 0,
  })

  test('each month in one recompute resolves its OWN version', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      // Identical play in both months: Ada solves in one, Bob fails.
      for (const day of ['2026-06-03', '2026-07-03']) {
        await ctx.db.insert('dailyScores', aScore(ada, day, ['SPEED']))
        await ctx.db.insert('dailyScores', aScore(bob, day, failedSix))
      }
      // The inversion takes effect in July only.
      await ctx.db.insert('scoringSystems', inverted(teamId, '2026-07'))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonths(ctx, team, ['2026-06', '2026-07'], today)

      const winnerFor = async (month: number) =>
        (
          await ctx.db
            .query('monthlyWinners')
            .withIndex('by_team_year_month', (q) =>
              q.eq('teamId', teamId).eq('year', 2026).eq('month', month),
            )
            .first()
        )?.playerId

      // June predates the version and keeps the team's original values.
      expect(await winnerFor(6)).toBe(ada)
      // July is governed by the version, under which failing wins.
      expect(await winnerFor(7)).toBe(bob)
    })
  })

  test('a version does not reach back past its effectiveFrom', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      await ctx.db.insert('dailyScores', aScore(ada, '2026-06-03', ['SPEED']))
      await ctx.db.insert('dailyScores', aScore(bob, '2026-06-03', failedSix))
      await ctx.db.insert('scoringSystems', inverted(teamId, '2026-07'))

      const team = (await ctx.db.get(teamId))!
      await recomputeTeamMonth(ctx, team, '2026-06', today)

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId).eq('year', 2026).eq('month', 6))
        .first()
      expect(row?.playerId).toBe(ada)
    })
  })
})

/**
 * THE CELEBRATION DIALOG'S TWO PUBLIC FUNCTIONS (`wordle-teams-k7w`).
 *
 * Everything above exercises the write side, which existed with no reader. The
 * two suites below are the first tests of anything that can be CALLED from a
 * browser, and the append test in particular is the one that fails if v1's
 * read-modify-write shape is ported: v1 sends a whole array computed in the
 * client from a value it read earlier, so the last writer wins and every
 * teammate who dismissed the dialog in between is dropped from the row.
 */
describe('markCelebrationSeenFor', () => {
  test('APPENDS to the seen list rather than replacing it', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      // Bob has already dismissed it. Ada dismisses it now.
      const rowId = await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [bob],
      })

      await markCelebrationSeenFor(ctx, ada, teamId, '2026-08')

      // BOTH, in the order they dismissed. An implementation that wrote
      // `[playerId]`, or that trusted a client-supplied array built before
      // Bob's write landed, produces `[ada]` here.
      expect((await ctx.db.get(rowId))?.hasSeenCelebration).toEqual([bob, ada])
    })
  })

  test('marking it seen twice does not duplicate the player', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      const rowId = await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })

      // The dialog can mount twice on a fast remount — a route transition back
      // to /app, a re-render that restarts the effect. Nothing reads this array
      // by length, so a duplicate would not misbehave; it would grow the row
      // by one entry per remount, forever.
      await markCelebrationSeenFor(ctx, ada, teamId, '2026-08')
      await markCelebrationSeenFor(ctx, ada, teamId, '2026-08')

      expect((await ctx.db.get(rowId))?.hasSeenCelebration).toEqual([ada])
    })
  })

  test('writes to the month it was ASKED for, not to any other', async () => {
    // THE MUTATION HALF OF `lastMonthWinnerFor`'s "answers about the month it
    // was ASKED for" below, and it was missing: every other test in this
    // describe inserts its row at 2026-08 and calls with '2026-08', so
    // `winnerRow(ctx, teamId, '2026-08')` — the month argument dropped on the
    // floor — passed all of them (measured: the mutant survived all 44).
    //
    // The defect that admits is asymmetric and nasty in both directions. The
    // month the dialog is actually showing never gets marked seen, so it
    // reappears on every load forever; some other month is silently marked for
    // a viewer who was never shown it, so when that month's dialog is due it
    // never comes.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      const july = await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 7,
        hasSeenCelebration: [],
      })
      const august = await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })

      await markCelebrationSeenFor(ctx, ada, teamId, '2026-07')

      expect((await ctx.db.get(july))?.hasSeenCelebration).toEqual([ada])
      expect((await ctx.db.get(august))?.hasSeenCelebration).toEqual([])

      // And the other way round, so neither month is the one a hardcoded
      // constant could happen to be.
      await markCelebrationSeenFor(ctx, ada, teamId, '2026-08')

      expect((await ctx.db.get(august))?.hasSeenCelebration).toEqual([ada])
    })
  })

  test('is a silent no-op when the month has no winner row', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))

      // A board entered between the query resolving and this call can change
      // the winner or remove the row. The dialog is already on screen; a throw
      // would turn that race into an error the viewer cannot act on.
      await expect(markCelebrationSeenFor(ctx, ada, teamId, '2026-08')).resolves.toBeUndefined()
      expect(await ctx.db.query('monthlyWinners').collect()).toHaveLength(0)
    })
  })

  test('refuses a caller who is not on the team, and writes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '22222222-2222-4222-8222-222222222222',
          email: 'outsider@example.com',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      const rowId = await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })

      await expect(markCelebrationSeenFor(ctx, outsider, teamId, '2026-08')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
      // The access check must run BEFORE the patch, not merely somewhere in the
      // function: an outsider's id must not end up in another team's row.
      expect((await ctx.db.get(rowId))?.hasSeenCelebration).toEqual([])
    })
  })
})

describe('lastMonthWinnerFor', () => {
  test("returns the WINNER's name, the team's name, and whether the caller has seen it", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ name: 'Wordlers', playerIds: [ada, bob] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        ...keyOf(lastMonth),
        hasSeenCelebration: [],
      })

      // Asked BY BOB, who did not win. The name in the answer is Ada's, which
      // is the whole of v1's misnamed-winner bug (§7a row 35): v1 never asks
      // the server who won, it renders the viewer's own name.
      expect(await lastMonthWinnerFor(ctx, bob, teamId, lastMonth)).toEqual({
        teamName: 'Wordlers',
        winner: { id: ada, firstName: 'Ada', lastName: 'Lovelace' },
        hasSeen: false,
      })
    })
  })

  test('hasSeen is about the CALLER, not about anyone else in the list', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        ...keyOf(lastMonth),
        hasSeenCelebration: [ada],
      })

      // Ada has dismissed it; Bob has not. A `hasSeenCelebration.length > 0`
      // would answer true for both, and Bob would never see the dialog.
      expect((await lastMonthWinnerFor(ctx, ada, teamId, lastMonth))?.hasSeen).toBe(true)
      expect((await lastMonthWinnerFor(ctx, bob, teamId, lastMonth))?.hasSeen).toBe(false)
    })
  })

  test('answers about the month it was ASKED for, not about any other', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        ...keyOf(twoBack),
        hasSeenCelebration: [],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        ...keyOf(lastMonth),
        hasSeenCelebration: [],
      })

      expect((await lastMonthWinnerFor(ctx, ada, teamId, twoBack))?.winner.id).toBe(ada)
      expect((await lastMonthWinnerFor(ctx, ada, teamId, lastMonth))?.winner.id).toBe(bob)
      // Nothing at all for a month with no row — the common case, since a month
      // nobody played produces none. `slackMonth` is the oldest month the gate
      // serves a free caller, so this doubles as the proof that a NULL and a
      // REFUSAL are different answers at the boundary.
      expect(await lastMonthWinnerFor(ctx, ada, teamId, slackMonth)).toBeNull()
    })
  })

  test('is null when the winning player document is gone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const ghost = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, ghost] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ghost,
        teamId,
        ...keyOf(lastMonth),
        hasSeenCelebration: [],
      })
      await ctx.db.delete(ghost)

      // Convex ids are not foreign keys, so the row can outlive its winner.
      // Dereferencing without the guard throws on `winner.firstName` and takes
      // the dashboard down; null just means no celebration.
      expect(await lastMonthWinnerFor(ctx, ada, teamId, lastMonth)).toBeNull()
    })
  })

  test('refuses a caller who is not on the team', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const outsider = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '22222222-2222-4222-8222-222222222222',
          email: 'outsider@example.com',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        ...keyOf(lastMonth),
        hasSeenCelebration: [],
      })

      // NOT_A_MEMBER rather than null, and a ConvexError rather than a plain
      // one — a plain Error's message is redacted in production, so the client
      // could not tell this apart from a crash.
      await expect(lastMonthWinnerFor(ctx, outsider, teamId, lastMonth)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  /*
    THE MONTH GATE (wordle-teams-kusd's task 4). These mirror scores.test.ts's
    getTeamMonthFor gate tests, with ONE DELIBERATE DIVERGENCE that has its own
    test below: there is no pro floor here.

    WHY THE ROSTER NEEDS NO BOARDS IN ANY OF THEM, unlike scores.test.ts's free
    fixture, which carries an ancient `dailyScores` row precisely so the free
    check and the pro check can be told apart. They cannot collapse into each
    other here: this gate never computes a pro floor at all, so a free refusal is
    the only thing `isProFor` can be standing in front of, and replacing that call
    with `if (false)` turns the free test below red on its own.
  */

  test('refuses a free caller the month before the free floor', async () => {
    // THE GATE ITSELF. Without it this function checks membership and nothing
    // else, and a member can name the winner of every month their team has ever
    // played — the whole hall of fame, one cheap call per month, which is the
    // history Pro sells.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        ...keyOf(ancientMonth),
        hasSeenCelebration: [],
      })

      // A ROW REALLY EXISTS FOR THE REFUSED MONTH, which matters: without it the
      // answer would be null either way and the assertion could not tell a gate
      // from an empty table.
      for (const month of [belowFloor, ancientMonth]) {
        await expect(lastMonthWinnerFor(ctx, ada, teamId, month)).rejects.toMatchObject({
          data: { code: 'MONTH_OUT_OF_WINDOW' },
        })
      }
    })
  })

  test('serves a free caller every month down to the slack, and refuses the one below', async () => {
    // THE BOUNDARY, BOTH SIDES. -3 is the slack month SERVER_SLACK_MONTHS exists
    // for and no dropdown offers; -4 is the first refusal. Without both,
    // SERVER_SLACK_MONTHS could be changed to 2 and this file would stay green —
    // and the dialog would start failing for viewers east of UTC on the 1st.
    //
    // +1 PINS THE ABSENCE OF AN UPPER BOUND, for the reason serverFloorFor gives:
    // a viewer in UTC+14 asks for a month the server has not reached yet for a few
    // hours at every boundary, and a reader who saw only a floor could add
    // `if (month > serverMonth) throw` and break exactly them.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))

      for (const month of [addMonths(thisMonth, 1), thisMonth, lastMonth, twoBack, slackMonth]) {
        await expect(lastMonthWinnerFor(ctx, ada, teamId, month)).resolves.toBeNull()
      }
      await expect(lastMonthWinnerFor(ctx, ada, teamId, belowFloor)).rejects.toMatchObject({
        data: { code: 'MONTH_OUT_OF_WINDOW' },
      })
    })
  })

  test('serves a PRO caller a month the roster has no boards in at all', async () => {
    // THE DELIBERATE DIVERGENCE FROM getTeamMonthFor, AND THE ONLY TEST THAT
    // PINS IT. That function refuses a pro caller below `earliestMonthFor`'s
    // floor; this one has no pro floor, because refusing here would mean walking
    // the roster to find the earliest board in order to withhold a single index
    // lookup that misses and returns null anyway — strictly more work to serve
    // less.
    //
    // THE TEAM HAS NO dailyScores ROWS ON PURPOSE. Under getTeamMonthFor's rule
    // `earliestMonthFor` would be null, the pro floor would collapse onto the
    // free one, and this call would be refused. It resolves, so copying that
    // branch over here turns this test red — which is the point of writing it.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      await ctx.db.insert('playerMembership', { playerId: ada, membershipStatus: 'pro' })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        ...keyOf(ancientMonth),
        hasSeenCelebration: [],
      })

      expect((await lastMonthWinnerFor(ctx, ada, teamId, ancientMonth))?.winner.id).toBe(ada)
    })
  })

  test('refuses a caller inside the Insights trial', async () => {
    // THE TRIAL DOES NOT OPEN THIS WINDOW EITHER, and the reason is the spec's
    // §4: the trial was specified as a grant of Insights layers 2 and 3, not of
    // history. `isProFor` is `membershipStatus === 'pro'` and a trial sets no
    // membership row at all. Asserted rather than left to follow from that
    // definition, for the reason scores.test.ts gives: "the trial is pro enough"
    // is exactly the reasonable-sounding change that would ship it.
    //
    // THE FIELD IS insightsTrialEndsAt. The bare `trialEndsAt` next door in
    // lib/insightsAccess.ts is a different thing; access.ts's insightsAccessFor
    // is the adapter between them.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert(
        'players',
        aPlayer({ insightsTrialEndsAt: Date.now() + 86_400_000 }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        ...keyOf(ancientMonth),
        hasSeenCelebration: [],
      })

      await expect(lastMonthWinnerFor(ctx, ada, teamId, ancientMonth)).rejects.toMatchObject({
        data: { code: 'MONTH_OUT_OF_WINDOW' },
      })
    })
  })

  test('refuses a malformed month even from a caller no floor can stop', async () => {
    // THE SHAPE CHECK, AND THE FIXTURE IS PRO FOR A REASON THAT IS STRONGER HERE
    // THAN IN scores.test.ts. There, a pro floor still exists and a free fixture
    // would have refused most of these strings by the floor instead. Here a pro
    // caller passes EVERY month, so the shape check is the only thing that can
    // refuse them — delete it and each of these resolves to null instead of
    // throwing.
    //
    // WHAT IT PREVENTS TODAY IS MILD AND THAT IS WHY IT IS WRITTEN DOWN:
    // `yearAndMonth` is `split('-').map(Number)`, so a bare '2026' yields a NaN
    // monthNum and the index lookup simply misses. The check is here so that
    // stays true when someone later makes this function branch on the month.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      await ctx.db.insert('playerMembership', { playerId: ada, membershipStatus: 'pro' })

      const thisYear = thisMonth.slice(0, 4)
      for (const month of [thisYear, `${thisYear}-`, `${thisMonth}-01`, 'abc', '']) {
        await expect(lastMonthWinnerFor(ctx, ada, teamId, month)).rejects.toMatchObject({
          data: { code: 'MONTH_OUT_OF_WINDOW' },
        })
      }
    })
  })

  test('an in-window read never consults the caller’s membership row', async () => {
    // THE ORDERING GUARD. The free floor is compared BEFORE `isProFor`, so the
    // only call this query actually receives — the dialog asking for last month —
    // costs one string comparison and reads no playerMembership row. An
    // implementation that resolved the caller's tier first would answer
    // identically and be wrong on cost, on the one path that is hot.
    //
    // THE CALLER MUST HAVE A MEMBERSHIP ROW FOR THIS TO GUARD ANYTHING, and that
    // is not decoration. `isProFor` is an indexed `.first()`, and an index range
    // that matches nothing reads no documents — so against a player with no row
    // the premature-`isProFor` mutant costs exactly the same as the correct
    // ordering and this test passes it. Measured: it did, before this insert was
    // added. A 'free' row is the realistic fixture anyway; every v2 signup gets
    // one.
    //
    // THE BUDGET IS EXACT rather than round, for the reason scores.test.ts's own
    // documentsRead guard states: a budget with headroom reads as slack and stops
    // catching what it was written for.
    const BUDGET =
      1 + // the team document (requireTeamMemberFor)
      1 + // the monthlyWinners row
      1 // the winner's player document
    const t = convexTest({ schema, modules, transactionLimits: { documentsRead: BUDGET } })
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada] }))
      await ctx.db.insert('playerMembership', { playerId: ada, membershipStatus: 'free' })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        ...keyOf(lastMonth),
        hasSeenCelebration: [],
      })

      expect((await lastMonthWinnerFor(ctx, ada, teamId, lastMonth))?.winner.id).toBe(ada)
    })
  })
})
