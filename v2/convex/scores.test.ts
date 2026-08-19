import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { addDays, addMonths, monthOf, toPuzzleDay } from './lib/puzzleDay.ts'
import { getTeamMonthFor, upsertBoardFor } from './scores'

// `today` is now bounded server-side to ±1 day of the real clock (Step 0b), so
// tests can no longer hardcode a literal like '2026-08-18' for it — that drifts
// out of bounds the moment the calendar moves on. `puzzleDay` values are NOT
// bounded and stay as literals; only `today` needs to track the real date.
const today = toPuzzleDay(new Date())

const modules = import.meta.glob('./**/*.ts')

export const aPlayer = (over: Record<string, unknown> = {}) => ({
  legacyId: '11111111-1111-4111-8111-111111111111',
  email: 'member@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  hasPwa: false,
  reminderDeliveryMethods: ['email'],
  reminderDeliveryTime: '18:00:00',
  ...over,
})

export const aTeam = (over: Record<string, unknown> = {}) => ({
  legacyId: 206,
  name: 'team 206',
  playerIds: [],
  invited: [],
  oneGuess: 5,
  twoGuesses: 3,
  threeGuesses: 2,
  fourGuesses: 1,
  fiveGuesses: 0,
  sixGuesses: -1,
  failed: -3,
  nA: 0,
  playWeekends: true,
  showLetters: true,
  ...over,
})

describe('getTeamMonthFor', () => {
  test('returns only the requested month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      for (const puzzleDay of ['2026-07-31', '2026-08-01', '2026-08-31', '2026-09-01']) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }

      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(result.players[0].scores.map((s) => s.puzzleDay)).toEqual([
        '2026-08-01',
        '2026-08-31',
      ])
    })
  })

  test('carries the team settings and scoring system the table needs', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId], playWeekends: false }))
      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(result.team.playWeekends).toBe(false)
      expect(result.team.system.oneGuess).toBe(5)
      expect(result.team.system.failed).toBe(-3)
    })
  })

  test('does not leak the team doc onto the wire — `invited` holds real email addresses', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert(
        'teams',
        aTeam({ playerIds: [playerId], invited: ['someone@example.com'] }),
      )
      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')

      // A `teams` doc structurally satisfies the payload shape, so a change
      // that swaps the explicit `system: {...}` pick for `system: team` (or
      // otherwise spreads the raw doc onto `result.team`) would leak `invited`
      // — this is a public repo and that array holds real user email
      // addresses. Assert both that it's absent and that `system` carries
      // exactly the scoring fields, not the whole team doc.
      expect(result.team).not.toHaveProperty('invited')
      expect(Object.keys(result.team.system).sort()).toEqual(
        [
          'failed',
          'fiveGuesses',
          'fourGuesses',
          'nA',
          'oneGuess',
          'sixGuesses',
          'threeGuesses',
          'twoGuesses',
        ].sort(),
      )
    })
  })

  test('reads only the target month, not the whole history — a bandwidth regression guard', async () => {
    // wordle-teams-dcu: database BANDWIDTH, not function calls, is the binding
    // free-tier limit, and Convex re-pushes a query's whole read-set to every
    // subscriber on every write that touches it. The property that matters is
    // the NUMBER OF DOCUMENTS READ, not the returned rows — an implementation
    // that swaps the index range query for `.collect()` + a JS `.filter()`
    // returns an IDENTICAL result (all the other tests in this file would
    // still pass) while reading every score the player has ever submitted.
    // `transactionLimits.documentsRead` is what catches that: convex-test
    // throws mid-query the moment the read count crosses the budget,
    // regardless of what the query eventually returns. DO NOT "simplify" this
    // into an assertion on `result` — that is exactly the shape that failed
    // to catch the regression this test exists to prevent.
    const t = convexTest({
      schema,
      modules,
      // A bounded read costs 1 (team) + 1 (member) + 2 (in-range scores) = 4
      // documents. 20 leaves comfortable headroom above that while staying
      // far below the ~64 an unbounded collect-then-filter would read.
      transactionLimits: { documentsRead: 20 },
    })
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      // 60 scores well outside the requested month...
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
          date: 1_700_000_000_000 + i,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }
      // ...and 2 inside it.
      for (const puzzleDay of ['2026-08-01', '2026-08-31']) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }

      const result = await getTeamMonthFor(ctx, playerId, teamId, '2026-08')
      expect(result.players[0].scores).toHaveLength(2)
    })
  })

  test('omits players who have not completed their profile', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const namedId = await ctx.db.insert('players', aPlayer())
      // A just-accepted invitee is in player_ids but has no name yet. v1's
      // getTeams filters these out because fromDbPlayer throws without names.
      const namelessId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '33333333-3333-4333-8333-333333333333',
          email: 'invited@example.com',
          firstName: undefined,
          lastName: undefined,
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [namedId, namelessId] }))

      const result = await getTeamMonthFor(ctx, namedId, teamId, '2026-08')
      expect(result.players).toHaveLength(1)
      expect(result.players[0].id).toBe(namedId)
    })
  })

  test('refuses a non-member', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const memberId = await ctx.db.insert('players', aPlayer())
      const outsiderId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '22222222-2222-4222-8222-222222222222',
          email: 'outsider@example.com',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [memberId] }))

      await expect(getTeamMonthFor(ctx, outsiderId, teamId, '2026-08')).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })
})

describe('upsertBoardFor', () => {
  test('creates a board', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const result = await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: ['CRANE', 'SPEED', '', '', '', ''],
        today,
      })
      expect(result.action).toBe('create')

      const rows = await ctx.db.query('dailyScores').collect()
      expect(rows).toHaveLength(1)
      // Empty rows are dropped on write; v1's DailyScore does the same on read.
      expect(rows[0].guesses).toEqual(['CRANE', 'SPEED'])
      expect(rows[0].puzzleDay).toBe('2026-08-18')
      expect(rows[0].legacyId).toBeUndefined()
    })
  })

  test('a second submit for the same day updates rather than duplicating', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const board = {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: ['CRANE', 'SPEED', '', '', '', ''],
        today,
      }
      await upsertBoardFor(ctx, playerId, board)
      const second = await upsertBoardFor(ctx, playerId, {
        ...board,
        guesses: ['CRANE', 'SLATE', 'SPEED', '', '', ''],
      })

      expect(second.action).toBe('update')
      // v1 inserted a fresh row whenever the client had no scoreId, so a double
      // submit made two. Production holds 5 such pairs (wordle-teams-rac).
      const rows = await ctx.db.query('dailyScores').collect()
      expect(rows).toHaveLength(1)
      expect(rows[0].guesses).toEqual(['CRANE', 'SLATE', 'SPEED'])
    })
  })

  test('an emptied board deletes the score', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: ['SPEED', '', '', '', '', ''],
        today,
      })
      const result = await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: '',
        guesses: ['', '', '', '', '', ''],
        today,
      })

      expect(result.action).toBe('delete')
      expect(await ctx.db.query('dailyScores').collect()).toHaveLength(0)
    })
  })

  test('rejects an incomplete board even though the UI would not send one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await expect(
        upsertBoardFor(ctx, playerId, {
          puzzleDay: '2026-08-18',
          answer: 'SPEED',
          guesses: ['CRA', '', '', '', '', ''],
          today,
        }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_BOARD' } })
    })
  })

  test('rejects emptying a day that has no score', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await expect(
        upsertBoardFor(ctx, playerId, {
          puzzleDay: '2026-08-18',
          answer: '',
          guesses: ['', '', '', '', '', ''],
          today,
        }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_BOARD' } })
    })
  })

  test('rejects a today far from the server clock — it is not the caller\'s alone', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await expect(
        upsertBoardFor(ctx, playerId, {
          puzzleDay: '2026-08-18',
          answer: 'SPEED',
          guesses: ['SPEED', '', '', '', '', ''],
          // A year out. recomputeWinners would apply this to every teammate's
          // total and write the result to the shared monthlyWinners row.
          today: '2027-08-18',
        }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_BOARD' } })
    })
  })

  test('accepts a today one day either side of the server date', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const serverToday = toPuzzleDay(new Date())
      // Both extremes of the legitimate timezone spread must pass.
      for (const today of [addDays(serverToday, -1), addDays(serverToday, 1)]) {
        const result = await upsertBoardFor(ctx, playerId, {
          puzzleDay: serverToday,
          answer: 'SPEED',
          guesses: ['SPEED', '', '', '', '', ''],
          today,
        })
        expect(result.action).toBeDefined()
      }
    })
  })
})

describe('monthly winners', () => {
  const solvedIn = (n: number, answer = 'SPEED') => {
    const filler = ['CRANE', 'SLATE', 'PRIDE', 'BLOND', 'GHOST']
    return [...filler.slice(0, n - 1), answer]
  }

  test('writes a winner row for every team the player is on', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamA = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const teamB = await ctx.db.insert('teams', aTeam({ legacyId: 207, playerIds: [playerId] }))

      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today,
      })

      const rows = await ctx.db.query('monthlyWinners').collect()
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.teamId).sort()).toEqual([teamA, teamB].sort())
      expect(rows.every((r) => r.playerId === playerId)).toBe(true)
      expect(rows.every((r) => r.year === 2026 && r.month === 8)).toBe(true)
    })
  })

  test('the highest total wins', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const adaId = await ctx.db.insert('players', aPlayer())
      const bobId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '44444444-4444-4444-8444-444444444444',
          email: 'bob@example.com',
          firstName: 'Bob',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [adaId, bobId] }))

      // Ada solves in 4 (1 point), Bob in 1 (5 points).
      await upsertBoardFor(ctx, adaId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(4),
        today,
      })
      await upsertBoardFor(ctx, bobId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today,
      })

      const row = await ctx.db.query('monthlyWinners').first()
      expect(row?.playerId).toBe(bobId)
      expect(row?.teamId).toBe(teamId)
    })
  })

  test('hasSeenCelebration survives a rewrite that does not change the winner', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      // Anchored off the real clock, not hardcoded — Step 0b bounds `today` to
      // ±1 day of it. Both boards land in the month BEFORE `today`, chosen by
      // construction (day 10 and day 11, always valid, always same month as
      // each other) rather than by luck of what today happens to be:
      // `addDays(today, -1)` would land in the wrong month on the 1st of any
      // month, silently writing two different monthlyWinners rows instead of
      // one rewriting the other and making this assertion pass for the wrong
      // reason. `today` itself stays the real server date and is after both
      // played days, which is the realistic direction — a client entering a
      // past day's board while its local "today" is the current date.
      const boardMonth = addMonths(monthOf(today), -1)
      const firstDay = `${boardMonth}-10`
      const secondDay = `${boardMonth}-11`

      await upsertBoardFor(ctx, playerId, {
        puzzleDay: firstDay,
        answer: 'SPEED',
        guesses: solvedIn(1),
        today,
      })
      const first = await ctx.db.query('monthlyWinners').first()
      await ctx.db.patch(first!._id, { hasSeenCelebration: [playerId] })

      // Another board in the same month rewrites the row. v1's SQL deleted and
      // re-inserted, wiping the seen-list and re-firing the confetti at someone
      // who had already dismissed it.
      await upsertBoardFor(ctx, playerId, {
        puzzleDay: secondDay,
        answer: 'CRANE',
        guesses: solvedIn(2, 'CRANE'),
        today,
      })

      const after = await ctx.db.query('monthlyWinners').first()
      expect(after?.hasSeenCelebration).toEqual([playerId])
    })
  })

  test('hasSeenCelebration resets when the winner actually changes', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const adaId = await ctx.db.insert('players', aPlayer())
      const bobId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '44444444-4444-4444-8444-444444444444',
          email: 'bob@example.com',
          firstName: 'Bob',
        }),
      )
      await ctx.db.insert('teams', aTeam({ playerIds: [adaId, bobId] }))

      await upsertBoardFor(ctx, adaId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(4),
        today,
      })
      const first = await ctx.db.query('monthlyWinners').first()
      expect(first?.playerId).toBe(adaId)
      await ctx.db.patch(first!._id, { hasSeenCelebration: [adaId] })

      await upsertBoardFor(ctx, bobId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today,
      })

      const after = await ctx.db.query('monthlyWinners').first()
      expect(after?.playerId).toBe(bobId)
      expect(after?.hasSeenCelebration).toEqual([])
    })
  })

  test('only the affected month is rewritten', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const julyId = await ctx.db.insert('monthlyWinners', {
        playerId,
        teamId,
        year: 2026,
        month: 7,
        hasSeenCelebration: [playerId],
      })

      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today,
      })

      const july = await ctx.db.get(julyId)
      expect(july?.hasSeenCelebration).toEqual([playerId])
      expect(await ctx.db.query('monthlyWinners').collect()).toHaveLength(2)
    })
  })

  test('recomputeWinners reads a bounded number of documents — a write-path bandwidth regression guard', async () => {
    // recomputeWinners runs on EVERY board submission — the single most
    // frequent write in the app — and its cost shape is structurally worse
    // than the read-path guard's above: it opens with
    // `ctx.db.query('teams').collect()`, the WHOLE teams table (see the
    // comment on that line in recomputeWinners), then for every team the
    // submitter belongs to reads every member plus that member's in-month
    // scores. Nothing here is a bug — the winner genuinely can't be found
    // without every member's total, and Convex can't index array membership
    // — but unlike the read path, nothing was pinning this cost, so a
    // regression that started an extra full-table scan or dropped the
    // month-range index for a `.collect()` + filter would go unnoticed.
    //
    // Fixture: the player is on 3 teams of 3 members each, plus 2 teams they
    // are NOT on (present to prove the teams-table scan cost is paid
    // regardless of how many teams the player belongs to), with 2 pre-existing
    // in-month scores per member.
    //
    // MEASURED: this fixture reads exactly 35 documents — 5 (the whole teams
    // table) + 9 (3 members x 3 teams, via ctx.db.get) + 21 (in-month
    // dailyScores across those 9 member-team pairs, including the board this
    // call itself just wrote) + 0 (no monthlyWinners rows exist yet). Found by
    // bisecting `transactionLimits.documentsRead` until the call stopped
    // throwing. The assertion below is that READ COUNT, not the returned
    // board or any monthlyWinners row — same reasoning as the read-path guard:
    // an implementation that reads more but returns identical results must
    // still trip this.
    const t = convexTest({
      schema,
      modules,
      // 45 leaves headroom above the measured 35 for incidental fixture
      // growth, while staying far below what an accidental unbounded scan
      // (e.g. reading every dailyScores row ever written instead of the
      // month range) would read.
      transactionLimits: { documentsRead: 45 },
    })
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const others = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          ctx.db.insert(
            'players',
            aPlayer({
              legacyId: `5555555${i}-5555-4555-8555-555555555555`,
              email: `member${i}@example.com`,
              firstName: `Member${i}`,
            }),
          ),
        ),
      )

      await ctx.db.insert('teams', aTeam({ legacyId: 301, playerIds: [playerId, others[0], others[1]] }))
      await ctx.db.insert('teams', aTeam({ legacyId: 302, playerIds: [playerId, others[2], others[3]] }))
      await ctx.db.insert('teams', aTeam({ legacyId: 303, playerIds: [playerId, others[4], others[5]] }))
      // Two teams the player is NOT on — present purely to prove the
      // whole-table-scan cost below is independent of the player's own team
      // count.
      await ctx.db.insert('teams', aTeam({ legacyId: 304, playerIds: [others[0]] }))
      await ctx.db.insert('teams', aTeam({ legacyId: 305, playerIds: [others[1]] }))

      for (const memberId of [playerId, ...others]) {
        for (const puzzleDay of ['2026-08-01', '2026-08-02']) {
          await ctx.db.insert('dailyScores', {
            playerId: memberId,
            puzzleDay,
            date: 1_755_500_000_000,
            answer: 'SPEED',
            guesses: ['SPEED'],
          })
        }
      }

      await upsertBoardFor(ctx, playerId, {
        puzzleDay: '2026-08-18',
        answer: 'SPEED',
        guesses: solvedIn(1),
        today,
      })
    })
  })
})
