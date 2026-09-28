import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'
import { addMonths, monthOf, toPuzzleDay } from './lib/puzzleDay.ts'
import { getTeamMonthFor } from './scores.ts'
import { setScoringSystemFor } from './scoringSystems.ts'

const modules = import.meta.glob('./**/*.ts')
const today = toPuzzleDay(new Date())

describe('setScoringSystemFor', () => {
  const newValues = {
    oneGuess: 20,
    twoGuesses: 10,
    threeGuesses: 5,
    fourGuesses: 2,
    fiveGuesses: 1,
    sixGuesses: 0,
    failed: -10,
    nA: -1,
  }

  test('writes a version effective from the current month and leaves the team doc alone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await setScoringSystemFor(ctx, ada, { teamId, values: newValues, today })

      const versions = await ctx.db.query('scoringSystems').collect()
      expect(versions).toHaveLength(1)
      expect(versions[0].effectiveFrom).toBe(today.slice(0, 7))
      expect(versions[0].oneGuess).toBe(20)
      // The team doc keeps THE ORIGINAL system — it is the fallback for every
      // month before the first version.
      expect((await ctx.db.get(teamId))!.oneGuess).toBe(5)
    })
  })

  test('a second edit in the same month patches the row rather than adding one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await setScoringSystemFor(ctx, ada, { teamId, values: newValues, today })
      await setScoringSystemFor(ctx, ada, {
        teamId,
        values: { ...newValues, oneGuess: 21 },
        today,
      })

      const versions = await ctx.db.query('scoringSystems').collect()
      expect(versions).toHaveLength(1)
      expect(versions[0].oneGuess).toBe(21)
    })
  })

  test('refuses a member who is not the owner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))

      await expect(
        setScoringSystemFor(ctx, bob, { teamId, values: newValues, today }),
      ).rejects.toMatchObject({ data: { code: 'NOT_TEAM_OWNER' } })
    })
  })

  test('refuses a non-integer or out-of-range value', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await expect(
        setScoringSystemFor(ctx, ada, { teamId, values: { ...newValues, oneGuess: 1.5 }, today }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_SYSTEM' } })
      await expect(
        setScoringSystemFor(ctx, ada, { teamId, values: { ...newValues, oneGuess: 101 }, today }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_SYSTEM' } })
      await expect(
        setScoringSystemFor(ctx, ada, { teamId, values: { ...newValues, nA: -101 }, today }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_SYSTEM' } })
    })
  })

  test('accepts the bounds themselves — 100 and -100', async () => {
    // The rejection cases above pass just as happily if the range check is
    // off by one (`<`/`>` for `<=`/`>=`), which would refuse the two values a
    // user is most likely to reach for at the extremes. Only asserting the
    // ACCEPTED edge catches that.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await setScoringSystemFor(ctx, ada, {
        teamId,
        values: { ...newValues, oneGuess: 100, failed: -100 },
        today,
      })

      const versions = await ctx.db.query('scoringSystems').collect()
      expect(versions).toHaveLength(1)
      expect(versions[0].oneGuess).toBe(100)
      expect(versions[0].failed).toBe(-100)
    })
  })

  test('THE POINT OF THE WHOLE FEATURE: an edit leaves a past month’s winner and totals alone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      const lastMonth = addMonths(today.slice(0, 7), -1)

      // Last month: Ada solved in one (5), Bob failed (-3). Ada won.
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: `${lastMonth}-05`,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: `${lastMonth}-05`,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['CRANE', 'SLATE', 'SPELL', 'SPILL', 'STEEL', 'SPEND'],
      })
      await ctx.db.insert('monthlyWinners', {
        playerId: ada,
        teamId,
        year: Number(lastMonth.slice(0, 4)),
        month: Number(lastMonth.slice(5, 7)),
        hasSeenCelebration: [ada],
      })

      // Now invert the system: failing is worth more than solving in one.
      await setScoringSystemFor(ctx, ada, {
        teamId,
        values: { ...newValues, oneGuess: -50, failed: 50 },
        today,
      })

      const row = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) =>
          q
            .eq('teamId', teamId)
            .eq('year', Number(lastMonth.slice(0, 4)))
            .eq('month', Number(lastMonth.slice(5, 7))),
        )
        .first()
      // Under the new rules Bob would have won last month. He must not.
      expect(row?.playerId).toBe(ada)
      expect(row?.hasSeenCelebration).toEqual([ada])

      // And the read path agrees: last month still resolves to the original.
      const past = await getTeamMonthFor(ctx, ada, teamId, lastMonth)
      expect(past.team.system.oneGuess).toBe(5)
    })
  })
})

describe('setScoringSystemFor — the running month', () => {
  // "Current month FORWARD" is meant literally: days already played this month
  // re-score under the new values and the running leader can change on the
  // spot. Nothing anyone has been told is final gets rewritten, because the
  // month is still in play. These also pin the WRITE half — recomputeTeamMonth
  // resolving the version rather than reading the team doc — which the
  // past-month test above cannot, since it never recomputes a past month at all.
  const inverted = {
    oneGuess: -50,
    twoGuesses: 3,
    threeGuesses: 2,
    fourGuesses: 1,
    fiveGuesses: 0,
    sixGuesses: -1,
    failed: 50,
    nA: 0,
  }

  test('re-scores days already played this month, flipping the running leader', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com', firstName: 'Bob' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada, bob], owner: ada }))
      // Today, under the ORIGINAL system: Ada solved in one (5), Bob failed
      // (-3), so Ada leads. `today` is used as the puzzle day so the board is
      // always due and always inside the current month, whatever the real date.
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: today,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('dailyScores', {
        playerId: bob,
        puzzleDay: today,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['CRANE', 'SLATE', 'SPELL', 'SPILL', 'STEEL', 'SPEND'],
      })

      await setScoringSystemFor(ctx, ada, { teamId, values: inverted, today })

      const thisMonth = monthOf(today)
      const rows = await ctx.db
        .query('monthlyWinners')
        .withIndex('by_team_year_month', (q) =>
          q
            .eq('teamId', teamId)
            .eq('year', Number(thisMonth.slice(0, 4)))
            .eq('month', Number(thisMonth.slice(5, 7))),
        )
        .collect()

      // Sanity only. This does NOT prove the month is recomputed just once:
      // recomputeTeamMonth upserts through by_team_year_month, so it could not
      // write a second row however many times it ran, and this assertion still
      // passes if the `> effectiveFrom` filter is loosened to `>=`. The
      // recompute count is not observable from the stored rows, and is not
      // worth contorting the code to expose — recomputeTeamMonth is idempotent,
      // so a repeat is wasted reads rather than a wrong answer.
      expect(rows).toHaveLength(1)
      // Under the new values failing beats solving in one, so Bob now leads.
      expect(rows[0].playerId).toBe(bob)
    })
  })

  test('the read path shows the running month under the new values immediately', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [ada], owner: ada }))

      await setScoringSystemFor(ctx, ada, { teamId, values: inverted, today })

      const now = await getTeamMonthFor(ctx, ada, teamId, monthOf(today))
      expect(now.team.system.oneGuess).toBe(-50)
      expect(now.team.systemEffectiveFrom).toBe(monthOf(today))
    })
  })
})
