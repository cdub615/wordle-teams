import { convexTest, type TestConvex } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import { aPlayer } from './fixtures.ts'
import { duplicateScoresProbe } from './migrate'
import type { Id } from './_generated/dataModel'

// wordle-teams-rac, revision 2: the measure, impact and repair functions for
// duplicate dailyScores rows, all in migrate.ts. The rule they share is
// unit-tested in lib/duplicateScores.test.ts; these pin what each function reads,
// returns and (for the repair alone) writes.

const modules = import.meta.glob('./**/*.ts')

type T = TestConvex<typeof schema>

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
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
