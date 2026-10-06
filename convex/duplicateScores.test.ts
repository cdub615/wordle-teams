import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import { aPlayer, aTeam } from './fixtures.ts'
import { recomputeTeamMonth } from './winners'
import { toPuzzleDay } from './lib/puzzleDay.ts'
import type { Id } from './_generated/dataModel'

// wordle-teams-rac: the measure, impact and repair functions for duplicate
// dailyScores rows, all in migrate.ts. The rule they share is unit-tested in
// lib/duplicateScores.test.ts; these pin what each function reads, returns and
// (for the repair alone) writes.

const modules = import.meta.glob('./**/*.ts')

type T = ReturnType<typeof convexTest>

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A copied player: carries a legacyId, as every v1 player in production does. */
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

/** A board as the copy wrote it: a v1 serial id and v1's created_at. */
async function seedBoard(
  t: T,
  playerId: Id<'players'>,
  puzzleDay: string,
  legacyId: number | undefined,
  createdAt: number | undefined,
  guesses: string[] = ['CRANE', 'SLATE', 'SPEED'],
  answer = 'SPEED',
) {
  return await t.run(async (ctx) =>
    ctx.db.insert('dailyScores', {
      playerId,
      puzzleDay,
      date: Date.parse(`${puzzleDay}T12:00:00Z`),
      guesses,
      answer,
      ...(legacyId === undefined ? {} : { legacyId }),
      ...(createdAt === undefined ? {} : { createdAt }),
    }),
  )
}

/** Every page of the probe, the way the runner walks it. */
async function probeAll(t: T) {
  const pages = []
  let cursor: string | null = null
  for (;;) {
    const page: Awaited<ReturnType<typeof probePage>> = await probePage(t, cursor)
    pages.push(page)
    if (page.isDone) break
    cursor = page.cursor
  }
  return pages
}
const probePage = (t: T, cursor: string | null) =>
  t.query(internal.migrate.duplicateScoresProbe, { cursor })

describe('duplicateScoresProbe', () => {
  test('finds an identical pair, a differing pair and a triple, and ignores a clean player', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    const clean = await seedPlayer(t, 2)

    // Identical pair: the 2024-11-17 shape, two rows a second apart.
    await seedBoard(t, ada, '2024-11-17', 101, 1_000)
    await seedBoard(t, ada, '2024-11-17', 102, 2_000)
    // Differing pair: the later row is the 4-guess board.
    await seedBoard(t, ada, '2025-01-09', 201, 5_000, ['CRANE', 'SPEED'])
    await seedBoard(t, ada, '2025-01-09', 202, 45_000, ['CRANE', 'SLATE', 'SHARP', 'SPEED'])
    // Triple.
    await seedBoard(t, ada, '2025-12-25', 301, 7_000)
    await seedBoard(t, ada, '2025-12-25', 303, 9_000)
    await seedBoard(t, ada, '2025-12-25', 302, 8_000)
    // A single row on a day of its own is not a group.
    await seedBoard(t, ada, '2025-12-26', 401, 10_000)
    await seedBoard(t, clean, '2024-11-17', 501, 1_000)
    await seedBoard(t, clean, '2024-11-18', 502, 1_000)

    const [page] = await probeAll(t)
    expect(page.players).toBe(2)
    expect(page.affected).toEqual([
      {
        player: uuid(1),
        groups: [
          {
            puzzleDay: '2024-11-17',
            rows: 2,
            differing: false,
            keep: { legacyId: 102, createdAt: 2_000, attempts: 3 },
            drop: [{ legacyId: 101, createdAt: 1_000, attempts: 3 }],
          },
          {
            puzzleDay: '2025-01-09',
            rows: 2,
            differing: true,
            keep: { legacyId: 202, createdAt: 45_000, attempts: 4 },
            drop: [{ legacyId: 201, createdAt: 5_000, attempts: 2 }],
          },
          {
            puzzleDay: '2025-12-25',
            rows: 3,
            differing: false,
            keep: { legacyId: 303, createdAt: 9_000, attempts: 3 },
            drop: [
              { legacyId: 301, createdAt: 7_000, attempts: 3 },
              { legacyId: 302, createdAt: 8_000, attempts: 3 },
            ],
          },
        ],
      },
    ])
  })

  test('pages ten players at a time and finds duplicates on both sides of a cursor boundary', async () => {
    const t = convexTest(schema, modules)
    const ids = []
    for (let n = 1; n <= 23; n++) ids.push(await seedPlayer(t, n))
    // Player 1 is on page one, player 12 on page two, player 23 on page three.
    for (const n of [1, 12, 23]) {
      await seedBoard(t, ids[n - 1], '2025-01-09', n * 10, 1)
      await seedBoard(t, ids[n - 1], '2025-01-09', n * 10 + 1, 2)
    }

    const pages = await probeAll(t)
    expect(pages.map((p) => p.players)).toEqual([10, 10, 3])
    expect(pages.map((p) => p.affected.map((a) => a.player))).toEqual([
      [uuid(1)],
      [uuid(12)],
      [uuid(23)],
    ])
  })

  test('returns no email or name anywhere', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1, {
      email: 'ada.secret@example.com',
      firstName: 'Adaline',
      lastName: 'Zeppelin',
    })
    await seedBoard(t, ada, '2025-01-09', 1, 1)
    await seedBoard(t, ada, '2025-01-09', 2, 2)

    const wire = JSON.stringify(await probeAll(t))
    expect(wire).toContain(uuid(1))
    for (const secret of ['ada.secret', 'example.com', 'Adaline', 'Zeppelin', ada]) {
      expect(wire).not.toContain(secret)
    }
  })

  test('marks a v2-born player and a v2-written row rather than exposing document ids', async () => {
    const t = convexTest(schema, modules)
    const native = await seedPlayer(t, 1, { legacyId: undefined })
    const nativeRow = await seedBoard(t, native, '2025-01-09', undefined, undefined)
    await seedBoard(t, native, '2025-01-09', 7, 1)

    const [page] = await probeAll(t)
    expect(page.affected).toEqual([
      {
        player: 'v2-native',
        groups: [
          {
            puzzleDay: '2025-01-09',
            rows: 2,
            differing: false,
            keep: { legacyId: 7, createdAt: 1, attempts: 3 },
            drop: [{ legacyId: null, createdAt: null, attempts: 3 }],
          },
        ],
      },
    ])
    const wire = JSON.stringify(page)
    expect(wire).not.toContain(native)
    expect(wire).not.toContain(nativeRow)
  })

  test('reads only: the tables are unchanged after a probe', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', 1, 1)
    await seedBoard(t, ada, '2025-01-09', 2, 2)
    const snapshot = () => t.run(async (ctx) => ctx.db.query('dailyScores').collect())
    const before = await snapshot()
    await probeAll(t)
    expect(await snapshot()).toEqual(before)
  })
})

// --- impact -------------------------------------------------------------------

/** Boards by attempts. aTeam scores 1..6 as 5, 3, 2, 1, 0, -1 and a fail as -3. */
const solvedIn = (n: number) => [...Array.from({ length: n - 1 }, () => 'CRANE'), 'SPEED']
const FAILED = ['CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE']

const MONTH = '2025-01'

async function seedTeam(t: T, legacyId: number | undefined, playerIds: Id<'players'>[]) {
  return await t.run(async (ctx) =>
    ctx.db.insert('teams', aTeam({ legacyId, name: `team ${legacyId}`, playerIds })),
  )
}

/**
 * Store the month the way production holds it: recomputeTeamMonth over the rows
 * as they are, duplicates included — winner row and teamMonthStats both.
 */
async function storeMonth(t: T, teamId: Id<'teams'>, month = MONTH) {
  await t.run(async (ctx) => {
    const team = (await ctx.db.get(teamId))!
    await recomputeTeamMonth(ctx, team, month, toPuzzleDay(new Date()))
  })
}

const impact = (t: T, players: string[], offset?: number) =>
  t.query(internal.migrate.duplicateScoresImpact, { players, offset })

const snapshotAll = (t: T) =>
  t.run(async (ctx) => ({
    scores: await ctx.db.query('dailyScores').collect(),
    winners: await ctx.db.query('monthlyWinners').collect(),
    stats: await ctx.db.query('teamMonthStats').collect(),
  }))

/**
 * The flip. Ada's 2025-01-09 holds two DIFFERING rows. The earlier one (a
 * 2-guess solve, 3 points) was inserted first, so monthTotal — first row wins —
 * scores it, and Ada (3) beats Bob (a 3-guess solve, 2). The owner's rule keeps
 * the LATER row, a fail (-3), and Bob wins.
 */
async function seedFlip(t: T) {
  const ada = await seedPlayer(t, 1)
  const bob = await seedPlayer(t, 2)
  await seedBoard(t, ada, '2025-01-09', 201, 5_000, solvedIn(2))
  await seedBoard(t, ada, '2025-01-09', 202, 45_000, FAILED)
  await seedBoard(t, bob, '2025-01-10', 301, 6_000, solvedIn(3))
  const team = await seedTeam(t, 206, [ada, bob])
  await storeMonth(t, team)
  return { ada, bob, team }
}

describe('duplicateScoresImpact', () => {
  test('a duplicate that flips the winner is reported winnerChanged, with averages before and after', async () => {
    const t = convexTest(schema, modules)
    await seedFlip(t)

    expect(await impact(t, [uuid(1)])).toEqual({
      entries: [
        {
          team: 206,
          month: MONTH,
          winnerBefore: uuid(1),
          winnerAfter: uuid(2),
          // What a recompute TODAY would say with the duplicate still in place.
          // Equal to winnerBefore here, so the change is the duplicate's doing.
          winnerLive: uuid(1),
          winnerChanged: true,
          statsChanged: true,
          players: [
            // Before: 2 boards, 2 + 7 attempts. After: the fail alone.
            { player: uuid(1), boardsBefore: 2, boardsAfter: 1, avgBefore: 4.5, avgAfter: 7 },
            { player: uuid(2), boardsBefore: 1, boardsAfter: 1, avgBefore: 3, avgAfter: 3 },
          ],
        },
      ],
      missing: [],
      pairs: 1,
      nextOffset: null,
    })
  })

  test('a duplicate that does not flip the winner is not winnerChanged, but its stats are', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    const bob = await seedPlayer(t, 2)
    await seedBoard(t, ada, '2025-01-09', 201, 1_000, solvedIn(3))
    await seedBoard(t, ada, '2025-01-09', 202, 2_000, solvedIn(3))
    await seedBoard(t, ada, '2025-01-12', 203, 3_000, solvedIn(5))
    await seedBoard(t, bob, '2025-01-10', 301, 1_000, solvedIn(6))
    const team = await seedTeam(t, 206, [ada, bob])
    await storeMonth(t, team)

    const { entries } = await impact(t, [uuid(1)])
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      winnerBefore: uuid(1),
      winnerAfter: uuid(1),
      winnerChanged: false,
      statsChanged: true,
    })
    // 3 + 3 + 5 over three boards is 3.7 as displayed; 3 + 5 over two is 4.
    expect(entries[0].players[0]).toEqual({
      player: uuid(1),
      boardsBefore: 3,
      boardsAfter: 2,
      avgBefore: 3.7,
      avgAfter: 4,
    })
  })

  test('reports every team the player is on, and no team they are not on', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob } = await seedFlip(t)
    const carl = await seedPlayer(t, 3)
    const other = await seedTeam(t, 207, [bob, carl])
    const second = await seedTeam(t, 208, [ada])
    await storeMonth(t, other)
    await storeMonth(t, second)

    const { entries } = await impact(t, [uuid(1)])
    expect(entries.map((e) => e.team)).toEqual([206, 208])
  })

  test('only months holding a dropped day are reported', async () => {
    const t = convexTest(schema, modules)
    const { ada } = await seedFlip(t)
    await seedBoard(t, ada, '2025-02-03', 401, 1, solvedIn(2))

    const { entries } = await impact(t, [uuid(1)])
    expect(entries.map((e) => e.month)).toEqual([MONTH])
  })

  test("excludes a teammate's own duplicates too, so a split batch cannot under-report", async () => {
    const t = convexTest(schema, modules)
    const { bob } = await seedFlip(t)
    await seedBoard(t, bob, '2025-01-10', 302, 7_000, solvedIn(3))
    const team = (await t.run(async (ctx) => ctx.db.query('teams').first()))!._id
    await storeMonth(t, team)

    const { entries } = await impact(t, [uuid(1)])
    expect(entries[0].players[1]).toMatchObject({ boardsBefore: 2, boardsAfter: 1 })
  })

  test('with nothing stored for the month, the before side is null and stats count as changed', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', 1, 1)
    await seedBoard(t, ada, '2025-01-09', 2, 2)
    await seedTeam(t, undefined, [ada])

    const { entries } = await impact(t, [uuid(1)])
    expect(entries).toEqual([
      {
        team: 'v2-native',
        month: MONTH,
        winnerBefore: null,
        winnerAfter: uuid(1),
        winnerLive: uuid(1),
        winnerChanged: true,
        statsChanged: true,
        players: [
          { player: uuid(1), boardsBefore: null, boardsAfter: 1, avgBefore: null, avgAfter: 3 },
        ],
      },
    ])
  })

  test('every day of the month is due, so a missed day costs the team its N/A value', async () => {
    // nA of -5 makes due-ness decide it. Ada played three days for -3; Bob one
    // for +5. With every day due Ada is at -3 - 28 x 5 = -143 and Bob at
    // 5 - 30 x 5 = -145, so Ada wins; if no day were due, Bob would.
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    const bob = await seedPlayer(t, 2)
    for (const [legacyId, day] of [
      [1, '2025-01-09'],
      [2, '2025-01-09'],
      [3, '2025-01-10'],
      [4, '2025-01-11'],
    ] as const) {
      await seedBoard(t, ada, day, legacyId, legacyId, solvedIn(6))
    }
    await seedBoard(t, bob, '2025-01-09', 9, 9, solvedIn(1))
    await t.run(async (ctx) =>
      ctx.db.insert('teams', aTeam({ legacyId: 206, nA: -5, playerIds: [ada, bob] })),
    )

    const { entries } = await impact(t, [uuid(1)])
    expect(entries[0]).toMatchObject({ winnerAfter: uuid(1), winnerLive: uuid(1) })
  })

  test('stats already equal to the collapsed month are not reported changed', async () => {
    // Stored before the identical duplicate arrived, so the stored aggregate is
    // already what the repair would write.
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', 1, 1)
    const team = await seedTeam(t, 206, [ada])
    await storeMonth(t, team)
    await seedBoard(t, ada, '2025-01-09', 2, 2)

    const { entries } = await impact(t, [uuid(1)])
    expect(entries[0]).toMatchObject({ statsChanged: false, winnerChanged: false })
  })

  test('names a player it cannot find rather than skipping them silently', async () => {
    const t = convexTest(schema, modules)
    await seedFlip(t)
    const result = await impact(t, [uuid(99), uuid(1)])
    expect(result.missing).toEqual([uuid(99)])
    expect(result.entries).toHaveLength(1)
  })

  test('writes nothing', async () => {
    const t = convexTest(schema, modules)
    await seedFlip(t)
    const before = await snapshotAll(t)
    await impact(t, [uuid(1), uuid(2)])
    expect(await snapshotAll(t)).toEqual(before)
  })

  test('refuses more than five players in one call', async () => {
    const t = convexTest(schema, modules)
    await expect(impact(t, [1, 2, 3, 4, 5, 6].map(uuid))).rejects.toThrow(/at most 5 players/)
    // Five is accepted.
    await expect(impact(t, [1, 2, 3, 4, 5].map(uuid))).resolves.toMatchObject({ pairs: 0 })
  })

  test('evaluates at most eight (team, month) pairs per call and hands back where to resume', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', 1, 1)
    await seedBoard(t, ada, '2025-01-09', 2, 2)
    for (let n = 0; n < 9; n++) await seedTeam(t, 600 + n, [ada])

    const first = await impact(t, [uuid(1)])
    expect(first.pairs).toBe(9)
    expect(first.entries.map((e) => e.team)).toEqual([600, 601, 602, 603, 604, 605, 606, 607])
    expect(first.nextOffset).toBe(8)

    const second = await impact(t, [uuid(1)], 8)
    expect(second.entries.map((e) => e.team)).toEqual([608])
    expect(second.nextOffset).toBeNull()
  })
})
