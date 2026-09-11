import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import betterAuthTest from '@convex-dev/better-auth/test'
import schema from './schema'
import { api } from './_generated/api'
import { aPlayer, authenticatedAs } from './fixtures.ts'

const modules = import.meta.glob('./**/*.ts')

/**
 * The correction log.
 *
 * NOT ANALYTICS, WHICH IS WHY IT IS TESTED LIKE A FEATURE. wordle-teams-418
 * asks for a labelled corpus of real screenshots and there is no other way to
 * collect one; these rows ARE the corpus the parse's accuracy gets measured
 * against, so a row that silently fails to land is a measurement that silently
 * never happens.
 */
describe('logCorrections', () => {
  const correction = (over: Partial<Record<string, unknown>> = {}) => ({
    target: 'guess' as const,
    row: 0,
    column: 2,
    read: 'X',
    actual: 'K',
    ...over,
  })

  test('writes one row per corrected tile, against the player who confirmed', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer()))
    const asPlayer = await authenticatedAs(t, 'member@example.com')

    const result = await asPlayer.mutation(api.boardImport.logCorrections, {
      puzzleDay: '2026-09-10',
      corrections: [correction(), correction({ row: 1, column: 4, read: 'M', actual: 'W' })],
    })

    expect(result).toEqual({ logged: 2 })
    const rows = await t.run((ctx) => ctx.db.query('boardImportCorrections').collect())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      playerId,
      puzzleDay: '2026-09-10',
      target: 'guess',
      row: 0,
      column: 2,
      read: 'X',
      actual: 'K',
    })
    expect(typeof rows[0].createdAt).toBe('number')
  })

  test('records an answer correction as well as a board one', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run((ctx) => ctx.db.insert('players', aPlayer()))
    const asPlayer = await authenticatedAs(t, 'member@example.com')

    await asPlayer.mutation(api.boardImport.logCorrections, {
      puzzleDay: '2026-09-10',
      corrections: [correction({ target: 'answer', row: 0, column: 0, read: 'D', actual: 'B' })],
    })

    const rows = await t.run((ctx) => ctx.db.query('boardImportCorrections').collect())
    expect(rows[0]).toMatchObject({ target: 'answer', read: 'D', actual: 'B' })
  })

  // Absence is meaningful in BOTH directions: a tile the reader had nothing for
  // is a different failure from one it read wrongly, and a tile the player
  // cleared says the parse saw a letter that was not there.
  test('keeps an empty read and an empty actual rather than dropping them', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run((ctx) => ctx.db.insert('players', aPlayer()))
    const asPlayer = await authenticatedAs(t, 'member@example.com')

    await asPlayer.mutation(api.boardImport.logCorrections, {
      puzzleDay: '2026-09-10',
      corrections: [correction({ read: '', actual: 'S' }), correction({ column: 3, read: 'S', actual: '' })],
    })

    const rows = await t.run((ctx) => ctx.db.query('boardImportCorrections').collect())
    expect(rows.map((row) => [row.read, row.actual])).toEqual([
      ['', 'S'],
      ['S', ''],
    ])
  })

  test('stores single uppercase letters, whatever the client sent', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run((ctx) => ctx.db.insert('players', aPlayer()))
    const asPlayer = await authenticatedAs(t, 'member@example.com')

    await asPlayer.mutation(api.boardImport.logCorrections, {
      puzzleDay: '2026-09-10',
      corrections: [correction({ read: 'crane', actual: 'k' })],
    })

    const rows = await t.run((ctx) => ctx.db.query('boardImportCorrections').collect())
    expect(rows[0]).toMatchObject({ read: 'C', actual: 'K' })
  })

  // A board is 35 tiles. More than that is a client bug, and storing it would
  // put junk in the one corpus the accuracy figure is measured against.
  test('refuses to store more tiles than a board has', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run((ctx) => ctx.db.insert('players', aPlayer()))
    const asPlayer = await authenticatedAs(t, 'member@example.com')

    const result = await asPlayer.mutation(api.boardImport.logCorrections, {
      puzzleDay: '2026-09-10',
      corrections: Array.from({ length: 200 }, (_unused, i) => correction({ column: i % 5 })),
    })

    expect(result.logged).toBeLessThanOrEqual(36)
    const rows = await t.run((ctx) => ctx.db.query('boardImportCorrections').collect())
    expect(rows.length).toBeLessThanOrEqual(36)
  })

  test('writes nothing when the player changed nothing', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await t.run((ctx) => ctx.db.insert('players', aPlayer()))
    const asPlayer = await authenticatedAs(t, 'member@example.com')

    expect(
      await asPlayer.mutation(api.boardImport.logCorrections, { puzzleDay: '2026-09-10', corrections: [] }),
    ).toEqual({ logged: 0 })
    expect(await t.run((ctx) => ctx.db.query('boardImportCorrections').collect())).toHaveLength(0)
  })

  test('refuses a caller with no player', async () => {
    const t = convexTest(schema, modules)
    betterAuthTest.register(t)
    await expect(
      t.mutation(api.boardImport.logCorrections, { puzzleDay: '2026-09-10', corrections: [correction()] }),
    ).rejects.toThrow()
  })
})
