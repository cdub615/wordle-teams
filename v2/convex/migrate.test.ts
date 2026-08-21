import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema'
import { internal } from './_generated/api'

const modules = import.meta.glob('./**/*.ts')

describe('upsertPlayers', () => {
  // THE BEHAVIOUR is what is pinned here: the copy cannot put a nameless player
  // into Convex. Not WHICH LAYER refuses it.
  //
  // That distinction is deliberate and was measured. playerInput narrows
  // firstName/lastName to v.string() as a second gate behind
  // copy-from-supabase.mjs's selectCopyable — but widening either one back to
  // v.optional leaves these tests green, because the schema then rejects the same
  // row from inside the handler with the identical error name, the identical
  // message, and the same empty table (a throwing mutation writes nothing either
  // way). They are equivalent mutants, and an assertion dressed up to look like it
  // caught the difference would be a lie about what the suite knows: a real
  // property that this harness cannot observe.
  //
  // legacyId is the exception, and is pinned separately below — the schema made it
  // OPTIONAL in Phase 4, so there the validator is the only thing refusing.
  const aRow = (over: Record<string, unknown> = {}) => ({
    legacyId: '22222222-2222-4222-8222-222222222222',
    email: 'copied@a.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    hasPwa: false,
    reminderDeliveryMethods: ['email'],
    reminderDeliveryTime: '18:00:00',
    ...over,
  })

  test('accepts a fully named row', async () => {
    const t = convexTest(schema, modules)
    expect(await t.mutation(internal.migrate.upsertPlayers, { rows: [aRow()] as never })).toEqual({
      inserted: 1,
      updated: 0,
    })
  })

  for (const field of ['firstName', 'lastName'] as const) {
    test(`refuses a row with no ${field}, and writes nothing`, async () => {
      const t = convexTest(schema, modules)
      await expect(
        t.mutation(internal.migrate.upsertPlayers, {
          rows: [aRow({ [field]: undefined })] as never,
        }),
      ).rejects.toThrow()

      // The batch is refused as a whole. Worth asserting even though a throwing
      // Convex mutation rolls back by definition — this is the property the copy
      // depends on when it sends 200 rows at a time, and it should fail here if
      // the batching is ever rewritten into something that commits per row.
      await t.run(async (ctx) => {
        expect(await ctx.db.query('players').collect()).toEqual([])
      })
    })
  }

  test('still requires legacyId, which the table itself no longer does', async () => {
    // Everything arriving here came out of Supabase, so it has a primary key —
    // and byLegacyId is the whole upsert key, so a row without one could only
    // insert a duplicate. The schema is deliberately wider than this validator.
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(internal.migrate.upsertPlayers, {
        rows: [aRow({ legacyId: undefined })] as never,
      }),
    ).rejects.toThrow()
  })
})
