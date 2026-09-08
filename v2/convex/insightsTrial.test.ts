import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { insightsAccessFor, isProFor } from './access'
import { aPlayer } from './fixtures.ts'
import { INSIGHTS_TRIAL_DAYS, LAUNCH_AT, insightsAccess } from './lib/insightsAccess.ts'
import { stampTrialIfDue, upsertBoardFor } from './scores'
import { toPuzzleDay } from './lib/puzzleDay.ts'

/**
 * The trial clock and the access rule, against REAL DOCUMENTS.
 *
 * lib/insightsAccess.test.ts already proves the rule itself in both directions.
 * What can only be proven here is that the field is genuinely written, exactly
 * once, to the right value — and that insightsAccessFor reads back what was
 * stored rather than a default it happened to agree with.
 *
 * `stampTrialIfDue` takes an explicit launchAt for the reason its comment gives:
 * LAUNCH_AT is a 2099 placeholder, so a test that could not choose the launch
 * instant could only ever exercise the negative direction.
 */

const DAY = 86_400_000
const LAUNCH = Date.UTC(2026, 8, 20)
const today = toPuzzleDay(new Date())
const modules = import.meta.glob('./**/*.ts')

describe('stampTrialIfDue', () => {
  test('a board entered after launch writes a clock one month out', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const enteredAt = LAUNCH + 3 * DAY

      await stampTrialIfDue(ctx, playerId, enteredAt, 'create', LAUNCH)

      const player = await ctx.db.get(playerId)
      expect(player?.insightsTrialEndsAt).toBe(enteredAt + INSIGHTS_TRIAL_DAYS * DAY)
    })
  })

  /**
   * THE DISTINCTION THE WHOLE RULE EXISTS FOR. A dormant player's old boards must
   * not burn their trial — the clock starts at the board they enter when they
   * come BACK, not at the one they entered before they left.
   */
  test('a returning player gets a clock from the LATER board, not the earlier one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const before = LAUNCH - 200 * DAY
      const after = LAUNCH + 5 * DAY

      // The board they entered a year ago, before v2 existed.
      await stampTrialIfDue(ctx, playerId, before, 'create', LAUNCH)
      expect((await ctx.db.get(playerId))?.insightsTrialEndsAt).toBeUndefined()

      // The board they enter after the launch email brings them back.
      await stampTrialIfDue(ctx, playerId, after, 'create', LAUNCH)
      expect((await ctx.db.get(playerId))?.insightsTrialEndsAt).toBe(
        after + INSIGHTS_TRIAL_DAYS * DAY,
      )
    })
  })

  // The opposite direction.
  test('a player who never returns after launch never gets a clock at all', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      for (const enteredAt of [LAUNCH - 400 * DAY, LAUNCH - 30 * DAY, LAUNCH - 1]) {
        await stampTrialIfDue(ctx, playerId, enteredAt, 'create', LAUNCH)
      }
      expect((await ctx.db.get(playerId))?.insightsTrialEndsAt).toBeUndefined()
    })
  })

  test('a delete is not an entry, even after launch', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await stampTrialIfDue(ctx, playerId, LAUNCH + DAY, 'delete', LAUNCH)
      expect((await ctx.db.get(playerId))?.insightsTrialEndsAt).toBeUndefined()
    })
  })

  test('a second board does not extend the trial', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const first = LAUNCH + DAY

      await stampTrialIfDue(ctx, playerId, first, 'create', LAUNCH)
      const stamped = (await ctx.db.get(playerId))?.insightsTrialEndsAt

      for (let day = 2; day < 40; day++) {
        await stampTrialIfDue(ctx, playerId, LAUNCH + day * DAY, 'update', LAUNCH)
      }

      expect((await ctx.db.get(playerId))?.insightsTrialEndsAt).toBe(stamped)
    })
  })
})

describe('the stamp through upsertBoardFor', () => {
  /**
   * Pins the INERT state the 2099 placeholder is supposed to produce. Entering a
   * board today must not start a trial, because the owner has not set the launch
   * instant yet. This test is expected to change when they do.
   */
  test('entering a board today starts no trial while LAUNCH_AT is the placeholder', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())

      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-09-08',
        answer: 'SPEED',
        guesses: ['CRANE', 'SPEED'],
        today,
      })

      expect(Date.now()).toBeLessThan(LAUNCH_AT)
      expect((await ctx.db.get(playerId))?.insightsTrialEndsAt).toBeUndefined()
    })
  })

  test('and clearing a board never stamps one either', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-09-08',
        answer: 'SPEED',
        guesses: ['CRANE', 'SPEED'],
        today,
      })
      // A delete must never look like an entry: it would start a month-long
      // trial for someone who just cleared their board.
      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-09-08',
        answer: '',
        guesses: [],
        today,
      })

      expect((await ctx.db.get(playerId))?.insightsTrialEndsAt).toBeUndefined()
    })
  })
})

describe('myBenchmarkBoards board selection', () => {
  /**
   * THE DISTINCTION THE FREE TIER TURNS ON. "Most recently entered" is not "latest
   * puzzle day", and they diverge on exactly the path the free tier exists to
   * advertise: backfill is free, so a player filling in last Tuesday must get the
   * benchmark for last Tuesday rather than for a board they entered a week ago.
   *
   * Exercised through the same index the query uses rather than through the
   * public query, which would need a Better Auth session (wordle-teams-obw).
   */
  test('the latest ENTERED board is not the latest puzzle day', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())

      // Entered first, and it is the most recent PUZZLE.
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-09-07',
        date: Date.UTC(2026, 8, 7),
        answer: 'SPEED',
        guesses: ['CRANE', 'SPEED'],
      })
      // Backfilled afterwards, for an EARLIER puzzle. This is the one the panel
      // must show.
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-08-30',
        date: Date.UTC(2026, 8, 8),
        answer: 'MOIST',
        guesses: ['ORATE', 'MOIST'],
      })

      const byEntry = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_date', (q) => q.eq('playerId', playerId))
        .order('desc')
        .first()
      const byPuzzleDay = await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', playerId))
        .order('desc')
        .first()

      expect(byEntry?.puzzleDay).toBe('2026-08-30')
      // Proves the two orderings really do disagree here, so the assertion above
      // is not passing by coincidence.
      expect(byPuzzleDay?.puzzleDay).toBe('2026-09-07')
    })
  })
})

describe('how much history each tier is read', () => {
  /**
   * Layer 1 is 'full' only for pro, and the trial grants Layer 2 without it — so
   * a read keyed on layer1 alone hands a trialist one board and a personal
   * history computed from it. Asserted on the ACCESS SHAPE the query branches on,
   * since the query itself needs a session (wordle-teams-obw).
   */
  test('a trial grants Layer 2 without Layer 1, which is why the read reads both', () => {
    const trial = insightsAccess({
      isPro: false,
      trialEndsAt: Date.now() + DAY,
      now: Date.now(),
    })
    expect(trial.layer1).toBe('free')
    expect(trial.layer2).toBe('full')
    // The predicate convex/insights.ts uses. Keyed on layer1 alone this is false,
    // and the trialist gets one board.
    expect(trial.layer1 === 'full' || trial.layer2 === 'full').toBe(true)
  })

  test('a free player with no trial still reads only their latest board', () => {
    const free = insightsAccess({ isPro: false, trialEndsAt: undefined, now: Date.now() })
    expect(free.layer1 === 'full' || free.layer2 === 'full').toBe(false)
  })

  test('and pro reads the full history', () => {
    const pro = insightsAccess({ isPro: true, trialEndsAt: undefined, now: Date.now() })
    expect(pro.layer1 === 'full' || pro.layer2 === 'full').toBe(true)
  })
})

describe('insightsAccessFor', () => {
  test('reads the stored clock back, rather than a default it agrees with', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const endsAt = Date.now() + 10 * DAY
      await ctx.db.patch(playerId, { insightsTrialEndsAt: endsAt })

      const access = await insightsAccessFor(ctx, playerId)
      expect(access.trialActive).toBe(true)
      expect(access.trialEndsAt).toBe(endsAt)
      expect(access.layer2).toBe('full')
      expect(access.layer3).toBe('full')
    })
  })

  test('an expired stored clock grants nothing but takes nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.patch(playerId, { insightsTrialEndsAt: Date.now() - DAY })

      const access = await insightsAccessFor(ctx, playerId)
      expect(access.trialActive).toBe(false)
      expect(access.layer2).toBe('none')
      // The hard constraint: the free tier is intact after a trial lapses.
      expect(access.layer1).toBe('free')
      expect(access.layer3).toBe('free')
    })
  })

  test('a player with no trial and no membership still sees the free layers', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())

      const access = await insightsAccessFor(ctx, playerId)
      expect(access).toMatchObject({ layer1: 'free', layer2: 'none', layer3: 'free', layer4: 'none' })
    })
  })

  test('a pro membership grants every layer in full', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })

      expect(await isProFor(ctx, playerId)).toBe(true)
      const access = await insightsAccessFor(ctx, playerId)
      expect(access).toMatchObject({ layer1: 'full', layer2: 'full', layer3: 'full', layer4: 'full' })
    })
  })

  /**
   * ACCEPTANCE CRITERION 1, held as a test rather than an intention. Whatever else
   * changes about the tier, a player who pays nothing and has no trial must never
   * be told there is nothing here — the launch email goes to people who already
   * gave up once.
   */
  test('no combination of free inputs ever leaves a player with nothing', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      for (const trial of [undefined, Date.now() - DAY, Date.now() - 400 * DAY]) {
        const playerId = await ctx.db.insert('players', aPlayer())
        if (trial !== undefined) await ctx.db.patch(playerId, { insightsTrialEndsAt: trial })

        const access = await insightsAccessFor(ctx, playerId)
        expect(access.layer1).not.toBe('none')
        expect(access.layer3).not.toBe('none')
      }
    })
  })
})
