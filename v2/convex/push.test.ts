import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import schema from './schema.ts'
import { aPlayer } from './fixtures.ts'
import { removeByEndpointFor, saveSubscriptionFor, subscriptionsForPlayer } from './push.ts'

const modules = import.meta.glob('./**/*.ts')

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  p256dh: 'BEl6dxjb',
  auth: 'k1JqTmFR',
}

describe('saveSubscriptionFor', () => {
  test('stores an endpoint for a player', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].endpoint).toBe(SUB.endpoint)
    expect(rows[0].playerId).toBe(playerId)
  })

  test('the same endpoint twice updates rather than duplicating', async () => {
    // A browser can hand back the same endpoint with refreshed keys — that is a
    // renewal, not a second device. Convex has no unique constraints, so this is
    // the only thing stopping one device accumulating a row per sign-in and
    // getting N copies of every notification.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, { ...SUB, p256dh: 'ROTATED' }))

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].p256dh).toBe('ROTATED')
  })

  test('two devices are two rows', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))
    await t.run(async (ctx) =>
      saveSubscriptionFor(ctx, playerId, { ...SUB, endpoint: 'https://push.example/phone' }),
    )

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(2)
  })

  test('the same endpoint under a different player migrates ownership', async () => {
    // THE CASE THE FUNCTION'S "the endpoint can migrate between accounts on a
    // shared device" comment describes: someone signs out of Alice's account
    // and into Bob's on the same browser profile without ever unsubscribing,
    // so the push service hands back the SAME endpoint under a new playerId.
    // Nothing before this test checked which player ends up owning the row —
    // only that there is exactly one row — so a patch that dropped `playerId`
    // and only refreshed the keys would pass every other test here.
    const t = convexTest(schema, modules)
    const alice = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    const bob = await t.run(async (ctx) =>
      ctx.db.insert('players', aPlayer({ email: 'bob@example.com' })),
    )
    await t.run(async (ctx) => saveSubscriptionFor(ctx, alice, SUB))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, bob, SUB))

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].playerId).toBe(bob)
  })
})

describe('subscriptionsForPlayer', () => {
  test("returns only that player's", async () => {
    const t = convexTest(schema, modules)
    const mine = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    const theirs = await t.run(async (ctx) =>
      ctx.db.insert('players', aPlayer({ email: 'other@example.com' })),
    )
    await t.run(async (ctx) => saveSubscriptionFor(ctx, mine, SUB))
    await t.run(async (ctx) =>
      saveSubscriptionFor(ctx, theirs, { ...SUB, endpoint: 'https://push.example/theirs' }),
    )

    const rows = await t.run(async (ctx) => subscriptionsForPlayer(ctx, mine))
    expect(rows).toHaveLength(1)
    expect(rows[0].endpoint).toBe(SUB.endpoint)
  })
})

describe('removeByEndpointFor', () => {
  test('deletes exactly the one row', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))
    await t.run(async (ctx) =>
      saveSubscriptionFor(ctx, playerId, { ...SUB, endpoint: 'https://push.example/kept' }),
    )

    await t.run(async (ctx) => removeByEndpointFor(ctx, SUB.endpoint))

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].endpoint).toBe('https://push.example/kept')
  })

  test('removing the OTHER endpoint leaves this one alone', async () => {
    // THE SYMMETRIC CASE. The test above only ever removes SUB.endpoint,
    // which is also the FIRST row inserted — so an implementation that
    // ignores its own `endpoint` argument and deletes whatever
    // `.query('pushSubscriptions').first()` returns passes that test purely
    // by luck (it deletes the first-inserted row, which happens to be the
    // one asked for). Removing the SECOND-inserted endpoint here and
    // asserting the FIRST survives makes that luck impossible: an
    // endpoint-blind lookup fails one of these two tests no matter which
    // fixture order it happens to match.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))
    await t.run(async (ctx) =>
      saveSubscriptionFor(ctx, playerId, { ...SUB, endpoint: 'https://push.example/kept' }),
    )

    await t.run(async (ctx) => removeByEndpointFor(ctx, 'https://push.example/kept'))

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].endpoint).toBe(SUB.endpoint)
  })

  test('removing an endpoint that is not there is not an error', async () => {
    // The 410 path can race a sign-out that already removed the row. A throw
    // here would turn a successful cleanup into a failed action.
    const t = convexTest(schema, modules)
    await expect(
      t.run(async (ctx) => removeByEndpointFor(ctx, 'https://push.example/ghost')),
    ).resolves.not.toThrow()
  })
})
