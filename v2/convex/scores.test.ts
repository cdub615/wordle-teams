import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { addDays, addMonths, monthOf, toPuzzleDay } from './lib/puzzleDay.ts'
import { aPlayer, aTeam, authenticatedAs, makeRegisterBetterAuth } from './fixtures.ts'
import { getTeamMonthFor, monthWindowInputsFor, upsertBoardFor } from './scores'

// Supplied here, not in fixtures.ts: that file is PUSHED to the deployment and
// the Convex runtime has no import.meta. See makeRegisterBetterAuth's comment.
const registerBetterAuth = makeRegisterBetterAuth(import.meta.glob('./betterAuth/**/*.ts'))

// `today` is now bounded server-side to ±1 day of the real clock (Step 0b), so
// tests can no longer hardcode a literal like '2026-08-18' for it — that drifts
// out of bounds the moment the calendar moves on. Only `today` needs to track
// the real date.
//
// `puzzleDay` IS BOUNDED TOO SINCE wordle-teams-qvqi, but not in a way that puts
// a fuse under a literal. requirePlausiblePuzzleDay accepts any real day from
// Wordle's first puzzle to one past the server's today, so a literal in the PAST
// — every one in this file — stays valid for as long as the repo exists. What
// would rot is a literal in the FUTURE, and there are none: write one and it
// fails immediately rather than in six months, which is the failure mode worth
// having.
//
// A HARDCODED *MONTH* HANDED TO getTeamMonthFor IS EXACTLY AS UNSAFE, for a
// second and independent reason. wordle-teams-kusd's month gate refuses any
// month below a floor computed from the server's own clock, so a literal month
// is not a fixed input — it walks steadily further below the floor every time
// the calendar turns over. Nine calls in this file passed '2026-08' and would
// have begun failing in December 2026 with nobody having touched the code, which
// is the worst possible way to learn a gate exists. Every month handed to
// getTeamMonthFor is therefore derived from `thisMonth` below, and every board
// fixture those tests assert on moves with it. A `puzzleDay` that is never
// compared against a month window — upsertBoardFor's fixtures further down — is
// still free to be a literal.
const today = toPuzzleDay(new Date())
const thisMonth = monthOf(today)

// A month deep inside the Pro window and far outside the free one, for the gate
// tests below. 30 back clears the free floor (FREE_MONTHS = 3, plus one of
// SERVER_SLACK_MONTHS) by a wide margin while staying well inside
// lib/monthWindow.ts's MAX_MONTHS cap of 120 — so neither bound moves under these
// tests as the calendar advances. That is the whole reason it is not written
// '2023-03': a literal there would have a six-year fuse rather than a three-month
// one, but it is the same defect the nine rewrites above exist to remove.
const ancientMonth = addMonths(thisMonth, -30)
const ancientDay = `${ancientMonth}-14`

const modules = import.meta.glob('./**/*.ts')

describe('getTeamMonthFor', () => {
  test('returns only the requested month', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      // The 28th, where this used to read '2026-08-31'. NOT because a '-31'
      // would break in February — it would not, and an earlier version of this
      // comment claimed otherwise. `monthRange` returns `end` as a LITERAL
      // '<month>-31' for every month (lib/puzzleDay.ts, and puzzleDay.test.ts's
      // "bounds sort correctly against every real day" pins it), so the bound is
      // lexicographic rather than calendrical: a stored '2026-02-31' sorts inside
      // February's range exactly as '2026-08-31' sorts inside August's, and the
      // fixture inserts the same string the query bounds with. Both values work.
      // The 28th is chosen only because it is a real date, so nobody reading
      // these fixtures has to re-derive that argument to believe them.
      for (const puzzleDay of [
        `${addMonths(thisMonth, -1)}-28`,
        `${thisMonth}-01`,
        `${thisMonth}-28`,
        `${addMonths(thisMonth, 1)}-01`,
      ]) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }

      const result = await getTeamMonthFor(ctx, playerId, teamId, thisMonth)
      expect(result.players[0].scores.map((s) => s.puzzleDay)).toEqual([
        `${thisMonth}-01`,
        `${thisMonth}-28`,
      ])
    })
  })

  test('carries the team settings and scoring system the table needs', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId], playWeekends: false }))
      const result = await getTeamMonthFor(ctx, playerId, teamId, thisMonth)
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
      const result = await getTeamMonthFor(ctx, playerId, teamId, thisMonth)

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
    //
    // THE ROSTER HAS MORE THAN ONE MEMBER, AND THE BUDGET IS A FORMULA IN THAT
    // COUNT. Everything getTeamMonthFor reads except the team document is
    // per-member, so a single-member fixture cannot distinguish a fixed cost from
    // a per-member one, and a budget stated as a round number with "comfortable
    // headroom" hides the difference completely: on wordle-teams-kusd's task 2
    // exactly that phrasing turned out to be the precise cost of a correct
    // seven-member read, with no headroom at all. Writing the budget as
    // `MEMBERS × …` makes an added per-member read fail this test instead of
    // quietly spending the slack.
    const MEMBERS = 3
    const IN_RANGE_PER_MEMBER = 2
    const BUDGET =
      1 + // the team document (requireTeamMemberFor)
      MEMBERS * (1 + IN_RANGE_PER_MEMBER) // each member's player document, plus their in-range scores
    // NO ALLOWANCE FOR THE MONTH GATE: this asks for the CURRENT month, which is
    // above the free floor, so the gate answers from one string comparison and
    // reads nothing. That is the property worth guarding — the dashboard's own
    // query must not have got more expensive — and the below-floor path has its
    // own budgeted test at the end of this describe.
    //
    // THE CALLER NEEDS A MEMBERSHIP ROW FOR THAT SENTENCE TO BE GUARDED AT ALL,
    // and the row below is what arms it. `isProFor` is an indexed `.first()`, and
    // an index range matching nothing reads no documents — so with no row, hoisting
    // `isProFor` above the floor comparison costs nothing and this budget passes a
    // gate that resolves the caller's tier on every dashboard read. Measured
    // exactly that way: the mutant survived here while dying in the below-floor
    // test next door, which does insert a 'pro' row. winners.test.ts's equivalent
    // guard carries the same insert for the same reason, and its comment records
    // which population a membership row actually models — NOT every v2 signup, see
    // billing.ts.

    const t = convexTest({ schema, modules, transactionLimits: { documentsRead: BUDGET } })
    await t.run(async (ctx) => {
      const playerIds = []
      for (let i = 0; i < MEMBERS; i++) {
        playerIds.push(
          await ctx.db.insert('players', aPlayer({ email: `member${i}@example.com` })),
        )
      }
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds }))
      // Arms the budget against a premature isProFor — see the comment above.
      await ctx.db.insert('playerMembership', {
        playerId: playerIds[0],
        membershipStatus: 'free',
      })

      // 60 scores well outside the requested month...
      const staleMonth = addMonths(thisMonth, -20)
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert('dailyScores', {
          playerId: playerIds[0],
          puzzleDay: `${staleMonth}-${String((i % 28) + 1).padStart(2, '0')}`,
          date: 1_700_000_000_000 + i,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }
      // ...and IN_RANGE_PER_MEMBER inside it, for everyone.
      for (const playerId of playerIds) {
        for (const puzzleDay of [`${thisMonth}-01`, `${thisMonth}-28`]) {
          await ctx.db.insert('dailyScores', {
            playerId,
            puzzleDay,
            date: 1_755_500_000_000,
            answer: 'SPEED',
            guesses: ['SPEED'],
          })
        }
      }

      const result = await getTeamMonthFor(ctx, playerIds[0], teamId, thisMonth)
      expect(result.players).toHaveLength(MEMBERS)
      expect(result.players.every((p) => p.scores.length === IN_RANGE_PER_MEMBER)).toBe(true)
    })
  })

  test('omits a roster entry whose player document is gone', async () => {
    // Convex ids are not foreign keys, so a `playerIds` entry can outlive the
    // row it names. The whole scoreboard is one read: without the guard in
    // getTeamMonthFor, one unresolvable member throws on `member.firstName` and
    // every OTHER member's scores go with it. Constructed by deleting the row
    // out from under a live roster, which is the only way to reach the state
    // now that a nameless player is unrepresentable — this test replaces the
    // profile-completeness one that Phase 4's schema narrowing made impossible
    // to write.
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const namedId = await ctx.db.insert('players', aPlayer())
      const ghostId = await ctx.db.insert(
        'players',
        aPlayer({
          legacyId: '33333333-3333-4333-8333-333333333333',
          email: 'ghost@example.com',
        }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [namedId, ghostId] }))
      await ctx.db.delete(ghostId)

      const result = await getTeamMonthFor(ctx, namedId, teamId, thisMonth)
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

      await expect(getTeamMonthFor(ctx, outsiderId, teamId, thisMonth)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  test('refuses a free caller a month below the floor, including one the team has boards in', () => {
    // THE GATE. Without it the three-month window is decoration: getTeamMonthFor
    // checks membership and nothing else, so any member can reach any month by
    // typing a URL. Layer 3 stopped being decorative in wordle-teams-iht.3 and
    // this is the same standard applied to the scoreboard.
    //
    // THE TEAM MUST HAVE AN ANCIENT BOARD, and that is the whole difference
    // between this test and the floor test below it. Measured: with the roster
    // empty of old boards, replacing the `isProFor` check with `if (false)`
    // leaves THIS test green — `earliestMonthFor` returns null, `serverFloorFor`
    // floors the span at FREE_MONTHS, and the pro floor collapses onto the free
    // one, so the SECOND refusal catches what the first was supposed to. That is
    // also why the test below, whose team has no boards at all, cannot be the
    // guard for this check and is not written as one. The only call that
    // can tell the two checks apart is a NON-PRO caller asking for a month the
    // roster really does reach, which is exactly the call a v1 subscriber's free
    // teammate makes. Before this fixture gained its board, the sole test killing
    // that mutation was the Insights-trial one further down — a test whose stated
    // subject is the trial, and which would have been rewritten or deleted
    // outright by anyone who later decided the trial should open this window,
    // taking the only coverage of the pro check with it.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: ancientDay,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      for (const month of [addMonths(thisMonth, -6), ancientMonth]) {
        await expect(getTeamMonthFor(ctx, playerId, teamId, month)).rejects.toMatchObject({
          data: { code: 'MONTH_OUT_OF_WINDOW' },
        })
      }
    })
  })

  test('serves a free caller future months and every month down to the slack, and refuses the one below', () => {
    // THE BOUNDARY, BOTH SIDES OF IT. -3 is the slack month the server allows and
    // the dropdown does not offer (SERVER_SLACK_MONTHS); -4 is the first refusal.
    // Without both, SERVER_SLACK_MONTHS could be changed to 2 and every test in
    // this file would stay green.
    //
    // +1 AND +2 PIN THE ABSENCE OF AN UPPER BOUND, WHICH IS A DECISION RATHER
    // THAN AN OMISSION. monthWindow.ts's serverFloorFor says it: a future month
    // simply contains no boards, and refusing one would be "a second way for the
    // UTC/local disagreement to break a page" — the server is UTC, so a viewer in
    // UTC+14 asks for next month for a few hours at every month boundary, and a
    // reader who saw only a floor could add `if (month > serverMonth) throw` and
    // break every one of them on the 1st. Nothing else in the suite walks
    // forward, so without these two that guard would land with all four gates
    // green. This is the free-boundary fixture's lesson applied to the other end.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      for (const delta of [2, 1, 0, -1, -2, -3]) {
        await expect(
          getTeamMonthFor(ctx, playerId, teamId, addMonths(thisMonth, delta)),
        ).resolves.toBeDefined()
      }
      await expect(
        getTeamMonthFor(ctx, playerId, teamId, addMonths(thisMonth, -4)),
      ).rejects.toMatchObject({ data: { code: 'MONTH_OUT_OF_WINDOW' } })
    })
  })

  test('serves a pro caller a month back to the roster’s earliest board', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: ancientDay,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await expect(getTeamMonthFor(ctx, playerId, teamId, ancientMonth)).resolves.toBeDefined()
    })
  })

  test('refuses a pro caller a month below the roster’s earliest board and its slack', () => {
    // THE PRO BOUNDARY, BOTH SIDES OF IT, for the reason the free one above is
    // written both ways — and for one more. The gate could have been written
    // `if (month < earliestMonth) throw`, which every other test in this file
    // would accept: the free tests never reach the pro branch, and "serves a pro
    // caller" asks for exactly `earliestMonth`, which that version also allows.
    // The -1 assertion here is the only thing that pins the pro floor to
    // serverFloorFor — i.e. to the SAME one month of slack the free floor
    // carries, for the same UTC-versus-viewer reason.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: ancientDay,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await expect(
        getTeamMonthFor(ctx, playerId, teamId, addMonths(ancientMonth, -1)),
      ).resolves.toBeDefined()
      await expect(
        getTeamMonthFor(ctx, playerId, teamId, addMonths(ancientMonth, -2)),
      ).rejects.toMatchObject({ data: { code: 'MONTH_OUT_OF_WINDOW' } })
    })
  })

  test('refuses a caller inside the Insights trial the pro window', () => {
    // THE TRIAL DOES NOT OPEN THIS WINDOW, and that is a decision rather than an
    // oversight — see the spec's §4. The trial was specified as one month of
    // Insights layers 2 and 3, not a scoreboard grant. Asserted here rather than
    // left to follow from isProFor's definition, because "the trial is pro
    // enough" is exactly the reasonable-sounding change that would ship it.
    //
    // THE FIELD IS insightsTrialEndsAt (schema.ts:169), and the bare
    // `trialEndsAt` next door in lib/insightsAccess.ts is a DIFFERENT THING in
    // three places: a parameter of shouldStartTrial, a parameter of
    // insightsAccess, and a field of the InsightsAccess those return into.
    // access.ts's insightsAccessFor is the adapter between them
    // (`trialEndsAt: player?.insightsTrialEndsAt`). Named here for orientation
    // rather than as a warning: writing the wrong one into `aPlayer` is caught
    // immediately and legibly by the schema validator — measured, "Validator
    // error: Unexpected field `trialEndsAt` in object" — because the players
    // table's validator rejects fields it does not declare.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert(
        'players',
        aPlayer({ insightsTrialEndsAt: Date.now() + 86_400_000 }),
      )
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: ancientDay,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      await expect(getTeamMonthFor(ctx, playerId, teamId, ancientMonth)).rejects.toMatchObject({
        data: { code: 'MONTH_OUT_OF_WINDOW' },
      })
    })
  })

  test('refuses a malformed month, which can lexically bracket a whole year', () => {
    // getMyMonth's header in convex/scores.ts has documented this property of
    // `v.string()` months since before the gate existed: a bare '2026' bounds
    // '2026-01'..'2026-31', which lexically brackets every day of the year.
    // Harmless there, and harmless here while the route was the only caller —
    // app.tsx's validateSearch applies the same regex to `?month=`. Not harmless
    // now: a malformed month sorts ABOVE a Pro caller's floor far more often than
    // below it ('abc' and a full 'YYYY-MM-DD' always do), so without a shape check
    // a Pro member could pull every board for every teammate for a whole year in
    // one payload.
    //
    // THE CALLER HERE MUST BE PRO WITH AN OLD BOARD, and that is not incidental.
    // The refusals below have to come from the SHAPE CHECK, and against a free
    // caller most of these strings fall below the free floor and would be refused
    // by the floor instead — so a free fixture would stay green with the shape
    // check deleted and prove nothing. A Pro floor years back is what puts them
    // above it, which is the situation the check exists for.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: ancientDay,
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      const thisYear = thisMonth.slice(0, 4)
      for (const month of [thisYear, `${thisYear}-`, `${thisMonth}-01`, 'abc', '']) {
        await expect(getTeamMonthFor(ctx, playerId, teamId, month)).rejects.toMatchObject({
          data: { code: 'MONTH_OUT_OF_WINDOW' },
        })
      }
    })
  })

  test('a below-floor pro read costs a fixed number of documents per member', () => {
    // THE GATE'S OWN BANDWIDTH GUARD, and a separate test from the one above
    // because it guards a DIFFERENT PATH. That one asks for the current month, so
    // the gate answers from one string comparison and reads nothing; this one asks
    // for a month below the free floor, which is the only path that pays for
    // isProFor and for earliestMonthFor's walk across the roster.
    //
    // THE BUDGET IS A FORMULA IN MEMBERS, not a round number with headroom, and
    // that is the point: this path walks the roster TWICE — once in
    // earliestMonthFor and once in the scoreboard read — so it is the most
    // per-member-expensive thing getTeamMonthFor does, and a fixture with one
    // member cannot see per-member growth at all. A budget of "20, comfortable
    // headroom" measured on a single member read as slack and was in fact the
    // exact cost of a correct seven-member read (measured on wordle-teams-kusd's
    // task 2). Exact-cost budgets fail loudly when the cost changes, which is the
    // only useful behaviour for a guard nobody re-derives by hand.
    const MEMBERS = 3
    const BOARDS_IN_MONTH = 1
    const BUDGET =
      1 + // the team document (requireTeamMemberFor)
      1 + // the caller's playerMembership row (isProFor)
      MEMBERS * 2 + // earliestMonthFor: one player document + one earliest-board probe each
      MEMBERS * (1 + BOARDS_IN_MONTH) // the scoreboard: the same player documents again, plus their in-range scores

    const t = convexTest({ schema, modules, transactionLimits: { documentsRead: BUDGET } })
    return t.run(async (ctx) => {
      const playerIds = []
      for (let i = 0; i < MEMBERS; i++) {
        playerIds.push(
          await ctx.db.insert('players', aPlayer({ email: `member${i}@example.com` })),
        )
      }
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds }))
      await ctx.db.insert('playerMembership', { playerId: playerIds[0], membershipStatus: 'pro' })
      for (const playerId of playerIds) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay: ancientDay,
          date: 1_755_500_000_000,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }

      const result = await getTeamMonthFor(ctx, playerIds[0], teamId, ancientMonth)
      expect(result.players).toHaveLength(MEMBERS)
      expect(result.players.every((p) => p.scores.length === BOARDS_IN_MONTH)).toBe(true)
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

  /**
   * THE GAP, REFUSED AT THE WRITE (wordle-teams-5w0t). The client disables Submit
   * on this same predicate now, so this is the only thing standing between a
   * crafted request and a score one guess better than the board it came from —
   * `attemptsFor` counts through `normalizeGuesses`, which drops the hole, so
   * this board would have been stored as a three-guess win by a player who took
   * four.
   *
   * SEPARATE FROM THE 'CRA' CASE ABOVE, which is caught by the "every guess is 0
   * or 5 letters" rule. Every row here is a legal length; the hole is the whole
   * defect, and before this rule the server accepted it.
   */
  test('rejects a board with a gap between the guesses', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await expect(
        upsertBoardFor(ctx, playerId, {
          puzzleDay: '2026-08-18',
          answer: 'SPEED',
          guesses: ['CRANE', '', 'SLATE', 'SPEED', '', ''],
          today,
        }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_BOARD' } })

      expect(await ctx.db.query('dailyScores').collect()).toHaveLength(0)
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
          // A year out. recomputePlayerMonth would apply this to every
          // teammate's total and write the result to the shared monthlyWinners row.
          today: '2027-08-18',
        }),
      ).rejects.toMatchObject({ data: { code: 'INVALID_DATE' } })
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

  // wordle-teams-qvqi. Until this guard landed, `puzzleDay` was a bare
  // `v.string()` nothing on the server ever looked at, so every value below was
  // storable forever as half of dailyScores' (playerId, puzzleDay) key.
  describe('the day the board is for', () => {
    // NAMED AS A ROOT-CAUSE TEST, because '' is the value that actually broke
    // something: it sorts below every real day, so earliestMonthFor took it as a
    // team's minimum, monthOf('') is '', the window span is NaN, and the month
    // dropdown's "currentMonth is always element 0" invariant fails.
    test('refuses the malformed days that used to be storable', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const playerId = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
        for (const puzzleDay of ['', '1', 'x', '2026', '2026-08']) {
          await expect(
            upsertBoardFor(ctx, playerId, {
              puzzleDay,
              answer: 'SPEED',
              guesses: ['SPEED', '', '', '', '', ''],
              today,
            }),
          ).rejects.toMatchObject({ data: { code: 'INVALID_PUZZLE_DAY' } })
        }
        // And nothing was written on the way to any of those refusals.
        expect(await ctx.db.query('dailyScores').collect()).toEqual([])
      })
    })

    test('refuses a day before Wordle existed', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const playerId = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
        await expect(
          upsertBoardFor(ctx, playerId, {
            puzzleDay: '1000-01-01',
            answer: 'SPEED',
            guesses: ['SPEED', '', '', '', '', ''],
            today,
          }),
        ).rejects.toMatchObject({ data: { code: 'INVALID_PUZZLE_DAY' } })
      })
    })

    // WELL-SHAPED AND NOT A DAY. This is the case a shape-only check — the kind
    // lib/monthWindow.ts's isMonth deliberately is — would let through, and it is
    // not harmless: fromPuzzleDay rolls '2026-02-30' over to March 2nd, so the
    // board would render on a different day from the one it is keyed on.
    test('refuses a well-shaped string that is not a real calendar day', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const playerId = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
        await expect(
          upsertBoardFor(ctx, playerId, {
            puzzleDay: '2026-02-30',
            answer: 'SPEED',
            guesses: ['SPEED', '', '', '', '', ''],
            today,
          }),
        ).rejects.toMatchObject({ data: { code: 'INVALID_PUZZLE_DAY' } })
      })
    })

    test('refuses a day in the future, past the one of timezone slack', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const playerId = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
        await expect(
          upsertBoardFor(ctx, playerId, {
            puzzleDay: addDays(toPuzzleDay(new Date()), 2),
            answer: 'SPEED',
            guesses: ['SPEED', '', '', '', '', ''],
            today,
          }),
        ).rejects.toMatchObject({ data: { code: 'INVALID_PUZZLE_DAY' } })
      })
    })

    // THE HALF THAT MUST KEEP WORKING, and the reason the range is not bounded
    // to today: backfilling an old board is a supported feature, not an anomaly.
    // A guard that refused this would be worse than the hole it closed.
    test('still accepts a backfilled board years old, and tomorrow', async () => {
      const t = convexTest(schema, modules)
      await t.run(async (ctx) => {
        const playerId = await ctx.db.insert('players', aPlayer())
        await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
        for (const puzzleDay of ['2023-03-14', addDays(toPuzzleDay(new Date()), 1)]) {
          const result = await upsertBoardFor(ctx, playerId, {
            puzzleDay,
            answer: 'SPEED',
            guesses: ['SPEED', '', '', '', '', ''],
            today,
          })
          expect(result.action).toBe('create')
        }
      })
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
    // recomputePlayerMonth (convex/winners.ts) runs on EVERY board submission
    // — the single most frequent write in the app — and its cost shape is
    // structurally worse than the read-path guard's above: it opens with
    // `ctx.db.query('teams').collect()`, the WHOLE teams table (see the
    // comment on that line in recomputePlayerMonth), then for every team the
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
    // call itself just wrote) + 0 (no monthlyWinners rows exist yet) + 0
    // (scoringSystems: recomputeTeamMonth resolves the month's scoring version
    // via loadTeamMonthSystem, one indexed query per team, and this fixture has
    // no version rows for any of them). Found by bisecting
    // `transactionLimits.documentsRead` until the call stopped throwing.
    //
    // That last term is the one to watch. It is 0 only because version-less
    // teams are the common case, NOT because the query is free: a team carries
    // one row per month its scoring was edited in, and every one of them is
    // read on every board submission by that team's members. The headroom
    // below absorbs that; a team with a long edit history is what would eat it.
    //
    // The assertion below is that READ COUNT, not the returned board or any
    // monthlyWinners row — same reasoning as the read-path guard: an
    // implementation that reads more but returns identical results must still
    // trip this.
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

describe('getTeamMonthFor — scoring version resolution', () => {
  test('returns the team’s own values when there are no versions', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      const result = await getTeamMonthFor(ctx, playerId, teamId, thisMonth)
      expect(result.team.system.oneGuess).toBe(5)
      expect(result.team.systemEffectiveFrom).toBeNull()
    })
  })

  test('a past month resolves to the version that governed it, not the current one', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
      await ctx.db.insert('scoringSystems', {
        teamId,
        effectiveFrom: thisMonth,
        oneGuess: 20,
        twoGuesses: 3,
        threeGuesses: 2,
        fourGuesses: 1,
        fiveGuesses: 0,
        sixGuesses: -1,
        failed: -3,
        nA: 0,
      })

      // Named for their relationship to the version's effectiveFrom rather than
      // for calendar months: these used to be `july` and `august` against a
      // hardcoded '2026-07'/'2026-08', which stopped being the right names the
      // moment the months became relative to the clock.
      const beforeTheVersion = await getTeamMonthFor(ctx, playerId, teamId, addMonths(thisMonth, -1))
      expect(beforeTheVersion.team.system.oneGuess).toBe(5)
      expect(beforeTheVersion.team.systemEffectiveFrom).toBeNull()

      const fromTheVersion = await getTeamMonthFor(ctx, playerId, teamId, thisMonth)
      expect(fromTheVersion.team.system.oneGuess).toBe(20)
      expect(fromTheVersion.team.systemEffectiveFrom).toBe(thisMonth)
    })
  })
})

describe('monthWindowInputsFor', () => {
  test('reports the earliest board of anyone on the roster, not just the caller', () => {
    // "THE TEAM'S EARLIEST SCORE" IS NECESSARILY THE ROSTER'S, because
    // dailyScores has no teamId — a board belongs to a player. This is the same
    // resolution getTeamMonthFor already does, so the window and the data it
    // gates agree by construction.
    return convexTest(schema, modules).run(async (ctx) => {
      const mine = await ctx.db.insert('players', aPlayer())
      const theirs = await ctx.db.insert('players', aPlayer({ email: 'other@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [mine, theirs] }))
      await ctx.db.insert('dailyScores', {
        playerId: mine,
        puzzleDay: '2026-05-02',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('dailyScores', {
        playerId: theirs,
        puzzleDay: '2023-03-14',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      expect(await monthWindowInputsFor(ctx, mine, teamId)).toEqual({ earliestMonth: '2023-03' })
    })
  })

  test('reports null when nobody on the team has ever entered a board', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      expect(await monthWindowInputsFor(ctx, playerId, teamId)).toEqual({ earliestMonth: null })
    })
  })

  test('refuses a caller who is not on the team', () => {
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const outsiderId = await ctx.db.insert('players', aPlayer({ email: 'out@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))

      await expect(monthWindowInputsFor(ctx, outsiderId, teamId)).rejects.toMatchObject({
        data: { code: 'NOT_A_MEMBER' },
      })
    })
  })

  test('a roster entry whose player row is gone does not widen the window', () => {
    // Convex ids are not foreign keys, so nothing guarantees every id in
    // playerIds resolves. ASSERTED WITH THE GHOST HOLDING THE OLDEST BOARD —
    // a ghost with no boards would be indistinguishable from a member with none,
    // and would prove nothing about what happens to a dangling id.
    //
    // THE GHOST'S BOARD MUST NOT SET THE WINDOW, matching getTeamMonthFor's
    // (getTeamMonthFor): that function drops a dangling roster id before it ever
    // reads a score for it, so the ghost's 2023-03 board can never reach the
    // scoreboard either. A window that offered 2023-03 anyway would let a viewer
    // pick a month getTeamMonthFor renders as empty — worse than a window that
    // simply forgets the departed player's history, which is what this asserts:
    // the survivor's own 2026-05 is the earliest that counts.
    return convexTest(schema, modules).run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      const ghostId = await ctx.db.insert('players', aPlayer({ email: 'ghost@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [playerId, ghostId] }))
      await ctx.db.insert('dailyScores', {
        playerId,
        puzzleDay: '2026-05-02',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.insert('dailyScores', {
        playerId: ghostId,
        puzzleDay: '2023-03-14',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })
      await ctx.db.delete(ghostId)

      expect((await monthWindowInputsFor(ctx, playerId, teamId)).earliestMonth).toBe('2026-05')
    })
  })

  test('reads a bounded number of documents — a bandwidth regression guard', () => {
    // The sibling of the budget on getTeamMonthFor above (scores.test.ts:150-161,
    // and of the below-floor one at :456-464, which budgets a call that reaches
    // earliestMonthFor through the month gate rather than directly):
    // swapping earliestMonthFor's index `.first()` for
    // `.collect().then((rows) => rows[0] ?? null)` returns an IDENTICAL
    // `earliestMonth` — every other test in this block would still pass — while
    // reading every board each member has ever entered instead of one.
    // `transactionLimits.documentsRead` is what catches that regardless of what
    // the query returns. DO NOT "simplify" this into an assertion on the result.
    //
    // A TWO-MEMBER ROSTER, NOT ONE — a single-member fixture cannot observe
    // per-member growth, and the cost here scales with the roster: for M
    // members the correct read is 1 (team) + M * (1 `ctx.db.get` + 1 indexed
    // `.first()`) = 2M + 1 documents. At M=2 that is 5, verified by
    // bisecting `transactionLimits.documentsRead` against the real
    // implementation (4 throws, 5 passes). THE BUDGET IS SCOPED TO THIS
    // FIXTURE'S ROSTER SIZE, not a general headroom multiple — widening the
    // fixture to a third member means raising this number to 2*3+1 = 7, not
    // leaving it as "comfortable slack" that happens to still pass.
    return convexTest({
      schema,
      modules,
      transactionLimits: { documentsRead: 5 },
    }).run(async (ctx) => {
      const earliest = await ctx.db.insert('players', aPlayer())
      const other = await ctx.db.insert('players', aPlayer({ email: 'other@example.com' }))
      const teamId = await ctx.db.insert('teams', aTeam({ playerIds: [earliest, other] }))

      // `earliest` holds 60 boards, the oldest starting 2020-01-01 — large
      // enough that the `.collect()` mutant's cost (60 for this member alone,
      // on top of the bounded reads above) blows the budget by an order of
      // magnitude rather than by one or two documents.
      for (let i = 0; i < 60; i++) {
        await ctx.db.insert('dailyScores', {
          playerId: earliest,
          puzzleDay: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
          date: 1_700_000_000_000 + i,
          answer: 'SPEED',
          guesses: ['SPEED'],
        })
      }
      // `other` holds one later board — present so the roster is genuinely
      // two members, not decoration; its own `.first()` still costs the same
      // one document regardless of how few boards it has.
      await ctx.db.insert('dailyScores', {
        playerId: other,
        puzzleDay: '2021-06-15',
        date: 1_755_500_000_000,
        answer: 'SPEED',
        guesses: ['SPEED'],
      })

      expect(await monthWindowInputsFor(ctx, earliest, teamId)).toEqual({ earliestMonth: '2020-01' })
    })
  })
})

describe('monthWindow', () => {
  test('refuses an unauthenticated caller', async () => {
    // NOT `{ code: 'UNAUTHENTICATED' }`, even though that is an AccessCode and
    // access.ts's requirePlayer has a line that throws it — see the identical
    // note on chat.ts's public-surface test (chat.test.ts): for a caller with
    // no identity at all, `authComponent.getAuthUser(ctx)` throws its own bare
    // string ConvexError before requirePlayer's own check ever runs.
    const t = convexTest(schema, modules)
    const teamId = await t.run(async (ctx) => {
      const playerId = await ctx.db.insert('players', aPlayer())
      return await ctx.db.insert('teams', aTeam({ playerIds: [playerId] }))
    })

    await expect(t.query(api.scores.monthWindow, { teamId })).rejects.toMatchObject({
      data: 'Unauthenticated',
    })
  })
})

describe('scores.getMyMonth', () => {
  test("returns only the caller's own scores, only for the month asked for", async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      const bob = await ctx.db.insert('players', aPlayer({ email: 'bob@example.com' }))
      for (const [playerId, puzzleDay] of [
        [ada, '2026-09-01'],
        [ada, '2026-09-30'],
        [ada, '2026-08-31'],
        [ada, '2026-10-01'],
        [bob, '2026-09-15'],
      ] as const) {
        await ctx.db.insert('dailyScores', {
          playerId,
          puzzleDay,
          date: Date.now(),
          answer: 'crane',
          guesses: ['crane'],
        })
      }
    })
    const as = await authenticatedAs(t, 'member@example.com')
    const scores = await as.query(api.scores.getMyMonth, { month: '2026-09' })
    // Boundaries both included, neighbouring months both excluded, and nothing
    // of Bob's — the month filter is a lexical range on puzzleDay, so an
    // off-by-one at either end is a silent data bug rather than an error.
    expect(scores.map((score) => score.puzzleDay)).toEqual(['2026-09-01', '2026-09-30'])
  })

  test('includes the 31st of a 31-day month', async () => {
    // THE UPPER BOUND IS '<month>-31', AND SEPTEMBER CANNOT PROVE IT. Every
    // assertion in the test above passes just as well with a bound of
    // '<month>-30', because no September day exceeds it — so that test guards
    // the lower bound and the player filter, but not this. Only a 31-day month
    // separates the two, and getting it wrong silently drops the last board of
    // seven months a year: no error, no empty state, just a day the player
    // entered that the form no longer prefills.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      for (const puzzleDay of ['2026-10-01', '2026-10-31', '2026-11-01']) {
        await ctx.db.insert('dailyScores', {
          playerId: ada,
          puzzleDay,
          date: Date.now(),
          answer: 'crane',
          guesses: ['crane'],
        })
      }
    })
    const as = await authenticatedAs(t, 'member@example.com')
    const scores = await as.query(api.scores.getMyMonth, { month: '2026-10' })
    expect(scores.map((score) => score.puzzleDay)).toEqual(['2026-10-01', '2026-10-31'])
  })

  test('carries the same fields getTeamMonth puts on a score', async () => {
    // The form derives from ONE shape regardless of which query fed it, so a
    // drift here is a runtime break in the team-less branch only.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: '2026-09-02',
        date: Date.now(),
        answer: 'crane',
        guesses: ['stare', 'crane'],
      })
    })
    const as = await authenticatedAs(t, 'member@example.com')
    const [score] = await as.query(api.scores.getMyMonth, { month: '2026-09' })
    expect(Object.keys(score).sort()).toEqual(['answer', 'guesses', 'id', 'puzzleDay'])
    expect(score).toMatchObject({ answer: 'crane', guesses: ['stare', 'crane'] })
  })

  test("a row with no answer at all comes back as '', not undefined", async () => {
    // THE `?? ''` FALLBACK, WHICH NOTHING ELSE IN THIS FILE REACHES. `answer`
    // is v.optional in the schema — v1 rows predate it — and getTeamMonthFor
    // coalesces it for exactly that reason (getTeamMonthFor's `scores.map`). Drop the
    // coalesce here and all four gates stay green: the shape test above asserts
    // Object.keys, which still lists `answer` when the value is undefined, and
    // every other fixture in this file sets one. The TYPE link does not catch
    // it either — `string | undefined` still satisfies the team branch's
    // `string`. Only a row with the field genuinely absent proves it, and the
    // symptom it prevents is React dropping an uncontrolled contentEditable
    // back to its previous text in the entry form.
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: '2026-09-04',
        date: Date.now(),
        guesses: ['stare'],
      })
    })
    const as = await authenticatedAs(t, 'member@example.com')
    const [score] = await as.query(api.scores.getMyMonth, { month: '2026-09' })
    expect(score.answer).toBe('')
  })

  test('is empty rather than throwing for a caller with no player row', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    const as = await authenticatedAs(t, 'nobody@example.com')
    expect(await as.query(api.scores.getMyMonth, { month: '2026-09' })).toEqual([])
  })

  // wordle-teams-byft's half that WAS a real gap. A bare '2026' bounds
  // '2026-01'..'2026-31', which lexically brackets every day of the year, so
  // without the isMonth check this returns TWELVE MONTHS of boards to a caller
  // who asked for one — `monthRange`'s "cannot reach into the next month"
  // guarantee holds only for a well-formed 'YYYY-MM'.
  //
  // THE FIXTURE SPANS TWO MONTHS ON PURPOSE. A single-month fixture would pass
  // against the broken version too, since one month of a year is still one
  // month; it takes a second month inside the same year for the bracket to show.
  test('treats a month-shaped argument as a month and anything else as nothing', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      for (const puzzleDay of ['2026-03-04', '2026-09-04']) {
        await ctx.db.insert('dailyScores', {
          playerId: ada,
          puzzleDay,
          date: Date.now(),
          answer: 'crane',
          guesses: ['crane'],
        })
      }
    })
    const as = await authenticatedAs(t, 'member@example.com')
    expect(
      (await as.query(api.scores.getMyMonth, { month: '2026-09' })).map((s) => s.puzzleDay),
    ).toEqual(['2026-09-04'])
    for (const month of ['2026', '', '2026-09-04', 'x']) {
      expect(await as.query(api.scores.getMyMonth, { month })).toEqual([])
    }
  })

  // AND THE FLOOR IS STILL DELIBERATELY ABSENT — the other half of
  // wordle-teams-byft, decided rather than overlooked. This query is the EDITING
  // affordance (SoloBoardEntryForm's prefill), not an analysis surface, so a free
  // player reaches every month they have boards in. A floor here would open the
  // entry form empty over a board that exists, and a re-submit would overwrite
  // it. insights.myBenchmarkBoards is where a player's own history IS rationed,
  // and both files carry the rule.
  test('serves a free caller a month far below any window, because this is the entry form', async () => {
    const t = convexTest(schema, modules)
    registerBetterAuth(t)
    await t.run(async (ctx) => {
      const ada = await ctx.db.insert('players', aPlayer())
      await ctx.db.insert('dailyScores', {
        playerId: ada,
        puzzleDay: ancientDay,
        date: Date.now(),
        answer: 'crane',
        guesses: ['crane'],
      })
    })
    const as = await authenticatedAs(t, 'member@example.com')
    // No playerMembership row at all, so isProFor is false — the same caller
    // getTeamMonthFor refuses this month's scoreboard to.
    expect(
      (await as.query(api.scores.getMyMonth, { month: ancientMonth })).map((s) => s.puzzleDay),
    ).toEqual([ancientDay])
  })
})
