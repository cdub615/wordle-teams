import { describe, expect, test, vi } from 'vitest'
import {
  applyPushToggle,
  subscribeToPush,
  settledWithin,
  uint8ArrayToUrlBase64,
  unsubscribeFromPush,
  urlBase64ToUint8Array,
  type PushBrowser,
  type PushToggleEffects,
  type PushManagerLike,
  type PushSubscriptionLike,
} from './push-subscribe.ts'

/**
 * WHY THE ENCODING HALF IS TESTED THIS HARD. Both directions fail silently
 * when they are wrong, in different places and hours apart: a mis-decoded
 * application server key gives a 403 from the push service inside a Convex
 * action, and a mis-encoded `p256dh`/`auth` pair gives a 201 from the push
 * service and a message the browser drops undecrypted, with nothing logged
 * anywhere. There is no runtime signal for either, so these assertions are
 * the entire safety net.
 *
 * THE ROUND-TRIP ALONE IS NOT ENOUGH, which is the trap worth writing down:
 * `atob` accepts the STANDARD alphabet as well as nothing at all of base64url,
 * so `decode(encode(x)) === x` still holds if the encoder's `+`→`-` and
 * `/`→`_` substitutions are deleted outright. That mutant is caught only by
 * asserting on the STRING the encoder produces — the encoder's output is what
 * gets stored and handed to `web-push`, whose own decoder rejects `+`, `/`
 * and `=`. Hence `isUrlSafe` below, and the string-in/string-out round trip.
 */

/** Every byte value, so every base64 character — `+` and `/` included — occurs. */
const ALL_BYTES = new Uint8Array(256).map((_, index) => index)

/** What `web-push` will accept: the url-safe alphabet, unpadded. */
function isUrlSafe(value: string): boolean {
  return !/[+/=]/.test(value)
}

describe('urlBase64ToUint8Array', () => {
  test('decodes an unpadded url-safe string', () => {
    // 'YWJjZA' is 'abcd' base64url without padding — what pushManager hands back.
    expect(Array.from(urlBase64ToUint8Array('YWJjZA'))).toEqual([97, 98, 99, 100])
  })

  test('decodes an already-padded string too', () => {
    // WHAT THIS PINS IS THE OUTER `% 4`, and only that: `(4 - 0 % 4) % 4` must
    // be 0 rather than 4, because four spurious '=' make atob throw — a Push
    // switch that fails on one deployment and not another, since nothing stops
    // a hand-set VAPID_PUBLIC_KEY from carrying its padding.
    //
    // IT DOES NOT PIN THE PADDING ADDITION ITSELF, and no test here can:
    // replacing the whole `'='.repeat(...)` with `''` leaves every test in this
    // file green, because WHATWG forgiving-base64 — which is what `atob` is —
    // accepts unpadded input outright. That mutant is EQUIVALENT, not a gap,
    // and contorting an assertion to kill it would only pin the platform's
    // behaviour rather than ours. Measured 2026-08-30.
    expect(Array.from(urlBase64ToUint8Array('YWJjZA=='))).toEqual([97, 98, 99, 100])
  })

  test('translates the url-safe alphabet back', () => {
    // '-' and '_' are base64url's substitutes for '+' and '/'. A VAPID key
    // containing either decodes to the WRONG BYTES without this — no error
    // here at all; it surfaces as a 403 from the push service.
    expect(Array.from(urlBase64ToUint8Array('--__'))).toEqual([251, 239, 255])
  })

  test('a VAPID-shaped application server key decodes to 65 bytes starting 0x04', () => {
    // SHAPED LIKE an uncompressed P-256 point, and deliberately not called a
    // real one: fed to `crypto.createECDH('prime256v1').setPublicKey()` these
    // bytes are rejected — "Failed to convert Buffer to EC_POINT" — so they
    // are 65 bytes behind an 0x04 prefix but not a point on the curve.
    // Verified 2026-08-30. That is fine, because the assertion is about SHAPE:
    // pushManager rejects a key of any other length with an opaque error, and
    // the length is what this pins. Do not try this value against a real push
    // service.
    const key =
      'BEl6dxjbRhIu1yTPy0iBk7-5eXVc4RRTVEnJcO3vBBUvSHhVJfKvXFB0Q0Mv8G7lQ0d5r6ThPNmQ0lYqTmFRPjA'
    const bytes = urlBase64ToUint8Array(key)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(0x04)
  })
})

describe('uint8ArrayToUrlBase64', () => {
  test('emits the url-safe alphabet, unpadded, over every byte value', () => {
    // THE ASSERTION THE ROUND-TRIP CANNOT MAKE. Delete either substitution or
    // the '=' strip and this fails; the byte round-trip below stays green,
    // because atob reads the standard alphabet perfectly well. What breaks in
    // production is `web-push`'s decoder, hours later, silently.
    const encoded = uint8ArrayToUrlBase64(ALL_BYTES)
    expect(isUrlSafe(encoded)).toBe(true)
    // 256 bytes is 1 mod 3, so unstripped base64 would end '=='.
    expect(encoded.endsWith('=')).toBe(false)
    expect(encoded.length).toBe(342)
  })

  test.each([1, 2, 16, 65])('strips padding for a %i-byte input', (length) => {
    // ONLY LENGTHS THAT ACTUALLY PAD. 1 and 2 mod 3 are the only ones that do,
    // so a 3-byte case would pass under a mutant that keeps the padding and
    // would be pinning nothing. 16 (the `auth` secret) and 65 (the `p256dh`
    // point) are the two this app really encodes, landing on 1 and 2.
    const encoded = uint8ArrayToUrlBase64(ALL_BYTES.slice(0, length))
    expect(isUrlSafe(encoded)).toBe(true)
  })
})

describe('the two are inverses', () => {
  test('bytes survive a round trip, including a 65-byte key and a 16-byte auth secret', () => {
    for (const bytes of [ALL_BYTES, ALL_BYTES.slice(0, 65), ALL_BYTES.slice(0, 16)]) {
      expect(Array.from(urlBase64ToUint8Array(uint8ArrayToUrlBase64(bytes)))).toEqual(
        Array.from(bytes),
      )
    }
  })

  test('a base64url STRING survives a round trip unchanged', () => {
    // The other direction, and the one that pins the encoder's alphabet: this
    // input contains both '-' and '_' and carries no padding, so any dropped
    // substitution or a reinstated '=' changes the string.
    const key =
      'BEl6dxjbRhIu1yTPy0iBk7-5eXVc4RRTVEnJcO3vBBUvSHhVJfKvXFB0Q0Mv8G7lQ0d5r6ThPNmQ0lYqTmFRPjA'
    expect(uint8ArrayToUrlBase64(urlBase64ToUint8Array(key))).toBe(key)

    const withBothSubstitutes = uint8ArrayToUrlBase64(ALL_BYTES)
    expect(withBothSubstitutes).toContain('-')
    expect(withBothSubstitutes).toContain('_')
    expect(uint8ArrayToUrlBase64(urlBase64ToUint8Array(withBothSubstitutes))).toBe(
      withBothSubstitutes,
    )
  })
})

/**
 * A `PushSubscription` stand-in. `getKey` is driven per test — including with
 * `null`, which is what the real type says and what the code must not assert
 * away.
 */
function fakeSubscription({
  endpoint = 'https://fcm.googleapis.com/fcm/send/abc123',
  p256dh = ALL_BYTES.slice(0, 65),
  auth = ALL_BYTES.slice(100, 116),
  unsubscribe = vi.fn().mockResolvedValue(true),
}: {
  endpoint?: string
  p256dh?: Uint8Array | null
  auth?: Uint8Array | null
  unsubscribe?: () => Promise<boolean>
} = {}): PushSubscriptionLike & { unsubscribe: () => Promise<boolean> } {
  return {
    endpoint,
    getKey: (name) => {
      const bytes = name === 'p256dh' ? p256dh : auth
      // A REAL ArrayBuffer, not the Uint8Array — `getKey` returns the buffer,
      // and `new Uint8Array(buffer)` in the module under test is what turns it
      // back into bytes. Handing over the view here would hide a missing
      // conversion.
      return bytes === null ? null : (bytes.slice().buffer as ArrayBuffer)
    },
    unsubscribe,
  }
}

function fakeBrowser({
  permission = 'granted',
  pushManager,
}: {
  permission?: string
  pushManager?: PushManagerLike | null
}): PushBrowser {
  return {
    requestPermission: vi.fn().mockResolvedValue(permission),
    pushManager: vi.fn().mockResolvedValue(pushManager === undefined ? null : pushManager),
  }
}

describe('subscribeToPush', () => {
  const KEY = 'BEl6dxjbRhIu1yTPy0iBk7-5eXVc4RRTVEnJcO3vBBUvSHhVJfKvXFB0Q0Mv8G7lQ0d5r6ThPNmQ0lYqTmFRPjA'

  test('subscribes and returns the three fields savePushSubscription stores', async () => {
    const subscription = fakeSubscription()
    const subscribe = vi.fn().mockResolvedValue(subscription)
    const browser = fakeBrowser({ pushManager: { getSubscription: vi.fn(), subscribe } })

    const result = await subscribeToPush(browser, KEY)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.subscription.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc123')
    // The stored strings must be exactly what the encoder produces from the
    // ArrayBuffers — this is the pair whose mis-encoding fails silently.
    expect(result.subscription.p256dh).toBe(uint8ArrayToUrlBase64(ALL_BYTES.slice(0, 65)))
    expect(result.subscription.auth).toBe(uint8ArrayToUrlBase64(ALL_BYTES.slice(100, 116)))
    expect(isUrlSafe(result.subscription.p256dh)).toBe(true)
    expect(isUrlSafe(result.subscription.auth)).toBe(true)

    // `userVisibleOnly` is not optional in Chromium, and the key must arrive
    // as the DECODED 65 bytes rather than the base64url string.
    const options = subscribe.mock.calls[0][0]
    expect(options.userVisibleOnly).toBe(true)
    expect(Array.from(options.applicationServerKey as Uint8Array)).toEqual(
      Array.from(urlBase64ToUint8Array(KEY)),
    )
    expect((options.applicationServerKey as Uint8Array).length).toBe(65)
  })

  test('a REFUSED permission never reaches pushManager', async () => {
    const browser = fakeBrowser({ permission: 'denied', pushManager: null })
    await expect(subscribeToPush(browser, KEY)).resolves.toEqual({ ok: false, reason: 'denied' })
    expect(browser.pushManager).not.toHaveBeenCalled()
  })

  test("a DISMISSED prompt ('default') is treated exactly like a refusal", async () => {
    // The mutant this catches is `permission === 'denied'` in place of
    // `!== 'granted'`. 'default' is what closing the prompt leaves behind, and
    // it delivers precisely as much as a refusal does — so writing 'push' on
    // the strength of it would store a method the browser never honours.
    const browser = fakeBrowser({ permission: 'default', pushManager: null })
    await expect(subscribeToPush(browser, KEY)).resolves.toEqual({ ok: false, reason: 'denied' })
    expect(browser.pushManager).not.toHaveBeenCalled()
  })

  test('no push manager reports unavailable rather than throwing', async () => {
    // A service worker that never became ready — `settledWithin` timed out.
    // NOT iOS Safari below 16.4, which is the browser it is tempting to name
    // here: that one has no `window.Notification` either, so `browserPush`
    // returns null before a PushBrowser is ever built. See its comment.
    const browser = fakeBrowser({ pushManager: null })
    await expect(subscribeToPush(browser, KEY)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
  })

  test('a rejected subscribe() PROPAGATES, so no caller can mistake it for success', async () => {
    const browser = fakeBrowser({
      pushManager: {
        getSubscription: vi.fn(),
        subscribe: vi.fn().mockRejectedValue(new Error('Registration failed - push service error')),
      },
    })
    await expect(subscribeToPush(browser, KEY)).rejects.toThrow('push service error')
  })

  test.each(['p256dh', 'auth'] as const)(
    'a subscription whose %s key is null is reported, not stored',
    async (missing) => {
      // `getKey` IS TYPED `ArrayBuffer | null`. Storing a keyless subscription
      // is the silent-failure case: the push service answers 201 and the
      // browser drops every message, forever, with nothing logged.
      const unsubscribe = vi.fn().mockResolvedValue(true)
      const subscription = fakeSubscription({
        p256dh: missing === 'p256dh' ? null : undefined,
        auth: missing === 'auth' ? null : undefined,
        unsubscribe,
      })
      const browser = fakeBrowser({
        pushManager: { getSubscription: vi.fn(), subscribe: vi.fn().mockResolvedValue(subscription) },
      })

      await expect(subscribeToPush(browser, KEY)).resolves.toEqual({
        ok: false,
        reason: 'no-keys',
      })
      // And the useless subscription is dropped, so a retry gets a fresh one.
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    },
  )

  test('a keyless subscription whose unsubscribe() also fails still reports no-keys', async () => {
    const subscription = fakeSubscription({
      p256dh: null,
      unsubscribe: vi.fn().mockRejectedValue(new Error('not permitted')),
    })
    const browser = fakeBrowser({
      pushManager: { getSubscription: vi.fn(), subscribe: vi.fn().mockResolvedValue(subscription) },
    })

    await expect(subscribeToPush(browser, KEY)).resolves.toEqual({ ok: false, reason: 'no-keys' })
  })
})

describe('unsubscribeFromPush', () => {
  test('unsubscribes and reports the endpoint the stored row is keyed by', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const subscription = fakeSubscription({ endpoint: 'https://push.example/xyz', unsubscribe })
    const browser = fakeBrowser({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(subscription),
        subscribe: vi.fn(),
      },
    })

    await expect(unsubscribeFromPush(browser)).resolves.toEqual({
      endpoint: 'https://push.example/xyz',
      unsubscribeError: null,
    })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  test('STILL reports the endpoint when unsubscribe() rejects', async () => {
    // Deleting the stored row is what actually stops delivery. Losing the
    // endpoint to a rejection would leave the row alive and this device
    // receiving notifications the player has just switched off — strictly
    // worse than a browser-side subscription that outlives its row, which is
    // inert and gets re-saved the next time the switch goes back on.
    const failure = new Error('unsubscribe failed')
    const subscription = fakeSubscription({
      endpoint: 'https://push.example/xyz',
      unsubscribe: vi.fn().mockRejectedValue(failure),
    })
    const browser = fakeBrowser({
      pushManager: {
        getSubscription: vi.fn().mockResolvedValue(subscription),
        subscribe: vi.fn(),
      },
    })

    await expect(unsubscribeFromPush(browser)).resolves.toEqual({
      endpoint: 'https://push.example/xyz',
      unsubscribeError: failure,
    })
  })

  test('a browser with nothing subscribed is a no-op, not an error', async () => {
    const browser = fakeBrowser({
      pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn() },
    })
    await expect(unsubscribeFromPush(browser)).resolves.toEqual({
      endpoint: null,
      unsubscribeError: null,
    })
  })

  test('a browser with no push manager at all is a no-op too', async () => {
    // Turning the switch off must still clear the METHOD on a browser that
    // cannot do push, so this reports "nothing to tear down" rather than
    // refusing. applyPushToggle's off path then runs to completion — it has no
    // early return at all, which the 'turning push OFF' tests below pin. In
    // 58f0edf it DID refuse, one level up, and the switch was unclearable from
    // such a device.
    await expect(unsubscribeFromPush(fakeBrowser({ pushManager: null }))).resolves.toEqual({
      endpoint: null,
      unsubscribeError: null,
    })
  })
})

describe('settledWithin', () => {
  test('passes the value through when the promise settles first', async () => {
    await expect(settledWithin(Promise.resolve('ready'), 1000)).resolves.toBe('ready')
  })

  test('resolves null rather than hanging on a promise that never settles', async () => {
    // `navigator.serviceWorker.ready` is specified never to reject and never
    // to time out — with no registration it stays pending for the life of the
    // page. Without this the Push switch spins, disabled, forever.
    await expect(settledWithin(new Promise(() => {}), 5)).resolves.toBeNull()
  })

  test('a rejection still rejects — a broken registration is not a timeout', async () => {
    await expect(settledWithin(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom')
  })
})


const VAPID_KEY =
  'BEl6dxjbRhIu1yTPy0iBk7-5eXVc4RRTVEnJcO3vBBUvSHhVJfKvXFB0Q0Mv8G7lQ0d5r6ThPNmQ0lYqTmFRPjA'

/**
 * ROTATING VAPID_PUBLIC_KEY MUST NOT BRICK THE SWITCH. Per the Push API,
 * `subscribe()` rejects with InvalidStateError when a subscription already
 * exists under a DIFFERENT applicationServerKey — so every device that had
 * ever subscribed would hit it after a rotation, the rejection would surface
 * as the generic "Failed to update delivery methods", and the only escape
 * (toggle off, then on) is one nothing tells the player about.
 */
describe('subscribeToPush — a subscription left by a previous VAPID key', () => {
  function invalidState(): Error {
    const error = new Error('Registration failed - existing subscription differs in options')
    error.name = 'InvalidStateError'
    return error
  }

  test('clears the stale subscription and subscribes again', async () => {
    const calls: Array<string> = []
    const stale = fakeSubscription({
      endpoint: 'https://push.example/stale',
      unsubscribe: vi.fn(async () => {
        calls.push('stale.unsubscribe')
        return true
      }),
    })
    const fresh = fakeSubscription({ endpoint: 'https://push.example/fresh' })

    let attempt = 0
    const pushManager: PushManagerLike = {
      subscribe: vi.fn(async () => {
        attempt += 1
        calls.push(`subscribe#${attempt}`)
        if (attempt === 1) throw invalidState()
        return fresh
      }),
      getSubscription: vi.fn(async () => {
        calls.push('getSubscription')
        return stale
      }),
    }

    const result = await subscribeToPush(fakeBrowser({ pushManager }), VAPID_KEY)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.subscription.endpoint).toBe('https://push.example/fresh')
    // The recovery order is the whole rule: find it, drop it, then retry.
    expect(calls).toEqual(['subscribe#1', 'getSubscription', 'stale.unsubscribe', 'subscribe#2'])
  })

  test('retries even when there is no stale subscription to find', async () => {
    // getSubscription can legitimately come back null — the engine rejected on
    // internal state we cannot see. The retry must still happen rather than
    // being gated on having found something to remove.
    let attempt = 0
    const fresh = fakeSubscription({ endpoint: 'https://push.example/fresh' })
    const pushManager: PushManagerLike = {
      subscribe: vi.fn(async () => {
        attempt += 1
        if (attempt === 1) throw invalidState()
        return fresh
      }),
      getSubscription: vi.fn().mockResolvedValue(null),
    }

    const result = await subscribeToPush(fakeBrowser({ pushManager }), VAPID_KEY)
    expect(result.ok).toBe(true)
    expect(pushManager.subscribe).toHaveBeenCalledTimes(2)
  })

  test('any OTHER rejection is not retried — it propagates on the first attempt', async () => {
    // NotAllowedError, a push service outage, an aborted registration. Retrying
    // those would unsubscribe a perfectly good subscription for nothing.
    const pushManager: PushManagerLike = {
      subscribe: vi.fn().mockRejectedValue(new TypeError('push service unreachable')),
      getSubscription: vi.fn().mockResolvedValue(null),
    }

    await expect(subscribeToPush(fakeBrowser({ pushManager }), VAPID_KEY)).rejects.toThrow(
      'push service unreachable',
    )
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1)
    expect(pushManager.getSubscription).not.toHaveBeenCalled()
  })

  test('a SECOND InvalidStateError propagates rather than looping', async () => {
    const pushManager: PushManagerLike = {
      subscribe: vi.fn().mockRejectedValue(invalidState()),
      getSubscription: vi.fn().mockResolvedValue(fakeSubscription()),
    }

    await expect(subscribeToPush(fakeBrowser({ pushManager }), VAPID_KEY)).rejects.toThrow(
      'existing subscription differs',
    )
    expect(pushManager.subscribe).toHaveBeenCalledTimes(2)
  })
})

/**
 * THE TESTS THIS BLOCK EXISTS FOR ARE MUTANTS THAT SURVIVED EARLIER COMMITS.
 *
 * At 58f0edf this logic lived inside the React handler, and swapping `save`
 * with `setMethods`, or turning the failed-subscribe early return into a
 * fallthrough, BOTH left the whole 859-test suite green — the second writes
 * 'push' into a player's delivery methods when the subscription failed, which
 * is the single thing the switch exists to prevent.
 *
 * At 159eab4 the ordering moved here but `browser` reached this function as a
 * pair of pre-built CLOSURES, so the decision "does a missing browser block
 * turning push OFF?" was still made in the component. An exact revert of that
 * commit's fix reintroduced the original bug with 869/869 green. `browser` and
 * `applicationServerKey` are values now, so that decision is reachable — which
 * is what the `browser: null` tests below actually pin.
 *
 * Hence assertions on ORDER, not only on outcome.
 */
function recordingEffects({
  currentMethods = ['email'],
  browser = 'available',
  applicationServerKey = VAPID_KEY as string | null,
  subscribeResult,
  existing = fakeSubscription(),
  unsubscribeRejects,
}: {
  currentMethods?: ReadonlyArray<string>
  /** 'available' builds a recording fake; 'none' is `browser: null`. */
  browser?: 'available' | 'none'
  applicationServerKey?: string | null
  /** Drives what the browser does, so the effect still records itself. */
  subscribeResult?: 'granted' | 'denied' | 'no-keys'
  existing?: PushSubscriptionLike | null
  unsubscribeRejects?: Error
} = {}): { effects: PushToggleEffects; calls: Array<string> } {
  const calls: Array<string> = []
  // `vi.fn` around each, not a bare closure: the assertions check both the
  // ORDER (via `calls`) and the ARGUMENTS (via `toHaveBeenCalledWith`), and
  // only a spy can answer the second.
  const record = <A extends Array<unknown>>(name: string, fn?: (...args: A) => unknown) =>
    vi.fn(async (...args: A) => {
      calls.push(name)
      return await fn?.(...args)
    })

  const fresh = fakeSubscription({
    endpoint: 'https://push.example/xyz',
    p256dh: subscribeResult === 'no-keys' ? null : undefined,
  })

  const pushManager: PushManagerLike = {
    subscribe: record('subscribe', () => fresh) as PushManagerLike['subscribe'],
    getSubscription: record('getSubscription', () =>
      existing === null
        ? null
        : {
            ...existing,
            unsubscribe: record('browser.unsubscribe', () => {
              if (unsubscribeRejects) throw unsubscribeRejects
              return true
            }) as PushSubscriptionLike['unsubscribe'],
          },
    ) as PushManagerLike['getSubscription'],
  }

  return {
    calls,
    effects: {
      currentMethods,
      browser:
        browser === 'none'
          ? null
          : fakeBrowser({
              permission: subscribeResult === 'denied' ? 'denied' : 'granted',
              pushManager,
            }),
      applicationServerKey,
      save: record('save'),
      removeStored: record('removeStored'),
      setMethods: record('setMethods'),
    },
  }
}

describe('applyPushToggle — turning push ON', () => {
  test('subscribes, THEN stores the subscription, THEN writes the method', async () => {
    const { effects, calls } = recordingEffects()

    await expect(applyPushToggle(true, effects)).resolves.toEqual({
      ok: true,
      unsubscribeError: null,
    })

    // ORDER, not merely membership. 'push' in reminderDeliveryMethods is a
    // promise to the reminder sweep that a delivery will work; writing it
    // before the subscription is stored makes that promise against a row that
    // does not exist yet. Swapping the last two is a mutant the whole suite
    // missed until this assertion existed.
    expect(calls).toEqual(['subscribe', 'save', 'setMethods'])
    expect(effects.save).toHaveBeenCalledWith({
      endpoint: 'https://push.example/xyz',
      p256dh: uint8ArrayToUrlBase64(ALL_BYTES.slice(0, 65)),
      auth: uint8ArrayToUrlBase64(ALL_BYTES.slice(100, 116)),
    })
    // Rebuilt from the current array — 'email' survives.
    expect(effects.setMethods).toHaveBeenCalledWith(['email', 'push'])
  })

  test.each(['denied', 'no-keys'] as const)(
    'a %s subscribe writes NOTHING — not the row, and above all not the method',
    async (subscribeResult) => {
      // THE RULE THE WHOLE TASK IS NAMED FOR. A method the browser will never
      // honour is worse than no method, so a failed subscribe must not reach
      // setMethods at all. Deleting the early return leaves the outcome
      // looking identical and this assertion is the only thing that notices.
      const { effects } = recordingEffects({ subscribeResult })

      const outcome = await applyPushToggle(true, effects)
      expect(outcome.ok).toBe(false)

      expect(effects.save).not.toHaveBeenCalled()
      expect(effects.setMethods).not.toHaveBeenCalled()
    },
  )

  test('NO BROWSER refuses, without touching anything', async () => {
    // The switch is only rendered where a VAPID key exists, but the browser
    // reading it may still have no Push API at all.
    const { effects, calls } = recordingEffects({ browser: 'none' })

    await expect(applyPushToggle(true, effects)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
    expect(calls).toEqual([])
  })

  test('NO VAPID KEY refuses rather than subscribing against "null"', async () => {
    // The caller passes `vapidPublicKey ?? null` rather than asserting it
    // non-null, and this is what makes that safe: a regression that let the
    // switch render without a key cannot produce a subscription bound to a
    // key nobody holds — which fails at DELIVERY, hours later, not here.
    const { effects, calls } = recordingEffects({ applicationServerKey: null })

    await expect(applyPushToggle(true, effects)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    })
    expect(calls).toEqual([])
  })

  test('a save that rejects propagates BEFORE the method is written', async () => {
    // The store failing is the same hazard as the subscribe failing: 'push'
    // must not be promised against a row that never landed.
    const { effects } = recordingEffects()
    effects.save = vi.fn().mockRejectedValue(new Error('NO_PLAYER'))

    await expect(applyPushToggle(true, effects)).rejects.toThrow('NO_PLAYER')
    expect(effects.setMethods).not.toHaveBeenCalled()
  })

  test('turning on a switch that is already on does not duplicate the method', async () => {
    // updateReminderMethodsFor (convex/settings.ts) throws
    // INVALID_REMINDER_METHOD on a repeated entry, so a plain append would
    // turn a harmless double-click into an error toast.
    const { effects } = recordingEffects({ currentMethods: ['email', 'push'] })
    await applyPushToggle(true, effects)
    expect(effects.setMethods).toHaveBeenCalledWith(['email', 'push'])
  })
})

describe('applyPushToggle — turning push OFF', () => {
  test('tears the subscription down, THEN removes the row, THEN drops the method', async () => {
    const { effects, calls } = recordingEffects({ currentMethods: ['email', 'push'] })

    await expect(applyPushToggle(false, effects)).resolves.toEqual({
      ok: true,
      unsubscribeError: null,
    })

    expect(calls).toEqual([
      'getSubscription',
      'browser.unsubscribe',
      'removeStored',
      'setMethods',
    ])
    expect(effects.removeStored).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/abc123')
    // 'email' survives, symmetric with handleEmailToggle.
    expect(effects.setMethods).toHaveBeenCalledWith(['email'])
  })

  test('THE 58f0edf BUG: off still works where the browser cannot push at all', async () => {
    // A player subscribes on their phone, then opens settings on a browser
    // with no Push API — an older iOS Safari, or any origin with site data
    // blocked, so `browserPush()` returns null. The switch reads CHECKED,
    // because it reads the server's array, which still holds 'push'.
    //
    // 58f0edf bailed out above the on/off split in that case and told them the
    // browser cannot do push. The method stayed in the row and the switch was
    // UNCLEARABLE from that device. 159eab4 fixed the behaviour but left the
    // decision in a component closure, where reverting it went unnoticed by
    // every test. `browser` is a VALUE now, so this test executes the decision.
    const { effects, calls } = recordingEffects({
      currentMethods: ['email', 'push'],
      browser: 'none',
    })

    await expect(applyPushToggle(false, effects)).resolves.toEqual({
      ok: true,
      unsubscribeError: null,
    })

    // Nothing to tear down and no endpoint to name — but the METHOD goes,
    // which is what actually stops the reminder sweep.
    expect(calls).toEqual(['setMethods'])
    expect(effects.removeStored).not.toHaveBeenCalled()
    expect(effects.setMethods).toHaveBeenCalledWith(['email'])
  })

  test('NO VAPID KEY does not block turning it off either', async () => {
    // Same asymmetry, second input: a deployment that has just had its key
    // removed must still let the people already subscribed switch off.
    const { effects } = recordingEffects({
      currentMethods: ['push'],
      applicationServerKey: null,
    })
    await expect(applyPushToggle(false, effects)).resolves.toMatchObject({ ok: true })
    expect(effects.setMethods).toHaveBeenCalledWith([])
  })

  test('a browser-side unsubscribe that failed still removes the row and the method', async () => {
    const failure = new Error('unsubscribe failed')
    const { effects, calls } = recordingEffects({
      currentMethods: ['push'],
      unsubscribeRejects: failure,
    })

    await expect(applyPushToggle(false, effects)).resolves.toEqual({
      ok: true,
      unsubscribeError: failure,
    })

    expect(calls).toEqual([
      'getSubscription',
      'browser.unsubscribe',
      'removeStored',
      'setMethods',
    ])
    expect(effects.setMethods).toHaveBeenCalledWith([])
  })

  test('off on a player who never had push is still a clean no-op write', async () => {
    const { effects } = recordingEffects({ currentMethods: ['email'], existing: null })
    await applyPushToggle(false, effects)
    expect(effects.removeStored).not.toHaveBeenCalled()
    expect(effects.setMethods).toHaveBeenCalledWith(['email'])
  })
})
