import { ConvexError } from 'convex/values'
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

describe('saveSubscriptionFor: endpoint validation', () => {
  test('a real https: endpoint is stored', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
  })

  // THE SSRF SURFACE. pushSend.ts hands `endpoint` straight to
  // webpush.sendNotification, which https.requests whatever host it parses
  // out — so an endpoint that is not a genuine https: URL from a browser's
  // Push API is a way to make this deployment issue a request to an
  // arbitrary host of the caller's choosing, on a daily cron.
  test.each([
    ['http:, not https:', 'http://push.example/not-secure'],
    ['not a URL at all', 'not-a-url'],
    ['empty string', ''],
  ])('rejects %s', async (_label, endpoint) => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))

    await expect(
      t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, { ...SUB, endpoint })),
    ).rejects.toThrow(ConvexError)

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(0)
  })

  // THE TYPED CODE, NOT JUST "IT THROWS". A plain Error's message is redacted
  // in production and convex-test never redacts, so a test asserting only
  // `.rejects.toThrow()` would not catch a regression to `throw new
  // Error(...)` — the exact mistake accessError exists to make impossible at
  // the call site. Matches the `.rejects.toMatchObject({ data: { code } })`
  // pattern already used throughout this codebase (e.g. scores.test.ts,
  // teams.test.ts) for the same reason.
  test('the rejection carries the INVALID_PUSH_ENDPOINT code', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))

    await expect(
      t.run(async (ctx) =>
        saveSubscriptionFor(ctx, playerId, { ...SUB, endpoint: 'http://push.example/insecure' }),
      ),
    ).rejects.toMatchObject({ data: { code: 'INVALID_PUSH_ENDPOINT' } })
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
  test('deletes exactly the one row, owned by the caller', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await t.run(async (ctx) => saveSubscriptionFor(ctx, playerId, SUB))
    await t.run(async (ctx) =>
      saveSubscriptionFor(ctx, playerId, { ...SUB, endpoint: 'https://push.example/kept' }),
    )

    await t.run(async (ctx) => removeByEndpointFor(ctx, playerId, SUB.endpoint))

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

    await t.run(async (ctx) => removeByEndpointFor(ctx, playerId, 'https://push.example/kept'))

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].endpoint).toBe(SUB.endpoint)
  })

  // THE SECURITY PROPERTY. Without the playerId check, any signed-in player
  // who obtained someone else's endpoint could remove that row — see the
  // comment on removeByEndpointFor itself for why the response has to be
  // indistinguishable from "no such endpoint" rather than a distinguishing
  // throw.
  test("removing another player's endpoint is a no-op — the row survives", async () => {
    const t = convexTest(schema, modules)
    const owner = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    const intruder = await t.run(async (ctx) =>
      ctx.db.insert('players', aPlayer({ email: 'intruder@example.com' })),
    )
    await t.run(async (ctx) => saveSubscriptionFor(ctx, owner, SUB))

    await expect(
      t.run(async (ctx) => removeByEndpointFor(ctx, intruder, SUB.endpoint)),
    ).resolves.not.toThrow()

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].playerId).toBe(owner)
  })

  test('removing an endpoint that is not there is not an error', async () => {
    // The 410 path can race a sign-out that already removed the row. A throw
    // here would turn a successful cleanup into a failed action.
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
    await expect(
      t.run(async (ctx) => removeByEndpointFor(ctx, playerId, 'https://push.example/ghost')),
    ).resolves.not.toThrow()
  })
})
