import { convexTest, type TestConvex } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import { aPlayer, aTeam } from './fixtures.ts'
import { recomputeTeamMonth } from './winners'
import { addDays, addMonths, monthOf, toPuzzleDay } from './lib/puzzleDay.ts'
import { latestRepairableMonth, misdatedBoardsProbe, repairMisdatedBoards } from './migrate'
import type { Id } from './_generated/dataModel'

// wordle-teams-c442.2: the probe and the dry-run-first repair for MISDATED boards
// — two DIFFERENT puzzles sharing one (player, puzzleDay) — in migrate.ts beside
// rac's. The rule is planRedate in lib/redate.ts, unit-tested there; these pin
// what the functions read, return and (for the repair's apply alone) write.
//
// Every id, name and answer here is synthetic: this repository is public.

const modules = import.meta.glob('./**/*.ts')

type T = TestConvex<typeof schema>

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MONTH = '2025-01'
const NOON = (day: string) => Date.parse(`${day}T12:00:00Z`)

async function seedPlayer(t: T, n: number, over: Record<string, unknown> = {}) {
  return await t.run(async (ctx) =>
    ctx.db.insert(
      'players',
      aPlayer({
        legacyId: uuid(n),
        email: `player${n}@example.com`,
        firstName: `First${n}`,
        lastName: `Last${n}`,
        ...over,
      }),
    ),
  )
}

type BoardOpts = { legacyId?: number | null; guesses?: string[]; date?: number }

/** A board as the copy wrote it; `legacyId: null` writes a v2-style row with none. */
async function seedBoard(
  t: T,
  playerId: Id<'players'>,
  puzzleDay: string,
  answer: string | undefined,
  opts: BoardOpts = {},
) {
  const { legacyId, guesses = ['CRANE', answer ?? 'SLATE'] } = opts
  return await t.run(async (ctx) =>
    ctx.db.insert('dailyScores', {
      playerId,
      puzzleDay,
      date: opts.date ?? NOON(puzzleDay),
      guesses,
      ...(answer === undefined ? {} : { answer }),
      ...(legacyId === null || legacyId === undefined ? {} : { legacyId }),
    }),
  )
}

async function seedTeam(t: T, legacyId: number | undefined, playerIds: Id<'players'>[]) {
  return await t.run(async (ctx) =>
    ctx.db.insert('teams', aTeam({ legacyId, name: `team ${legacyId}`, playerIds })),
  )
}

/**
 * THE OTHER PLAYERS: three strangers who each played every listed day with that
 * day's answer — exactly MIN_CONSENSUS_BOARDS, so each day's consensus is trusted.
 */
let crowdLegacyId = 9_000
async function seedCrowd(t: T, days: Record<string, string>, first = 901, size = 3) {
  const ids = []
  for (let n = first; n < first + size; n++) ids.push(await seedPlayer(t, n))
  for (const [day, answer] of Object.entries(days)) {
    for (const id of ids) await seedBoard(t, id, day, answer, { legacyId: crowdLegacyId++ })
  }
  return ids
}

const DAYS = {
  '2025-01-08': 'ALPHA',
  '2025-01-09': 'BRAVO',
  '2025-01-10': 'CHARM',
  '2025-01-11': 'DELTA',
  '2025-01-12': 'EPOXY',
}

/** Ada's 2025-01-10 holds CHARM (that day's puzzle) and BRAVO (2025-01-09's). */
async function seedMisdated(t: T) {
  await seedCrowd(t, DAYS)
  const ada = await seedPlayer(t, 1)
  const stay = await seedBoard(t, ada, '2025-01-10', 'CHARM', { legacyId: 1 })
  const move = await seedBoard(t, ada, '2025-01-10', 'BRAVO', { legacyId: 2 })
  return { ada, stay, move }
}

const snapshotAll = (t: T) =>
  t.run(async (ctx) => ({
    scores: await ctx.db.query('dailyScores').collect(),
    winners: await ctx.db.query('monthlyWinners').collect(),
    stats: await ctx.db.query('teamMonthStats').collect(),
  }))

const dayOf = (t: T, legacyId: number) =>
  t.run(
    async (ctx) =>
      (await ctx.db
        .query('dailyScores')
        .withIndex('by_legacyId', (q) => q.eq('legacyId', legacyId))
        .unique())!.puzzleDay,
  )

const summary = (legacyId: number | null, answer: string | null) => ({
  legacyId,
  createdAt: null,
  answer,
  attempts: 2,
})

// --- probe --------------------------------------------------------------------

async function probeAll(t: T) {
  const plans = []
  let players = 0
  let cursor: string | null = null
  for (;;) {
    const page: Awaited<ReturnType<typeof probePage>> = await probePage(t, cursor)
    plans.push(...page.plans)
    players += page.players
    if (page.isDone) break
    cursor = page.cursor
  }
  return { plans, players }
}
const probePage = (t: T, cursor: string | null) => t.query(internal.migrate.misdatedBoardsProbe, { cursor })

describe('misdatedBoardsProbe', () => {
  test("finds a misdated pair and plans its move by the OTHER players' consensus", async () => {
    const t = convexTest(schema, modules)
    await seedMisdated(t)
    const { plans, players } = await probeAll(t)
    expect(players).toBe(4)
    expect(plans).toEqual([
      {
        player: uuid(1),
        kind: 'move',
        puzzleDay: '2025-01-10',
        to: '2025-01-09',
        stay: summary(1, 'CHARM'),
        move: summary(2, 'BRAVO'),
      },
    ])
  })

  test('ignores single-board days and true duplicates, including answers that differ only in case or spaces', async () => {
    const t = convexTest(schema, modules)
    await seedCrowd(t, DAYS)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-08', 'ALPHA', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-09', 'BRAVO', { legacyId: 2 })
    await seedBoard(t, ada, '2025-01-09', 'BRAVO', { legacyId: 3 })
    await seedBoard(t, ada, '2025-01-10', 'charm ', { legacyId: 4 })
    await seedBoard(t, ada, '2025-01-10', 'CHARM', { legacyId: 5 })
    expect((await probeAll(t)).plans).toEqual([])
  })

  test('holds with reasons: no target, an occupied target, a thin day, a v2 row, a missing answer, and three boards on a day', async () => {
    const t = convexTest(schema, modules)
    await seedCrowd(t, DAYS)
    const ada = await seedPlayer(t, 1)
    // no-target: nobody played ZEBRA within two days of 2025-01-08.
    await seedBoard(t, ada, '2025-01-08', 'ALPHA', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-08', 'ZEBRA', { legacyId: 2 })
    // target-occupied: 2025-01-11's EPOXY belongs on 2025-01-12, where Ada played.
    await seedBoard(t, ada, '2025-01-11', 'DELTA', { legacyId: 3 })
    await seedBoard(t, ada, '2025-01-11', 'EPOXY', { legacyId: 4 })
    await seedBoard(t, ada, '2025-01-12', 'EPOXY', { legacyId: 5 })
    // no-consensus: nobody else played 2025-01-20.
    await seedBoard(t, ada, '2025-01-20', 'FABLE', { legacyId: 6 })
    await seedBoard(t, ada, '2025-01-20', 'GLOAT', { legacyId: 7 })
    const bob = await seedPlayer(t, 2)
    // v2-row: a board with no legacyId.
    await seedBoard(t, bob, '2025-01-10', 'CHARM', { legacyId: 8 })
    await seedBoard(t, bob, '2025-01-10', 'BRAVO', { legacyId: null })
    // no-answer, and three boards on one day.
    await seedBoard(t, bob, '2025-01-11', 'DELTA', { legacyId: 9 })
    await seedBoard(t, bob, '2025-01-11', undefined, { legacyId: 10 })
    await seedBoard(t, bob, '2025-01-12', 'EPOXY', { legacyId: 11 })
    await seedBoard(t, bob, '2025-01-12', 'DELTA', { legacyId: 12 })
    await seedBoard(t, bob, '2025-01-12', 'BRAVO', { legacyId: 13 })

    const { plans } = await probeAll(t)
    expect(plans.map((p) => [p.player, p.kind, p.puzzleDay, 'reason' in p ? p.reason : null, 'targets' in p ? p.targets : null])).toEqual([
      [uuid(1), 'hold', '2025-01-08', 'no-target', []],
      [uuid(1), 'hold', '2025-01-11', 'target-occupied', ['2025-01-12']],
      [uuid(1), 'hold', '2025-01-20', 'no-consensus', []],
      [uuid(2), 'hold', '2025-01-10', 'v2-row', []],
      [uuid(2), 'hold', '2025-01-11', 'no-answer', []],
      [uuid(2), 'hold', '2025-01-12', 'not-a-pair', []],
    ])
    const triple = plans[5]
    expect(triple.kind === 'hold' && triple.boards.map((b) => b.legacyId)).toEqual([11, 12, 13])
    const v2 = plans[3]
    expect(v2.kind === 'hold' && v2.boards.map((b) => b.legacyId)).toEqual([8, null])
  })

  test("the player's own boards never vote: two strangers alone are too thin, though the pair would tip it", async () => {
    // Others on 2025-01-10: CHARM twice — below MIN_CONSENSUS_BOARDS. Counting
    // Ada's own CHARM would make it 3 of 4 and plan a move.
    const t = convexTest(schema, modules)
    await seedCrowd(t, { '2025-01-09': 'BRAVO' })
    await seedCrowd(t, { '2025-01-10': 'CHARM' }, 911, 2)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-10', 'CHARM', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-10', 'BRAVO', { legacyId: 2 })
    const { plans } = await probeAll(t)
    expect(plans).toMatchObject([{ player: uuid(1), kind: 'hold', reason: 'no-consensus' }])
  })

  test('pages ten players at a time', async () => {
    const t = convexTest(schema, modules)
    await seedCrowd(t, DAYS)
    for (let n = 1; n <= 12; n++) await seedPlayer(t, n)
    const pages = []
    let cursor: string | null = null
    for (;;) {
      const page: Awaited<ReturnType<typeof probePage>> = await probePage(t, cursor)
      pages.push(page.players)
      if (page.isDone) break
      cursor = page.cursor
    }
    expect(pages).toEqual([10, 5])
  })

  test('is registered as an internal query', () => {
    const fn = misdatedBoardsProbe as unknown as Record<string, unknown>
    expect(fn.isQuery).toBe(true)
    expect(fn.isInternal).toBe(true)
  })
})

// --- repair -------------------------------------------------------------------

const repair = (t: T, extra: Record<string, unknown> = {}) =>
  t.mutation(internal.migrate.repairMisdatedBoards, { month: MONTH, ...extra })

async function dryThenApply(t: T, month = MONTH) {
  const dry = await repair(t, { month })
  const real = await repair(t, { month, dryRun: false, expect: dry.redateKey })
  return { dry, real }
}

describe('repairMisdatedBoards', () => {
  test('dryRun is the default: it writes nothing and returns the key, the moves, the holds and the stats it would roll up', async () => {
    const t = convexTest(schema, modules)
    const { ada } = await seedMisdated(t)
    await seedTeam(t, 206, [ada])
    const before = await snapshotAll(t)

    const dry = await repair(t)
    expect(await snapshotAll(t)).toEqual(before)
    expect(dry).toEqual({
      month: MONTH,
      dryRun: true,
      redateKey: '2025-01:2:2025-01-10>2025-01-09',
      moves: [
        {
          player: uuid(1),
          kind: 'move',
          puzzleDay: '2025-01-10',
          to: '2025-01-09',
          stay: summary(1, 'CHARM'),
          move: summary(2, 'BRAVO'),
        },
      ],
      holds: [],
      teamMonths: [
        {
          team: 206,
          month: MONTH,
          statsChanged: true,
          statsCreated: true,
          players: [{ player: uuid(1), boardsBefore: 2, boardsAfter: 2 }],
        },
      ],
    })

    const real = await repair(t, { dryRun: false, expect: dry.redateKey })
    expect({ ...real, dryRun: true }).toEqual(dry)
  })

  test('an apply without expect, or with a wrong one, is refused and writes nothing', async () => {
    const t = convexTest(schema, modules)
    await seedMisdated(t)
    const before = await snapshotAll(t)
    await expect(repair(t, { dryRun: false })).rejects.toThrow(/needs `expect`/)
    await expect(repair(t, { dryRun: false, expect: '2025-01:2:2025-01-10>2025-01-11' })).rejects.toThrow(
      /plan changed.*found 2025-01:2:2025-01-10>2025-01-09/,
    )
    await expect(repair(t, { dryRun: false, expect: '2025-01:' })).rejects.toThrow(/plan changed/)
    expect(await snapshotAll(t)).toEqual(before)
  })

  test('an apply moves exactly the planned board, only its puzzleDay, and leaves held pairs and every other board alone', async () => {
    const t = convexTest(schema, modules)
    const { ada, move } = await seedMisdated(t)
    // Held (no-target): never written.
    await seedBoard(t, ada, '2025-01-12', 'EPOXY', { legacyId: 3 })
    await seedBoard(t, ada, '2025-01-12', 'ZEBRA', { legacyId: 4 })
    const before = await snapshotAll(t)

    const { real } = await dryThenApply(t)
    expect(real.holds).toMatchObject([{ puzzleDay: '2025-01-12', reason: 'no-target' }])

    const after = await snapshotAll(t)
    const moved = before.scores.find((row) => row._id === move)!
    expect(after.scores).toEqual(
      before.scores.map((row) => (row._id === move ? { ...row, puzzleDay: '2025-01-09' } : row)),
    )
    // `date` is the v1 instant, kept for audit: it is never re-derived or moved.
    expect(after.scores.find((row) => row._id === move)?.date).toBe(moved.date)
  })

  test('a second run plans nothing and writes nothing', async () => {
    const t = convexTest(schema, modules)
    const { ada } = await seedMisdated(t)
    await seedTeam(t, 206, [ada])
    await dryThenApply(t)
    const settled = await snapshotAll(t)
    const { dry } = await dryThenApply(t)
    expect(dry).toMatchObject({ redateKey: '2025-01:', moves: [], holds: [], teamMonths: [] })
    expect(await snapshotAll(t)).toEqual(settled)
  })

  test('a move across a month boundary rolls up BOTH months, and monthlyWinners stays byte-identical though the winner would change', async () => {
    const t = convexTest(schema, modules)
    await seedCrowd(t, { '2025-01-30': 'OMEGA', '2025-01-31': 'ZESTY', '2025-02-01': 'FROTH', '2025-02-02': 'GRIME' })
    const ada = await seedPlayer(t, 1)
    const bob = await seedPlayer(t, 2)
    // Ada's ZESTY is a one-guess solve (5 points) that belongs to 2025-01-31.
    await seedBoard(t, ada, '2025-02-01', 'FROTH', { legacyId: 1 })
    await seedBoard(t, ada, '2025-02-01', 'ZESTY', { legacyId: 2, guesses: ['ZESTY'] })
    // Bob's only January board: a two-guess solve, 3 points. He wins January.
    await seedBoard(t, bob, '2025-01-15', 'KNOLL', { legacyId: 3 })
    const team = await seedTeam(t, 206, [ada, bob])
    await t.run(async (ctx) => {
      const doc = (await ctx.db.get(team))!
      await recomputeTeamMonth(ctx, doc, '2025-01', toPuzzleDay(new Date()))
      await recomputeTeamMonth(ctx, doc, '2025-02', toPuzzleDay(new Date()))
    })
    const winners = await t.run(async (ctx) => ctx.db.query('monthlyWinners').collect())
    expect(winners.find((w) => w.month === 1)?.playerId).toBe(bob)
    const statsOf = (month: number) =>
      t.run(async (ctx) =>
        ctx.db
          .query('teamMonthStats')
          .withIndex('by_team_year_month', (q) => q.eq('teamId', team).eq('year', 2025).eq('month', month))
          .unique(),
      )
    expect((await statsOf(1))?.members.find((m) => m.playerId === ada)?.boards).toBe(0)
    expect((await statsOf(2))?.members.find((m) => m.playerId === ada)?.boards).toBe(2)

    const { dry } = await dryThenApply(t, '2025-02')
    expect(dry.redateKey).toBe('2025-02:2:2025-02-01>2025-01-31')
    expect(dry.teamMonths).toEqual([
      {
        team: 206,
        month: '2025-01',
        statsChanged: true,
        statsCreated: false,
        players: [{ player: uuid(1), boardsBefore: 0, boardsAfter: 1 }],
      },
      {
        team: 206,
        month: '2025-02',
        statsChanged: true,
        statsCreated: false,
        players: [{ player: uuid(1), boardsBefore: 2, boardsAfter: 1 }],
      },
    ])

    expect(await dayOf(t, 2)).toBe('2025-01-31')
    expect((await statsOf(1))?.members.find((m) => m.playerId === ada)).toMatchObject({ boards: 1, attempts: 1 })
    expect((await statsOf(2))?.members.find((m) => m.playerId === ada)).toMatchObject({ boards: 1 })
    expect(await t.run(async (ctx) => ctx.db.query('monthlyWinners').collect())).toEqual(winners)

    // The fixture is sensitive: a recompute WOULD now hand January to Ada.
    await t.run(async (ctx) => recomputeTeamMonth(ctx, (await ctx.db.get(team))!, '2025-01', toPuzzleDay(new Date())))
    expect((await t.run(async (ctx) => ctx.db.query('monthlyWinners').collect())).find((w) => w.month === 1)?.playerId).toBe(ada)
  })

  // OCCUPANCY ACROSS A MONTH EDGE. The repair reads each player's boards from two
  // days before the source month to two days after it, so a target just over the
  // edge is seen as occupied. Narrowing that read to the month itself would plan
  // these moves onto a day the player already has.
  const EDGE_DAYS = { '2025-01-30': 'OMEGA', '2025-01-31': 'ZESTY', '2025-02-01': 'FROTH', '2025-02-02': 'GRIME' }

  test('a target occupied in the PREVIOUS month is held target-occupied, and nothing is written', async () => {
    const t = convexTest(schema, modules)
    await seedCrowd(t, EDGE_DAYS)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-02-01', 'FROTH', { legacyId: 1 })
    await seedBoard(t, ada, '2025-02-01', 'ZESTY', { legacyId: 2 })
    // ZESTY belongs on 2025-01-31, where Ada already has a board.
    await seedBoard(t, ada, '2025-01-31', 'ZESTY', { legacyId: 3 })
    await seedTeam(t, 206, [ada])
    const before = await snapshotAll(t)

    const { dry } = await dryThenApply(t, '2025-02')
    expect(dry).toMatchObject({
      redateKey: '2025-02:',
      moves: [],
      holds: [{ puzzleDay: '2025-02-01', reason: 'target-occupied', targets: ['2025-01-31'] }],
      teamMonths: [],
    })
    expect(await snapshotAll(t)).toEqual(before)
  })

  test('a target occupied in the NEXT month is held target-occupied, and nothing is written', async () => {
    const t = convexTest(schema, modules)
    await seedCrowd(t, EDGE_DAYS)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-31', 'ZESTY', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-31', 'FROTH', { legacyId: 2 })
    // FROTH belongs on 2025-02-01, where Ada already has a board.
    await seedBoard(t, ada, '2025-02-01', 'FROTH', { legacyId: 3 })
    await seedTeam(t, 206, [ada])
    const before = await snapshotAll(t)

    const { dry } = await dryThenApply(t, '2025-01')
    expect(dry).toMatchObject({
      redateKey: '2025-01:',
      moves: [],
      holds: [{ puzzleDay: '2025-01-31', reason: 'target-occupied', targets: ['2025-02-01'] }],
      teamMonths: [],
    })
    expect(await snapshotAll(t)).toEqual(before)
  })

  test('STALE OCCUPANCY: a target filled after the dry run refuses the apply, and nothing is written', async () => {
    const t = convexTest(schema, modules)
    await seedCrowd(t, EDGE_DAYS)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-02-01', 'FROTH', { legacyId: 1 })
    await seedBoard(t, ada, '2025-02-01', 'ZESTY', { legacyId: 2 })
    const team = await seedTeam(t, 206, [ada])
    await t.run(async (ctx) => {
      const doc = (await ctx.db.get(team))!
      await recomputeTeamMonth(ctx, doc, '2025-01', toPuzzleDay(new Date()))
      await recomputeTeamMonth(ctx, doc, '2025-02', toPuzzleDay(new Date()))
    })

    const dry = await repair(t, { month: '2025-02' })
    expect(dry.redateKey).toBe('2025-02:2:2025-02-01>2025-01-31')
    // Between the dry run and the apply, Ada gets a board on the target day.
    await seedBoard(t, ada, '2025-01-31', 'ZESTY', { legacyId: 3 })
    const before = await snapshotAll(t)
    expect(before.winners.length).toBeGreaterThan(0)
    expect(before.stats.length).toBeGreaterThan(0)

    await expect(repair(t, { month: '2025-02', dryRun: false, expect: dry.redateKey })).rejects.toThrow(
      /plan changed.*found 2025-02:$/,
    )
    expect(await snapshotAll(t)).toEqual(before)
  })

  test("rolls up only teams holding a moved player, and only that player's months", async () => {
    const t = convexTest(schema, modules)
    const { ada } = await seedMisdated(t)
    const carl = await seedPlayer(t, 3)
    const adas = await seedTeam(t, 206, [ada])
    const carls = await seedTeam(t, 207, [carl])
    const { real } = await dryThenApply(t)
    expect(real.teamMonths.map((tm) => [tm.team, tm.month])).toEqual([[206, MONTH]])
    const stats = await t.run(async (ctx) => ctx.db.query('teamMonthStats').collect())
    expect(stats.map((s) => s.teamId)).toEqual([adas])
    expect(stats.map((s) => s.teamId)).not.toContain(carls)
  })

  test('two moves to one day: the later source day is held as a batch conflict, and the key names only the first', async () => {
    const t = convexTest(schema, modules)
    await seedCrowd(t, DAYS)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-08', 'ALPHA', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-08', 'BRAVO', { legacyId: 2 })
    await seedBoard(t, ada, '2025-01-10', 'CHARM', { legacyId: 3 })
    await seedBoard(t, ada, '2025-01-10', 'BRAVO', { legacyId: 4 })

    const { dry, real } = await dryThenApply(t)
    expect(dry.redateKey).toBe('2025-01:2:2025-01-08>2025-01-09')
    expect(real.holds).toEqual([
      {
        player: uuid(1),
        kind: 'hold',
        puzzleDay: '2025-01-10',
        reason: 'batch-conflict',
        targets: ['2025-01-09'],
        boards: [summary(3, 'CHARM'), summary(4, 'BRAVO')],
      },
    ])
    expect([await dayOf(t, 2), await dayOf(t, 4)]).toEqual(['2025-01-09', '2025-01-10'])
  })

  test('a move into a month still being played is held, not moved', async () => {
    const t = convexTest(schema, modules)
    const latest = latestRepairableMonth(new Date())
    const source = addDays(`${addMonths(latest, 1)}-01`, -1)
    const target = addDays(source, 1)
    expect(monthOf(target) > latest).toBe(true)
    await seedCrowd(t, { [source]: 'SOUTH', [target]: 'NORTH' })
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, source, 'SOUTH', { legacyId: 1 })
    await seedBoard(t, ada, source, 'NORTH', { legacyId: 2 })
    await seedTeam(t, 206, [ada])
    const before = await snapshotAll(t)

    const { dry } = await dryThenApply(t, latest)
    expect(dry).toMatchObject({
      redateKey: `${latest}:`,
      moves: [],
      holds: [{ puzzleDay: source, reason: 'target-month-open', targets: [target] }],
      teamMonths: [],
    })
    expect(await snapshotAll(t)).toEqual(before)
  })

  test('refuses a source month that is not over, and a malformed month, writing nothing', async () => {
    const t = convexTest(schema, modules)
    await seedMisdated(t)
    const before = await snapshotAll(t)
    const current = monthOf(toPuzzleDay(new Date()))
    await expect(repair(t, { month: current })).rejects.toThrow(/not a past month/)
    await expect(repair(t, { month: current, dryRun: false, expect: `${current}:` })).rejects.toThrow(
      /not a past month/,
    )
    await expect(repair(t, { month: '2025' })).rejects.toThrow(/YYYY-MM/)
    expect(await snapshotAll(t)).toEqual(before)
  })

  test('only plans pairs whose source day is in the month', async () => {
    const t = convexTest(schema, modules)
    const { ada } = await seedMisdated(t)
    await seedCrowd(t, { '2025-02-09': 'BRAVO', '2025-02-10': 'CHARM' }, 921)
    await seedBoard(t, ada, '2025-02-10', 'CHARM', { legacyId: 5 })
    await seedBoard(t, ada, '2025-02-10', 'BRAVO', { legacyId: 6 })
    const { real } = await dryThenApply(t)
    expect(real.redateKey).toBe('2025-01:2:2025-01-10>2025-01-09')
    expect(await dayOf(t, 6)).toBe('2025-02-10')
  })

  test('returns no document id, email or name', async () => {
    const t = convexTest(schema, modules)
    await seedCrowd(t, DAYS)
    const ada = await seedPlayer(t, 1, { email: 'ada.secret@example.com', firstName: 'Adaline', lastName: 'Zeppelin' })
    const r1 = await seedBoard(t, ada, '2025-01-10', 'CHARM', { legacyId: 1 })
    const r2 = await seedBoard(t, ada, '2025-01-10', 'BRAVO', { legacyId: 2 })
    const native = await seedPlayer(t, 2, { legacyId: undefined, firstName: 'Natsuko' })
    await seedBoard(t, native, '2025-01-11', 'DELTA', { legacyId: 3 })
    await seedBoard(t, native, '2025-01-11', 'GLOAT', { legacyId: 4 })
    const team = await seedTeam(t, undefined, [ada, native])
    const probe = await probeAll(t)
    const { dry, real } = await dryThenApply(t)
    const wire = JSON.stringify([probe, dry, real])
    expect(wire).toContain(uuid(1))
    expect(wire).toContain('"v2-native"')
    for (const secret of [ada, native, r1, r2, team, 'ada.secret', 'example.com', 'Adaline', 'Zeppelin', 'Natsuko']) {
      expect(wire).not.toContain(secret)
    }
  })

  test('is registered as an internal mutation', () => {
    const fn = repairMisdatedBoards as unknown as Record<string, unknown>
    expect(fn.isMutation).toBe(true)
    expect(fn.isInternal).toBe(true)
  })
})
