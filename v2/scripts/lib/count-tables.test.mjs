import { describe, expect, test } from 'vitest'
import { COUNTED_TABLES, readCounts } from './count-tables.mjs'

// The cross-transaction count, pinned. readCounts is the only thing standing
// between internal.migrate.countTable's one-page-at-a-time contract and the
// numbers the Phase 7 parity audit compares against Supabase, so the properties
// asserted here are the ones whose absence would produce a WRONG count rather
// than a missing one: the accumulator, the cursor threading, and the isDone
// stop. A count that is silently short is worse than a verifier that crashes.
//
// Driven by a fake client rather than a deployment — the same reason the rest of
// scripts/lib has tests and the scripts themselves do not.

// The generated `internal` object, standing in for convex/_generated/api.js.
// readCounts only ever reaches for internal.migrate.countTable, so this is the
// whole surface it touches.
const internal = { migrate: { countTable: Symbol('internal.migrate.countTable') } }

/**
 * A client whose countTable serves `tables[name]` in pages of `pageSize`,
 * recording every request it was given.
 *
 * The cursor it hands back is an OPAQUE STRING, exactly as Convex's is — the
 * fake refuses to interpret an offset the caller made up, so a loop that
 * fabricated its own cursor would read from the wrong place rather than quietly
 * work.
 */
const fakeClient = (tables, pageSize = 2) => {
  const requests = []
  const cursorFor = (table, offset) => `cursor:${table}:${offset}`
  return {
    requests,
    async query(fn, args) {
      expect(fn).toBe(internal.migrate.countTable)
      requests.push(args)
      const rows = tables[args.table]
      if (rows === undefined) throw new Error(`no such table ${args.table}`)
      let offset = 0
      if (args.cursor !== null) {
        const match = /^cursor:(.*):(\d+)$/.exec(args.cursor)
        if (!match || match[1] !== args.table) {
          throw new Error(`countTable was handed a cursor it did not issue: ${args.cursor}`)
        }
        offset = Number(match[2])
      }
      const next = Math.min(offset + pageSize, rows)
      return {
        count: next - offset,
        cursor: cursorFor(args.table, next),
        isDone: next >= rows,
      }
    },
  }
}

const allTables = (overrides = {}) =>
  Object.fromEntries(COUNTED_TABLES.map((t) => [t, overrides[t] ?? 0]))

describe('readCounts', () => {
  test('sums a table that spans several pages', async () => {
    // Five rows in pages of two: 2 + 2 + 1. The accumulator has to add, not
    // assign — assigning gives the LAST page, which is 1 and looks plausible.
    const client = fakeClient(allTables({ dailyScores: 5 }))
    const counts = await readCounts(client, internal)
    expect(counts.dailyScores).toBe(5)
    expect(client.requests.filter((r) => r.table === 'dailyScores')).toHaveLength(3)
  })

  test("each request carries the previous page's cursor, starting from null", async () => {
    const client = fakeClient(allTables({ dailyScores: 5 }))
    await readCounts(client, internal)
    expect(client.requests.filter((r) => r.table === 'dailyScores')).toEqual([
      { table: 'dailyScores', cursor: null },
      { table: 'dailyScores', cursor: 'cursor:dailyScores:2' },
      { table: 'dailyScores', cursor: 'cursor:dailyScores:4' },
    ])
  })

  test('stops on isDone rather than on a short page', async () => {
    // The page size divides the row count exactly, so the last full page is
    // followed by isDone with nothing left over. A loop that stopped on
    // `count < numItems` would be right here by accident; a loop that ignored
    // isDone would ask forever.
    const client = fakeClient(allTables({ teams: 4 }))
    const counts = await readCounts(client, internal)
    expect(counts.teams).toBe(4)
    expect(client.requests.filter((r) => r.table === 'teams')).toHaveLength(2)
  })

  test('an empty table is 0, in one request', async () => {
    const client = fakeClient(allTables())
    const counts = await readCounts(client, internal)
    expect(counts.webhookEvents).toBe(0)
    expect(client.requests.filter((r) => r.table === 'webhookEvents')).toHaveLength(1)
  })

  test('asks for all six copied tables, and returns exactly those keys', async () => {
    // The shape the three call sites consume. A missing key reads as `undefined`
    // in the verifier's row-count check and prints as a mismatch against a real
    // Supabase number, which looks like lost data rather than a broken count.
    const client = fakeClient(
      allTables({
        players: 19,
        teams: 7,
        dailyScores: 6951,
        monthlyWinners: 62,
        playerMembership: 18,
        webhookEvents: 79,
      }),
      1000,
    )
    const counts = await readCounts(client, internal)
    expect(counts).toEqual({
      players: 19,
      teams: 7,
      dailyScores: 6951,
      monthlyWinners: 62,
      playerMembership: 18,
      webhookEvents: 79,
    })
    expect(new Set(client.requests.map((r) => r.table))).toEqual(new Set(COUNTED_TABLES))
  })

  test('gives up rather than hanging if the cursor never finishes', async () => {
    // Liveness, not size. A deployment that answered isDone false forever would
    // otherwise leave the operator watching a silent terminal at cutover.
    const client = {
      async query() {
        return { count: 0, cursor: 'stuck', isDone: false }
      },
    }
    await expect(readCounts(client, internal)).rejects.toThrow(/did not finish players/)
  })
})
