import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'
import { aPlayer } from './fixtures.ts'
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
