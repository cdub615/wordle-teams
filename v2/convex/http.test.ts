import { convexTest } from 'convex-test'
import { Webhook } from 'standardwebhooks'
import { afterEach, beforeEach, expect, test } from 'vitest'
import schema from './schema'
import { aPlayer, aTeam } from './fixtures.ts'

/**
 * The Polar webhook endpoint, driven end to end through `t.fetch`.
 *
 * THE STATUS CODE IS THE PROTOCOL (see convex/http.ts), so it is the thing
 * worth pinning: every row of that table is a promise to Polar about whether to
 * redeliver, and getting one wrong is silent — a 202 that should have been a
 * 500 discards an upgrade with no audit row and no error anywhere.
 *
 * REAL SIGNATURES, NOT A STUB. Each request below is signed the way Polar signs
 * it, through the same `standardwebhooks` the handler verifies with, so the 403
 * case fails for the reason a forged delivery would rather than because a mock
 * said so. `@polar-sh/sdk`'s `validateEvent` is deliberately not used here for
 * the same reason it is not used in the handler: it cannot run on Convex's
 * default runtime (`ReferenceError: Buffer is not defined`). Note that this
 * suite would NOT have caught that — vitest's edge-runtime environment defines
 * Buffer — which is why the endpoint was also exercised against a live local
 * backend.
 *
 * NOT A SUBSTITUTE FOR THE SANDBOX PASS in Task 13 (wordle-teams-02c): nothing
 * here proves what Polar actually sends, only what this endpoint does with what
 * it is given.
 */

const modules = import.meta.glob('./**/*.ts')

const SECRET = 'test_webhook_secret_not_a_real_one'
const WEBHOOK_ID = 'msg_2KWPBgLlAfxdpx2AI54pPJ85f4W'

/**
 * The env the handler reads, set per test rather than in vitest.config.ts.
 *
 * The missing-secret case has to see it ABSENT, and POLAR_ACCESS_TOKEN has to
 * stay absent throughout — that absence is what makes the checkout fallback
 * fail for real below, with no stub anywhere.
 */
let savedSecret: string | undefined

beforeEach(() => {
  savedSecret = process.env.POLAR_WEBHOOK_SECRET
  process.env.POLAR_WEBHOOK_SECRET = SECRET
})

afterEach(() => {
  if (savedSecret === undefined) delete process.env.POLAR_WEBHOOK_SECRET
  else process.env.POLAR_WEBHOOK_SECRET = savedSecret
})

// The wire shape: snake_case, because that is what Polar sends and what the
// handler passes to extractIdentityCandidates untouched.
const aBody = (data: Record<string, unknown> = {}, type = 'subscription.active') =>
  JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    data: { id: 'sub_1', customer_id: 'cus_1', ...data },
  })

/**
 * Signs a delivery exactly as the handler expects to receive one.
 *
 * The key is the secret's UTF-8 bytes via `format: 'raw'`, which is what
 * `@polar-sh/sdk` derives by base64-encoding the secret and letting
 * `standardwebhooks` decode it straight back.
 */
const signed = (body: string, webhookId = WEBHOOK_ID) => {
  const timestamp = new Date()
  const signature = new Webhook(new TextEncoder().encode(SECRET), { format: 'raw' }).sign(
    webhookId,
    timestamp,
    body,
  )

  return {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'webhook-signature': signature,
    },
  } satisfies RequestInit
}

const post = (t: ReturnType<typeof convexTest>, init: RequestInit) =>
  t.fetch('/polar/webhook', init)

// A deployment that cannot verify is broken, and it must say so rather than
// reject everything as a forgery — which is what would happen silently, since
// TextEncoder turns the missing value into an empty key.
test('500 when POLAR_WEBHOOK_SECRET is not set', async () => {
  delete process.env.POLAR_WEBHOOK_SECRET
  const t = convexTest(schema, modules)

  const res = await post(t, signed(aBody()))

  expect(res.status).toBe(500)
  expect(await res.text()).toBe('Webhook secret not configured')
})

// 400 rather than 403, and the ORDER is what makes that possible: standard
// webhooks folds a missing header into the same error as a bad signature, so
// the header is read first.
test('400 when the webhook-id header is missing', async () => {
  const t = convexTest(schema, modules)
  const init = signed(aBody())

  const res = await post(t, {
    ...init,
    headers: { 'content-type': 'application/json' },
  })

  expect(res.status).toBe(400)
  expect(await res.text()).toBe('Missing webhook-id')
})

test('403 when the signature does not match', async () => {
  const t = convexTest(schema, modules)
  const init = signed(aBody())

  const res = await post(t, {
    ...init,
    headers: { ...init.headers, 'webhook-signature': 'v1,notthesignature' },
  })

  expect(res.status).toBe(403)
  expect(await res.text()).toBe('Invalid signature')
})

// The signature covers the exact bytes, so a body swapped after signing is not
// a malformed payload — it is somebody else's delivery.
test('403 when the body was changed after signing', async () => {
  const t = convexTest(schema, modules)
  const init = signed(aBody())

  const res = await post(t, { ...init, body: aBody({ customer_id: 'cus_2' }) })

  expect(res.status).toBe(403)
})

test('400 when a verified body carries no event type', async () => {
  const t = convexTest(schema, modules)

  const res = await post(t, signed(JSON.stringify({ data: { id: 'sub_1' } })))

  expect(res.status).toBe(400)
  expect(await res.text()).toBe('Invalid payload')
})

// The 202: every candidate was tried and named nobody. Retrying cannot help,
// and a 500 here is the endless redelivery loop over a foreign event.
test('202 when no candidate names a player', async () => {
  const t = convexTest(schema, modules)

  const res = await post(t, signed(aBody({ metadata: { player_id: 'nobody' } })))

  expect(res.status).toBe(202)
  expect(await res.text()).toBe('Accepted, no matching player')
  // And nothing was stored: there is no player to attribute a row to.
  expect(await t.run((ctx) => ctx.db.query('webhookEvents').collect())).toHaveLength(0)
})

/**
 * THE BUG THIS TEST EXISTS FOR, and it is the difference between a lost upgrade
 * and a redelivery.
 *
 * `fetchCheckoutExternalId` used to catch everything and return null, so a
 * Polar 5xx, a 429, a network blip or — as here — an unset POLAR_ACCESS_TOKEN
 * became "the checkout names nobody", which is a 202, which tells Polar NEVER to
 * redeliver. The 202 path stores no audit row either, so the delivery vanished
 * without trace. It bit exactly the shape the fallback exists for: the
 * email-matched customer carrying no external id and no usable metadata.
 *
 * NO STUB AND NO NETWORK. POLAR_ACCESS_TOKEN is unset in this suite, so
 * `assertPolarEnv` throws inside the action for real, which is precisely the
 * misconfigured-deployment case polar.ts promises will fail loudly and
 * identically everywhere.
 */
test('500, not 202, when the checkout fallback cannot be asked', async () => {
  expect(process.env.POLAR_ACCESS_TOKEN).toBeUndefined()
  const t = convexTest(schema, modules)

  const res = await post(t, signed(aBody({ checkout_id: 'ch_1' })))

  expect(res.status).toBe(500)
  expect(await res.text()).toBe('Checkout lookup failed')
})

test('200 and an upgrade when the customer external id names a player', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))

  const res = await post(t, signed(aBody({ customer: { id: 'cus_1', external_id: playerId } })))

  expect(res.status).toBe(200)
  expect(await res.text()).toBe('processed')

  await t.run(async (ctx) => {
    const membership = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first()
    expect(membership?.membershipStatus).toBe('pro')

    const rows = await ctx.db.query('webhookEvents').collect()
    expect(rows).toHaveLength(1)
    expect(rows[0].processed).toBe(true)
    expect(rows[0].webhookId).toBe(WEBHOOK_ID)
    // The whole verified delivery, as Polar sent it.
    expect((rows[0].body as { type: string }).type).toBe('subscription.active')
  })
})

// Identity's second candidate, which is the v1 silent-202 shape: the customer
// Polar matched by email carries no external id, and only the metadata we set
// on the checkout ourselves names the player.
test('200 and an upgrade from the checkout metadata alone', async () => {
  const t = convexTest(schema, modules)
  const { playerId, teamId } = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert(
      'players',
      aPlayer({ legacyId: undefined, email: 'ada@example.com' }),
    )
    const teamId = await ctx.db.insert(
      'teams',
      aTeam({ legacyId: 300, invited: ['ada@example.com'] }),
    )
    return { playerId, teamId }
  })

  const res = await post(
    t,
    signed(
      aBody({ customer: { id: 'cus_1', external_id: null }, metadata: { player_id: playerId } }),
    ),
  )

  expect(res.status).toBe(200)
  // The effect ran too, not just the status change.
  await t.run(async (ctx) => {
    expect((await ctx.db.get(teamId))!.playerIds).toContain(playerId)
  })
})

// The v1 uuid namespace, arriving on the customer, resolved through
// by_legacyId. After cutover this is every migrated subscriber's renewal.
test('200 when the customer carries a v1 uuid', async () => {
  const uuid = '11111111-1111-4111-8111-111111111111'
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: uuid })))

  const res = await post(t, signed(aBody({ customer: { id: 'cus_1', external_id: uuid } })))

  expect(res.status).toBe(200)
  expect(
    await t.run(async (ctx) =>
      (
        await ctx.db
          .query('playerMembership')
          .withIndex('by_player', (q) => q.eq('playerId', playerId))
          .first()
      )?.membershipStatus,
    ),
  ).toBe('pro')
})

// ACCEPTANCE CRITERION 3 AT THE HTTP LEVEL: the redelivery is answered 2xx and
// changes nothing. The membership is flipped behind the endpoint's back between
// the two deliveries, so a handler that reprocessed would be caught rather than
// merely believed.
test('a redelivery of the same webhook-id is 200 and reprocesses nothing', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))
  const body = aBody({ customer: { id: 'cus_1', external_id: playerId } })

  expect((await post(t, signed(body))).status).toBe(200)

  await t.run(async (ctx) => {
    const row = (await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first())!
    await ctx.db.patch(row._id, { membershipStatus: 'free' })
  })

  const second = await post(t, signed(body))
  expect(second.status).toBe(200)
  expect(await second.text()).toBe('duplicate')

  await t.run(async (ctx) => {
    const row = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first()
    expect(row!.membershipStatus).toBe('free')
    expect(await ctx.db.query('webhookEvents').collect()).toHaveLength(1)
  })
})

// A DIFFERENT delivery id for the same subscription is not a replay: Polar
// reuses the id only for redeliveries of one event, so this is a second event
// and must be applied.
test('a different webhook-id for the same subscription is processed again', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run((ctx) => ctx.db.insert('players', aPlayer({ legacyId: undefined })))
  const body = aBody({ customer: { id: 'cus_1', external_id: playerId } })

  await post(t, signed(body, 'msg_first'))
  const second = await post(t, signed(body, 'msg_second'))

  expect(second.status).toBe(200)
  expect(await second.text()).toBe('processed')
  expect(await t.run((ctx) => ctx.db.query('webhookEvents').collect())).toHaveLength(2)
})

// Recognised, deliberately inert, and still stored: the customer keeps paid
// access until the period they bought runs out.
test('a canceled event is 200, stored, and changes no membership', async () => {
  const t = convexTest(schema, modules)
  const playerId = await t.run(async (ctx) => {
    const playerId = await ctx.db.insert('players', aPlayer({ legacyId: undefined }))
    await ctx.db.insert('playerMembership', { playerId, membershipStatus: 'pro' })
    return playerId
  })

  const res = await post(
    t,
    signed(
      aBody({ customer: { id: 'cus_1', external_id: playerId } }, 'subscription.canceled'),
    ),
  )

  expect(res.status).toBe(200)
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query('playerMembership')
      .withIndex('by_player', (q) => q.eq('playerId', playerId))
      .first()
    expect(row!.membershipStatus).toBe('pro')
    expect(await ctx.db.query('webhookEvents').collect()).toHaveLength(1)
  })
})
