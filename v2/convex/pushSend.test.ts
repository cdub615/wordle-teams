import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import webpush from 'web-push'
import schema from './schema.ts'
import { internal } from './_generated/api'
import { aPlayer } from './fixtures.ts'

const modules = import.meta.glob('./**/*.ts')

// `web-push` signs a real VAPID JWT and does real AES128GCM encryption, both
// of which need Node crypto this vitest environment (`edge-runtime`, per
// vitest.config.ts) does not have. Mocking the module — rather than skipping
// this file — is what spike S2 and the coordinator's review both point at:
// `deliverTo`'s actual decision logic (which branch runs, what gets logged,
// whether a retry is scheduled) has nothing to do with real cryptography, and
// mocking `sendNotification`/`setVapidDetails` is enough to drive all of it.
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}))

const sendNotification = vi.mocked(webpush.sendNotification)
const setVapidDetails = vi.mocked(webpush.setVapidDetails)

// A capability URL, not a real one — this repository is public. Distinctive
// enough that if it turns up anywhere in a logged call, that's the leak.
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/do-not-leak-me'
const SUB = { endpoint: ENDPOINT, p256dh: 'BEl6dxjb', auth: 'k1JqTmFR' }

// A minimal, valid `SendResult` — the shape `sendNotification` resolves with
// on a 2xx. The delivery loop never reads it, so the specific values don't
// matter; only that it type-checks as a real result.
const SEND_OK = { statusCode: 201, body: '', headers: {} }

const VAPID_ENV = {
  VAPID_SUBJECT: 'mailto:ops@example.com',
  VAPID_PUBLIC_KEY: 'public-key-stand-in',
  VAPID_PRIVATE_KEY: 'private-key-stand-in',
}

/** The own-enumerable shape a real `WebPushError` presents — see pushErrors.test.ts. */
function webPushError(statusCode: number) {
  return Object.assign(new Error('Received unexpected response code'), {
    name: 'WebPushError',
    statusCode,
    headers: { 'content-type': 'text/plain' },
    body: 'oops',
    endpoint: ENDPOINT,
  })
}

async function seed(t: ReturnType<typeof convexTest>) {
  const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))
  await t.run(async (ctx) => ctx.db.insert('pushSubscriptions', { playerId, ...SUB }))
  return playerId
}

describe('deliverTo', () => {
  beforeEach(() => {
    sendNotification.mockReset()
    setVapidDetails.mockReset()
    for (const [key, value] of Object.entries(VAPID_ENV)) process.env[key] = value
  })

  afterEach(() => {
    for (const key of Object.keys(VAPID_ENV)) delete process.env[key]
    vi.useRealTimers()
  })

  // THE ONE THAT MATTERS MOST. A regression here is invisible to
  // pushErrors.test.ts, which only tests the helper in isolation — the actual
  // defect the coordinator caught was at THIS call site, passing the raw
  // error alongside the helper's output rather than instead of it.
  test('a delivery failure is logged through safePushErrorLog, never the raw error', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t)
    sendNotification.mockRejectedValueOnce(webPushError(500))

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // attempt: 1 so this failure schedules no retry, keeping this test about
    // logging alone.
    await t.action(internal.pushSend.deliverTo, { playerId, attempt: 1 })

    const logged = spy.mock.calls.map((call) => JSON.stringify(call)).join('\n')
    expect(logged).not.toContain(ENDPOINT)
    expect(logged).toContain('500')
    spy.mockRestore()
  })

  test('404 removes the subscription row and schedules no retry', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t)
    sendNotification.mockRejectedValueOnce(webPushError(404))

    vi.useFakeTimers()
    await t.action(internal.pushSend.deliverTo, { playerId, attempt: 0 })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(0)
    // Exactly one call: if a retry had been scheduled despite the 404/410
    // branch's `continue`, this would be 2.
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  test('410 removes the subscription row and schedules no retry', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t)
    sendNotification.mockRejectedValueOnce(webPushError(410))

    vi.useFakeTimers()
    await t.action(internal.pushSend.deliverTo, { playerId, attempt: 0 })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const rows = await t.run(async (ctx) => ctx.db.query('pushSubscriptions').collect())
    expect(rows).toHaveLength(0)
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  test('a retryable failure on attempt 0 schedules exactly one retry, which is delivered', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t)
    // First call (attempt 0) fails with a retryable status; the scheduled
    // retry (attempt 1) succeeds.
    sendNotification.mockRejectedValueOnce(webPushError(500)).mockResolvedValueOnce(SEND_OK)

    vi.useFakeTimers()
    await t.action(internal.pushSend.deliverTo, { playerId, attempt: 0 })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    // The retry actually ran and called sendNotification a second time — not
    // just "something got scheduled", but that the scheduled call reached
    // this same delivery path again.
    expect(sendNotification).toHaveBeenCalledTimes(2)
  })

  test('a retryable failure on attempt 1 schedules no further retry', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t)
    sendNotification.mockRejectedValue(webPushError(500))

    vi.useFakeTimers()
    await t.action(internal.pushSend.deliverTo, { playerId, attempt: 1 })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    // If the attempt===0 bound were missing or wrong, this would keep
    // rescheduling itself and the count would be >1 even after draining every
    // scheduled function once.
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  test('no registered subscriptions is a no-op', async () => {
    const t = convexTest(schema, modules)
    const playerId = await t.run(async (ctx) => ctx.db.insert('players', aPlayer()))

    await t.action(internal.pushSend.deliverTo, { playerId, attempt: 0 })

    expect(sendNotification).not.toHaveBeenCalled()
    expect(setVapidDetails).toHaveBeenCalled()
  })

  test('missing VAPID config logs and returns without sending or scheduling', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t)
    delete process.env.VAPID_PRIVATE_KEY

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    await t.action(internal.pushSend.deliverTo, { playerId, attempt: 0 })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect(sendNotification).not.toHaveBeenCalled()
    expect(setVapidDetails).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith(
      '[reminders] VAPID is not configured on this deployment',
      expect.objectContaining({ hasPrivateKey: false }),
    )
    spy.mockRestore()
  })

  // ITEM H'S FIX: a PRESENT but malformed VAPID value throws synchronously out
  // of setVapidDetails, before any subscription is touched. This must land in
  // the same misconfiguration branch as the absent-vars case above — logged,
  // not thrown, and no retry scheduled, because a bad value stays bad.
  test('a malformed VAPID value logs the misconfiguration and does not retry', async () => {
    const t = convexTest(schema, modules)
    const playerId = await seed(t)
    setVapidDetails.mockImplementationOnce(() => {
      throw new Error('Vapid private key should be 32 bytes long when decoded.')
    })

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    await t.action(internal.pushSend.deliverTo, { playerId, attempt: 0 })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect(sendNotification).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith(
      '[reminders] VAPID is configured but invalid on this deployment',
      { statusCode: undefined, message: 'Vapid private key should be 32 bytes long when decoded.' },
    )
    spy.mockRestore()
  })
})
