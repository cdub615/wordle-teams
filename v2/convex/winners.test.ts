import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { toPuzzleDay } from './lib/puzzleDay.ts'
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
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })

      // Asked BY BOB, who did not win. The name in the answer is Ada's, which
      // is the whole of v1's misnamed-winner bug (§7a row 35): v1 never asks
      // the server who won, it renders the viewer's own name.
      expect(await lastMonthWinnerFor(ctx, bob, teamId, '2026-08')).toEqual({
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
        year: 2026,
        month: 8,
        hasSeenCelebration: [ada],
      })

      // Ada has dismissed it; Bob has not. A `hasSeenCelebration.length > 0`
      // would answer true for both, and Bob would never see the dialog.
      expect((await lastMonthWinnerFor(ctx, ada, teamId, '2026-08'))?.hasSeen).toBe(true)
      expect((await lastMonthWinnerFor(ctx, bob, teamId, '2026-08'))?.hasSeen).toBe(false)
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
        year: 2026,
        month: 7,
        hasSeenCelebration: [],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: bob,
        teamId,
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })

      expect((await lastMonthWinnerFor(ctx, ada, teamId, '2026-07'))?.winner.id).toBe(ada)
      expect((await lastMonthWinnerFor(ctx, ada, teamId, '2026-08'))?.winner.id).toBe(bob)
      // Nothing at all for a month with no row — the common case, since a month
      // nobody played produces none.
      expect(await lastMonthWinnerFor(ctx, ada, teamId, '2026-06')).toBeNull()
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
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })
      await ctx.db.delete(ghost)

      // Convex ids are not foreign keys, so the row can outlive its winner.
      // Dereferencing without the guard throws on `winner.firstName` and takes
      // the dashboard down; null just means no celebration.
      expect(await lastMonthWinnerFor(ctx, ada, teamId, '2026-08')).toBeNull()
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
        year: 2026,
        month: 8,
        hasSeenCelebration: [],
      })

      // NOT_A_MEMBER rather than null, and a ConvexError rather than a plain
      // one — a plain Error's message is redacted in production, so the client
      // could not tell this apart from a crash.
      await expect(lastMonthWinnerFor(ctx, outsider, teamId, '2026-08')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})
