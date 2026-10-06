import { convexTest, type TestConvex } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import { aPlayer, aTeam } from './fixtures.ts'
import { recomputeTeamMonth } from './winners'
import { addDays, monthOf, toPuzzleDay } from './lib/puzzleDay.ts'
import {
  duplicateScoresImpact,
  duplicateScoresProbe,
  latestRepairableMonth,
  repairDuplicateScores,
} from './migrate'
import type { Id } from './_generated/dataModel'

// wordle-teams-rac, revision 2: the measure, impact and repair functions for
// duplicate dailyScores rows, all in migrate.ts. The rule they share is
// unit-tested in lib/duplicateScores.test.ts; these pin what each function reads,
// returns and (for the repair alone) writes.

const modules = import.meta.glob('./**/*.ts')

type T = TestConvex<typeof schema>

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MONTH = '2025-01'
const NOON = (day: string) => Date.parse(`${day}T12:00:00Z`)
const MINUTE = 60_000

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

type BoardOpts = {
  legacyId?: number | null
  createdAt?: number
  guesses?: string[]
  answer?: string
  date?: number
}

/**
 * A board as the copy wrote it. INSERTION ORDER IS INDEX ORDER for one player and
 * day, so the first board seeded for a day is the survivor. `legacyId: null`
 * writes a v2-style row with none.
 */
async function seedBoard(t: T, playerId: Id<'players'>, puzzleDay: string, opts: BoardOpts = {}) {
  const { legacyId, createdAt, guesses = ['CRANE', 'SLATE', 'SPEED'], answer = 'SPEED' } = opts
  return await t.run(async (ctx) =>
    ctx.db.insert('dailyScores', {
      playerId,
      puzzleDay,
      date: opts.date ?? NOON(puzzleDay),
      guesses,
      answer,
      ...(legacyId === null || legacyId === undefined ? {} : { legacyId }),
      ...(createdAt === undefined ? {} : { createdAt }),
    }),
  )
}

/** Boards by attempts. aTeam scores 1..6 as 5, 3, 2, 1, 0, -1 and a fail as -3. */
const solvedIn = (n: number) => [...Array.from({ length: n - 1 }, () => 'CRANE'), 'SPEED']
const FAILED = ['CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE', 'CRANE']

async function seedTeam(t: T, legacyId: number | undefined, playerIds: Id<'players'>[]) {
  return await t.run(async (ctx) =>
    ctx.db.insert('teams', aTeam({ legacyId, name: `team ${legacyId}`, playerIds })),
  )
}

/** Store the month as production holds it: winner row and teamMonthStats. */
async function storeMonth(t: T, teamId: Id<'teams'>, month = MONTH) {
  await t.run(async (ctx) => {
    const team = (await ctx.db.get(teamId))!
    await recomputeTeamMonth(ctx, team, month, toPuzzleDay(new Date()))
  })
}

const winnerRowOf = (t: T, teamId: Id<'teams'>) =>
  t.run(async (ctx) =>
    ctx.db
      .query('monthlyWinners')
      .withIndex('by_team_year_month', (q) => q.eq('teamId', teamId))
      .first(),
  )

const snapshotAll = (t: T) =>
  t.run(async (ctx) => ({
    scores: await ctx.db.query('dailyScores').collect(),
    winners: await ctx.db.query('monthlyWinners').collect(),
    stats: await ctx.db.query('teamMonthStats').collect(),
  }))

/**
 * STORED-VS-LIVE WINNER DRIFT, which the repair reports and never applies
 * (revision 3).
 * Ada's 2025-01-09 has two DIFFERING rows; the FIRST (a 2-guess solve, 3 points)
 * survives and is also the row monthTotal already scores, so live and after both
 * say Ada (3) over Bob (a 3-guess solve, 2). The stored winner row says Bob — v1
 * computed it in its own row order. The repair must leave that row exactly as it is.
 */
async function seedDrift(t: T) {
  const ada = await seedPlayer(t, 1)
  const bob = await seedPlayer(t, 2)
  await seedBoard(t, ada, '2025-01-09', { legacyId: 201, createdAt: 5_000, guesses: solvedIn(2) })
  await seedBoard(t, ada, '2025-01-09', {
    legacyId: 202,
    createdAt: 45_000,
    guesses: FAILED,
    date: NOON('2025-01-09') + 40_000,
  })
  await seedBoard(t, bob, '2025-01-10', { legacyId: 301, createdAt: 6_000, guesses: solvedIn(3) })
  const team = await seedTeam(t, 206, [ada, bob])
  await storeMonth(t, team)
  const row = (await winnerRowOf(t, team))!
  await t.run(async (ctx) => ctx.db.patch(row._id, { playerId: bob, hasSeenCelebration: [ada, bob] }))
  return { ada, bob, team }
}

// --- probe --------------------------------------------------------------------

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
  test('finds an identical pair, a differing pair and a triple, keeping the first row; ignores a clean player', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    const clean = await seedPlayer(t, 2)
    await seedBoard(t, ada, '2024-11-17', { legacyId: 101, createdAt: 1_000 })
    await seedBoard(t, ada, '2024-11-17', { legacyId: 102, createdAt: 2_000, date: NOON('2024-11-17') + 1_000 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 202, createdAt: 45_000, guesses: solvedIn(4) })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 201, createdAt: 5_000, guesses: solvedIn(2) })
    await seedBoard(t, ada, '2025-12-25', { legacyId: 301 })
    await seedBoard(t, ada, '2025-12-25', { legacyId: 303 })
    await seedBoard(t, ada, '2025-12-25', { legacyId: 302 })
    await seedBoard(t, ada, '2025-12-26', { legacyId: 401 })
    await seedBoard(t, clean, '2024-11-17', { legacyId: 501 })

    const [page] = await probeAll(t)
    expect(page.players).toBe(2)
    const row = (legacyId: number, createdAt: number | null, attempts: number) => ({
      legacyId,
      createdAt,
      answer: 'SPEED',
      attempts,
    })
    expect(page.affected).toEqual([
      {
        player: uuid(1),
        groups: [
          {
            puzzleDay: '2024-11-17',
            rows: 2,
            differing: false,
            held: [],
            dateGapSeconds: 1,
            keep: row(101, 1_000, 3),
            drop: [row(102, 2_000, 3)],
          },
          {
            // The first-inserted row survives although it is the LATER-created.
            puzzleDay: '2025-01-09',
            rows: 2,
            differing: true,
            held: [],
            dateGapSeconds: 0,
            keep: row(202, 45_000, 4),
            drop: [row(201, 5_000, 2)],
          },
          {
            puzzleDay: '2025-12-25',
            rows: 3,
            differing: false,
            held: [],
            dateGapSeconds: 0,
            keep: row(301, null, 3),
            drop: [row(303, null, 3), row(302, null, 3)],
          },
        ],
      },
    ])
  })

  test('reports a held group with its reasons: two answers, far-apart instants, a v2 row', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1, answer: 'SPEED' })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2, answer: 'CRANE', guesses: ['CRANE'] })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 3 })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 4, date: NOON('2025-01-10') + 11 * MINUTE })
    await seedBoard(t, ada, '2025-01-11', { legacyId: 5 })
    await seedBoard(t, ada, '2025-01-11', { legacyId: null })

    const [page] = await probeAll(t)
    expect(page.affected[0].groups.map((g) => [g.puzzleDay, g.held, g.dateGapSeconds])).toEqual([
      ['2025-01-09', ['answers-differ'], 0],
      ['2025-01-10', ['dates-apart'], 660],
      ['2025-01-11', ['v2-row'], 0],
    ])
    expect(page.affected[0].groups[0].drop[0].answer).toBe('CRANE')
    expect(page.affected[0].groups[2].drop[0].legacyId).toBeNull()
  })

  test('pages ten players at a time and finds duplicates on both sides of a cursor boundary', async () => {
    const t = convexTest(schema, modules)
    const ids = []
    for (let n = 1; n <= 23; n++) ids.push(await seedPlayer(t, n))
    for (const n of [1, 12, 23]) {
      await seedBoard(t, ids[n - 1], '2025-01-09', { legacyId: n * 10 })
      await seedBoard(t, ids[n - 1], '2025-01-09', { legacyId: n * 10 + 1 })
    }
    const pages = await probeAll(t)
    expect(pages.map((p) => p.players)).toEqual([10, 10, 3])
    expect(pages.map((p) => p.affected.map((a) => a.player))).toEqual([[uuid(1)], [uuid(12)], [uuid(23)]])
  })

  test('returns no email, name or document id anywhere', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1, {
      email: 'ada.secret@example.com',
      firstName: 'Adaline',
      lastName: 'Zeppelin',
    })
    const r1 = await seedBoard(t, ada, '2025-01-09', { legacyId: 1 })
    const native = await seedPlayer(t, 2, { legacyId: undefined })
    const r2 = await seedBoard(t, native, '2025-01-09', { legacyId: null })
    await seedBoard(t, native, '2025-01-09', { legacyId: 7 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2 })

    const pages = await probeAll(t)
    const wire = JSON.stringify(pages)
    expect(wire).toContain(uuid(1))
    expect(wire).toContain('"player":"v2-native"')
    for (const secret of ['ada.secret', 'example.com', 'Adaline', 'Zeppelin', ada, native, r1, r2]) {
      expect(wire).not.toContain(secret)
    }
  })

  test('is registered as an internal query, so it cannot write and nothing public can reach it', () => {
    const fn = duplicateScoresProbe as unknown as Record<string, unknown>
    expect(fn.isQuery).toBe(true)
    expect(fn.isInternal).toBe(true)
  })
})

// --- impact -------------------------------------------------------------------

const impact = (t: T, month = MONTH, after: number | null = null) =>
  t.query(internal.migrate.duplicateScoresImpact, { month, after })

describe('duplicateScoresImpact', () => {
  test('stats before and after, and stored-vs-live winner drift reported as information', async () => {
    const t = convexTest(schema, modules)
    await seedDrift(t)

    expect(await impact(t)).toEqual({
      month: MONTH,
      deletionKey: '2025-01:202',
      entries: [
        {
          team: 206,
          month: MONTH,
          rowsRemoved: 1,
          statsChanged: true,
          statsCreated: false,
          rosterDrift: false,
          players: [
            // Before: 2 + 7 attempts over 2 boards. After: the first row alone.
            { player: uuid(1), boardsBefore: 2, boardsAfter: 1, avgBefore: 4.5, avgAfter: 2 },
            { player: uuid(2), boardsBefore: 1, boardsAfter: 1, avgBefore: 3, avgAfter: 3 },
          ],
          hasWinnerRow: true,
          storedWinner: uuid(2),
          liveWinner: uuid(1),
          winnerDrift: true,
        },
      ],
      pairs: 1,
      held: 0,
      next: null,
    })
  })

  test('an identical duplicate does not change the winner, but its stats are reported changed', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    const bob = await seedPlayer(t, 2)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 201, guesses: solvedIn(3) })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 202, guesses: solvedIn(3) })
    await seedBoard(t, ada, '2025-01-12', { legacyId: 203, guesses: solvedIn(5) })
    await seedBoard(t, bob, '2025-01-10', { legacyId: 301, guesses: solvedIn(6) })
    await storeMonth(t, await seedTeam(t, 206, [ada, bob]))

    const { entries } = await impact(t)
    expect(entries[0]).toMatchObject({ storedWinner: uuid(1), liveWinner: uuid(1), winnerDrift: false, statsChanged: true })
    expect(entries[0].players[0]).toEqual({ player: uuid(1), boardsBefore: 3, boardsAfter: 2, avgBefore: 3.7, avgAfter: 4 })
  })

  test('with no winner row, no winner is reported and there is no drift', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2 })
    await seedTeam(t, undefined, [ada])

    expect((await impact(t)).entries).toEqual([
      {
        team: 'v2-native',
        month: MONTH,
        rowsRemoved: 1,
        statsChanged: true,
        statsCreated: true,
        rosterDrift: false,
        players: [{ player: uuid(1), boardsBefore: null, boardsAfter: 1, avgBefore: null, avgAfter: 3 }],
        hasWinnerRow: false,
        storedWinner: null,
        liveWinner: null,
        winnerDrift: false,
      },
    ])
  })

  test('stats already equal to the collapsed month are not reported changed', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1 })
    await storeMonth(t, await seedTeam(t, 206, [ada]))
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2 })
    expect((await impact(t)).entries[0]).toMatchObject({
      statsChanged: false,
      statsCreated: false,
      rosterDrift: false,
      rowsRemoved: 1,
      winnerDrift: false,
    })
  })

  test('rosterDrift: the stored stats were rolled up for a different roster', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    const bob = await seedPlayer(t, 2)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2 })
    const team = await seedTeam(t, 206, [ada])
    await storeMonth(t, team)
    await t.run(async (ctx) => ctx.db.patch(team, { playerIds: [ada, bob] }))
    expect((await impact(t)).entries[0]).toMatchObject({ rosterDrift: true, statsCreated: false, rowsRemoved: 1 })
  })

  test('rosterDrift also catches a reordered roster, which changes the stored document', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    const bob = await seedPlayer(t, 2)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2 })
    const team = await seedTeam(t, 206, [ada, bob])
    await storeMonth(t, team)
    await t.run(async (ctx) => ctx.db.patch(team, { playerIds: [bob, ada] }))
    expect((await impact(t)).entries[0].rosterDrift).toBe(true)
  })

  test('rowsRemoved counts every member’s deleted rows in the month, and no held ones', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    const bob = await seedPlayer(t, 2)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 3 })
    await seedBoard(t, bob, '2025-01-10', { legacyId: 4 })
    await seedBoard(t, bob, '2025-01-10', { legacyId: 5 })
    await seedBoard(t, bob, '2025-01-11', { legacyId: 6, answer: 'SPEED' })
    await seedBoard(t, bob, '2025-01-11', { legacyId: 7, answer: 'CRANE', guesses: ['CRANE'] })
    await storeMonth(t, await seedTeam(t, 206, [ada, bob]))
    expect((await impact(t)).entries[0].rowsRemoved).toBe(3)
  })

  test('reports every team the player is on and no other, including teammates’ duplicates', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob } = await seedDrift(t)
    await seedBoard(t, bob, '2025-01-10', { legacyId: 302, guesses: solvedIn(3) })
    const carl = await seedPlayer(t, 3)
    await seedTeam(t, 207, [carl])
    await seedTeam(t, 208, [ada])

    const { entries, pairs } = await impact(t)
    expect(entries.map((e) => e.team)).toEqual([206, 208])
    expect(pairs).toBe(2)
    expect(entries[0].players[1]).toMatchObject({ player: uuid(2), boardsAfter: 1 })
  })

  test('a held group deletes nothing, so it moves nothing: no pair, and it is counted as held', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1, answer: 'SPEED' })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2, answer: 'CRANE', guesses: ['CRANE'] })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 3 })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 4, date: NOON('2025-01-10') + 11 * MINUTE })
    await storeMonth(t, await seedTeam(t, 206, [ada]))

    expect(await impact(t)).toMatchObject({ entries: [], pairs: 0, held: 2 })
  })

  test('a held group beside a collapsible one stays counted in the after side', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1, answer: 'SPEED' })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2, answer: 'CRANE', guesses: ['CRANE'] })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 3 })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 4 })
    await storeMonth(t, await seedTeam(t, 206, [ada]))

    const { entries } = await impact(t)
    expect(entries[0].players[0]).toMatchObject({ boardsBefore: 4, boardsAfter: 3 })
  })

  test('every day of the month is due, so a missed day costs the team its N/A value', async () => {
    // nA -5: Ada -3 - 28 x 5 = -143 beats Bob 5 - 30 x 5 = -145; if no day were
    // due, Bob (5) would beat Ada (-3).
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    const bob = await seedPlayer(t, 2)
    for (const [legacyId, day] of [[1, '2025-01-09'], [2, '2025-01-09'], [3, '2025-01-10'], [4, '2025-01-11']] as const) {
      await seedBoard(t, ada, day, { legacyId, guesses: solvedIn(6) })
    }
    await seedBoard(t, bob, '2025-01-09', { legacyId: 9, guesses: solvedIn(1) })
    const team = await t.run(async (ctx) =>
      ctx.db.insert('teams', aTeam({ legacyId: 206, nA: -5, playerIds: [ada, bob] })),
    )
    await t.run(async (ctx) =>
      ctx.db.insert('monthlyWinners', { playerId: bob, teamId: team, year: 2025, month: 1, hasSeenCelebration: [] }),
    )
    expect((await impact(t)).entries[0]).toMatchObject({ storedWinner: uuid(2), liveWinner: uuid(1), winnerDrift: true })
  })

  test('keyset paging: eight teams a call, resumed after the last, and a team created between calls is appended', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2 })
    for (let n = 0; n < 9; n++) await seedTeam(t, 600 + n, [ada])

    const first = await impact(t)
    expect(first.pairs).toBe(9)
    expect(first.entries.map((e) => e.team)).toEqual([600, 601, 602, 603, 604, 605, 606, 607])
    expect(first.next).not.toBeNull()

    await seedTeam(t, 609, [ada])
    const second = await impact(t, MONTH, first.next)
    expect(second.entries.map((e) => e.team)).toEqual([608, 609])
    expect(second.pairs).toBe(10)
    expect(second.next).toBeNull()
  })

  test("returns the month's deletionKey on every page, the same key the repair's dry run names", async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 12 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 30 })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 9 })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 100 })
    for (let n = 0; n < 9; n++) await seedTeam(t, 600 + n, [ada])

    const first = await impact(t)
    const second = await impact(t, MONTH, first.next)
    const dry = await t.mutation(internal.migrate.repairDuplicateScores, { month: MONTH })
    expect(first.deletionKey).toBe('2025-01:30,100')
    expect(second.deletionKey).toBe(first.deletionKey)
    expect(dry.deletionKey).toBe(first.deletionKey)
  })

  test('refuses the current month, a month not yet over everywhere, and a malformed month', async () => {
    const t = convexTest(schema, modules)
    const current = monthOf(toPuzzleDay(new Date()))
    await expect(impact(t, current)).rejects.toThrow(/not a past month/)
    await expect(impact(t, '2025')).rejects.toThrow(/YYYY-MM/)
  })

  test('is registered as an internal query', () => {
    const fn = duplicateScoresImpact as unknown as Record<string, unknown>
    expect(fn.isQuery).toBe(true)
    expect(fn.isInternal).toBe(true)
  })
})

// THE PRIVACY RULE FOR THE TWO OTHER OUTPUTS, as the probe has it: legacy ids
// only — no document id of any player, team or row, no email, no name.
async function seedSecrets(t: T) {
  const ada = await seedPlayer(t, 1, { email: 'ada.secret@example.com', firstName: 'Adaline', lastName: 'Zeppelin' })
  const native = await seedPlayer(t, 2, { legacyId: undefined, email: 'nat.hidden@example.com', firstName: 'Natsuko', lastName: 'Quill' })
  const rows = [
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1 }),
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2 }),
    await seedBoard(t, native, '2025-01-10', { legacyId: 3 }),
  ]
  const copied = await seedTeam(t, 206, [ada, native])
  const nativeTeam = await seedTeam(t, undefined, [ada])
  await storeMonth(t, copied)
  const secrets = [ada, native, ...rows, copied, nativeTeam, 'ada.secret', 'nat.hidden', 'example.com', 'Adaline', 'Zeppelin', 'Natsuko', 'Quill']
  return { secrets }
}

function expectNoSecrets(output: unknown, secrets: string[]) {
  const wire = JSON.stringify(output)
  for (const secret of secrets) expect(wire).not.toContain(secret)
}

describe('privacy of impact and repair outputs', () => {
  test('impact returns no document id, email or name', async () => {
    const t = convexTest(schema, modules)
    const { secrets } = await seedSecrets(t)
    const result = await impact(t)
    expect(result.entries.map((e) => e.team)).toEqual([206, 'v2-native'])
    expect(JSON.stringify(result)).toContain('"v2-native"')
    expectNoSecrets(result, secrets)
  })

  test('repair, dry and applied, returns no document id, email or name', async () => {
    const t = convexTest(schema, modules)
    const { secrets } = await seedSecrets(t)
    const dry = await t.mutation(internal.migrate.repairDuplicateScores, { month: MONTH })
    const real = await t.mutation(internal.migrate.repairDuplicateScores, {
      month: MONTH,
      dryRun: false,
      expect: dry.deletionKey,
    })
    expect(real.groups).toHaveLength(1)
    expectNoSecrets([dry, real], secrets)
  })
})

describe('latestRepairableMonth', () => {
  test('a month is repairable from the 2nd of the next month, server time', () => {
    expect(latestRepairableMonth(new Date(2026, 10, 1, 12))).toBe('2026-09')
    expect(latestRepairableMonth(new Date(2026, 10, 2, 0, 1))).toBe('2026-10')
    expect(latestRepairableMonth(new Date(2026, 0, 2, 12))).toBe('2025-12')
    expect(latestRepairableMonth(new Date(2026, 0, 1, 12))).toBe('2025-11')
  })

  test('the current month is never repairable', () => {
    const today = toPuzzleDay(new Date())
    expect(latestRepairableMonth(new Date()) < monthOf(today)).toBe(true)
    expect(latestRepairableMonth(new Date()) <= monthOf(addDays(today, -1))).toBe(true)
  })
})

// --- repair -------------------------------------------------------------------

const repair = (t: T, extra: Record<string, unknown> = {}) =>
  t.mutation(internal.migrate.repairDuplicateScores, { month: MONTH, ...extra })

/** Dry run, then apply the plan it named. */
async function dryThenApply(t: T, month = MONTH) {
  const dry = await repair(t, { month })
  const real = await repair(t, { month, dryRun: false, expect: dry.deletionKey })
  return { dry, real }
}

const legacyIdsOf = (t: T, playerId: Id<'players'>) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query('dailyScores')
        .withIndex('by_player_and_puzzleDay', (q) => q.eq('playerId', playerId))
        .collect()
    )
      .map((row) => row.legacyId ?? null)
      .sort(),
  )

describe('repairDuplicateScores', () => {
  test('dryRun is the default: it writes nothing and names the rows an apply deletes', async () => {
    const t = convexTest(schema, modules)
    await seedDrift(t)
    const before = await snapshotAll(t)

    const dry = await repair(t)
    expect(await snapshotAll(t)).toEqual(before)
    expect(dry).toEqual({
      month: MONTH,
      dryRun: true,
      deletionKey: '2025-01:202',
      groups: [
        {
          player: uuid(1),
          puzzleDay: '2025-01-09',
          rows: 2,
          differing: true,
          held: [],
          dateGapSeconds: 40,
          keep: { legacyId: 201, createdAt: 5_000, answer: 'SPEED', attempts: 2 },
          drop: [{ legacyId: 202, createdAt: 45_000, answer: 'SPEED', attempts: 7 }],
          deleted: [{ legacyId: 202, createdAt: 45_000, answer: 'SPEED', attempts: 7 }],
        },
      ],
      teamMonths: [{ team: 206, month: MONTH }],
    })

    const real = await repair(t, { dryRun: false, expect: dry.deletionKey })
    expect({ ...real, dryRun: true }).toEqual(dry)
  })

  test('an apply deletes exactly the dropped rows, keeps the FIRST row, and rolls up the stats', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob } = await seedDrift(t)
    await seedBoard(t, ada, '2025-01-20', { legacyId: 250, guesses: solvedIn(3) })

    await dryThenApply(t)
    expect(await legacyIdsOf(t, ada)).toEqual([201, 250])
    expect(await legacyIdsOf(t, bob)).toEqual([301])
    const stats = await t.run(async (ctx) => ctx.db.query('teamMonthStats').first())
    expect(stats?.members.find((m) => m.playerId === ada)).toMatchObject({ boards: 2, attempts: 5 })
  })

  test('a held group is never deleted, for any of the three reasons', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1, answer: 'SPEED' })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2, answer: 'CRANE', guesses: ['CRANE'] })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 3 })
    await seedBoard(t, ada, '2025-01-10', { legacyId: 4, date: NOON('2025-01-10') + 11 * MINUTE })
    await seedBoard(t, ada, '2025-01-11', { legacyId: 5 })
    await seedBoard(t, ada, '2025-01-11', { legacyId: null })
    await seedBoard(t, ada, '2025-01-12', { legacyId: 6 })
    await seedBoard(t, ada, '2025-01-12', { legacyId: 7 })
    await storeMonth(t, await seedTeam(t, 206, [ada]))

    const { dry, real } = await dryThenApply(t)
    expect(dry.deletionKey).toBe('2025-01:7')
    expect(real.groups.map((g) => [g.puzzleDay, g.held, g.deleted.length])).toEqual([
      ['2025-01-09', ['answers-differ'], 0],
      ['2025-01-10', ['dates-apart'], 0],
      ['2025-01-11', ['v2-row'], 0],
      ['2025-01-12', [], 1],
    ])
    expect(await legacyIdsOf(t, ada)).toEqual([1, 2, 3, 4, 5, 6, null])
  })

  test('an apply without expect is refused, and writes nothing', async () => {
    const t = convexTest(schema, modules)
    await seedDrift(t)
    const before = await snapshotAll(t)
    await expect(repair(t, { dryRun: false })).rejects.toThrow(/needs `expect`/)
    expect(await snapshotAll(t)).toEqual(before)
  })

  test('an apply whose expect does not match the plan is refused before anything is deleted', async () => {
    const t = convexTest(schema, modules)
    const { ada } = await seedDrift(t)
    const dry = await repair(t)
    // A new duplicate lands between the dry run and the apply.
    await seedBoard(t, ada, '2025-01-15', { legacyId: 260 })
    await seedBoard(t, ada, '2025-01-15', { legacyId: 261 })
    const before = await snapshotAll(t)

    await expect(repair(t, { dryRun: false, expect: dry.deletionKey })).rejects.toThrow(
      /plan changed.*expected 2025-01:202, found 2025-01:202,261/,
    )
    expect(await snapshotAll(t)).toEqual(before)
  })

  test('re-plans from what it reads: a survivor gone since the dry run turns the drop into a lone row', async () => {
    const t = convexTest(schema, modules)
    const { ada } = await seedDrift(t)
    const dry = await repair(t)
    await t.run(async (ctx) => {
      const survivor = await ctx.db.query('dailyScores').withIndex('by_legacyId', (q) => q.eq('legacyId', 201)).unique()
      await ctx.db.delete(survivor!._id)
    })
    await expect(repair(t, { dryRun: false, expect: dry.deletionKey })).rejects.toThrow(/plan changed/)
    const fresh = await repair(t)
    expect(fresh.deletionKey).toBe('2025-01:')
    await repair(t, { dryRun: false, expect: fresh.deletionKey })
    expect(await legacyIdsOf(t, ada)).toEqual([202])
  })

  test('a second run plans nothing, deletes nothing and recomputes nothing', async () => {
    const t = convexTest(schema, modules)
    await seedDrift(t)
    await dryThenApply(t)
    const settled = await snapshotAll(t)
    const { dry, real } = await dryThenApply(t)
    expect(dry.deletionKey).toBe('2025-01:')
    expect(real).toMatchObject({ groups: [], teamMonths: [] })
    expect(await snapshotAll(t)).toEqual(settled)
  })

  test('never deletes a row of a day with one row, or of another month', async () => {
    const t = convexTest(schema, modules)
    const { ada, bob } = await seedDrift(t)
    await seedBoard(t, ada, '2025-01-01', { legacyId: 260 })
    await seedBoard(t, ada, '2025-02-09', { legacyId: 262 })
    await seedBoard(t, ada, '2025-02-09', { legacyId: 263 })
    await dryThenApply(t)
    expect(await legacyIdsOf(t, ada)).toEqual([201, 260, 262, 263])
    expect(await legacyIdsOf(t, bob)).toEqual([301])
  })

  test('rolls up each affected team ONCE, after every member’s deletes', async () => {
    const t = convexTest(schema, modules)
    const { bob } = await seedDrift(t)
    await seedBoard(t, bob, '2025-01-10', { legacyId: 302, guesses: solvedIn(3) })
    const { real } = await dryThenApply(t)
    expect(real.deletionKey).toBe('2025-01:202,302')
    expect(real.teamMonths).toEqual([{ team: 206, month: MONTH }])
  })

  test('a month with no winner row gets none; its stats are rolled up', async () => {
    const t = convexTest(schema, modules)
    const ada = await seedPlayer(t, 1)
    await seedBoard(t, ada, '2025-01-09', { legacyId: 1 })
    await seedBoard(t, ada, '2025-01-09', { legacyId: 2 })
    const team = await seedTeam(t, 206, [ada])

    const { real } = await dryThenApply(t)
    expect(real.teamMonths).toEqual([{ team: 206, month: MONTH }])
    expect(await winnerRowOf(t, team)).toBeNull()
    const stats = await t.run(async (ctx) => ctx.db.query('teamMonthStats').first())
    expect(stats?.members).toEqual([{ playerId: ada, boards: 1, attempts: 3, solved: 1, failed: 0 }])
  })

  test('rolls up only teams holding a player who lost a row', async () => {
    const t = convexTest(schema, modules)
    await seedDrift(t)
    const carl = await seedPlayer(t, 3)
    // Carl's only duplicate is HELD, so his team is not touched: it gets no
    // teamMonthStats doc, and its winner row survives.
    await seedBoard(t, carl, '2025-01-09', { legacyId: 401, answer: 'SPEED' })
    await seedBoard(t, carl, '2025-01-09', { legacyId: 402, answer: 'CRANE', guesses: ['CRANE'] })
    const carlsTeam = await seedTeam(t, 207, [carl])
    const stranger = await seedPlayer(t, 4)
    await t.run(async (ctx) =>
      ctx.db.insert('monthlyWinners', { playerId: stranger, teamId: carlsTeam, year: 2025, month: 1, hasSeenCelebration: [] }),
    )

    const { real } = await dryThenApply(t)
    expect(real.teamMonths.map((tm) => tm.team)).toEqual([206])
    expect((await winnerRowOf(t, carlsTeam))?.playerId).toBe(stranger)
    const carlsStats = await t.run(async (ctx) =>
      ctx.db
        .query('teamMonthStats')
        .withIndex('by_team_year_month', (q) => q.eq('teamId', carlsTeam))
        .first(),
    )
    expect(carlsStats).toBeNull()
  })

  test('refuses the current month and a malformed month, and writes nothing', async () => {
    const t = convexTest(schema, modules)
    await seedDrift(t)
    const before = await snapshotAll(t)
    const current = monthOf(toPuzzleDay(new Date()))
    await expect(repair(t, { month: current })).rejects.toThrow(/not a past month/)
    await expect(repair(t, { month: current, dryRun: false, expect: `${current}:` })).rejects.toThrow(
      /not a past month/,
    )
    await expect(repair(t, { month: '2025' })).rejects.toThrow(/YYYY-MM/)
    expect(await snapshotAll(t)).toEqual(before)
  })

  test('refuses to be told what to delete: a list passed in is rejected and nothing changes', async () => {
    const t = convexTest(schema, modules)
    await seedDrift(t)
    const before = await snapshotAll(t)
    await expect(repair(t, { dryRun: false, expect: '2025-01:202', drop: [301] })).rejects.toThrow()
    await expect(repair(t, { players: [uuid(2)] })).rejects.toThrow()
    expect(await snapshotAll(t)).toEqual(before)
  })

  // THE REPAIR NEVER WRITES WINNERS (revision 3). Collapsing cannot move a winner
  // (monthTotal scores the first row, which survives), and a recompute would only
  // apply unrelated drift. So a month whose stored winner disagrees with a
  // recompute today keeps its row — winner AND hasSeenCelebration — byte for byte.
  test('a month with stored-vs-live winner drift keeps monthlyWinners byte-identical; stats are rolled up', async () => {
    const t = convexTest(schema, modules)
    const { ada, team } = await seedDrift(t)
    const winnersBefore = await t.run(async (ctx) => ctx.db.query('monthlyWinners').collect())
    expect(winnersBefore).toHaveLength(1)
    expect(winnersBefore[0]).toMatchObject({ playerId: expect.any(String), hasSeenCelebration: [ada, expect.any(String)] })
    const statsBefore = await t.run(async (ctx) => ctx.db.query('teamMonthStats').first())

    const { real } = await dryThenApply(t)
    expect(real.deletionKey).toBe('2025-01:202')

    expect(await t.run(async (ctx) => ctx.db.query('monthlyWinners').collect())).toEqual(winnersBefore)
    const statsAfter = await t.run(async (ctx) => ctx.db.query('teamMonthStats').first())
    expect(statsBefore?.members.find((m) => m.playerId === ada)).toMatchObject({ boards: 2 })
    expect(statsAfter?._id).toBe(statsBefore?._id)
    expect(statsAfter?.members.find((m) => m.playerId === ada)).toMatchObject({ boards: 1, attempts: 2 })
    expect((await winnerRowOf(t, team))?.hasSeenCelebration).toHaveLength(2)
  })

  test('is registered as an internal mutation', () => {
    const fn = repairDuplicateScores as unknown as Record<string, unknown>
    expect(fn.isMutation).toBe(true)
    expect(fn.isInternal).toBe(true)
  })
})
