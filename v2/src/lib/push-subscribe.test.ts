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
  type SubscribeResult,
  type UnsubscribeResult,
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

  test('a real VAPID application server key decodes to 65 bytes starting 0x04', () => {
    // An uncompressed P-256 point. The length is the check that matters:
    // pushManager rejects a key of any other size with an opaque error.
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

  test.each([1, 2, 3, 16, 65])('strips padding for a %i-byte input', (length) => {
    // 1 and 2 mod 3 are the only lengths that pad at all; 16 (the `auth`
    // secret) and 65 (the `p256dh` point) are the two this app actually
    // encodes, and they land on 1 and 2 respectively.
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
    // iOS Safari below 16.4, or a service worker that never became ready.
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

/**
 * THE TESTS THIS BLOCK EXISTS FOR ARE THE TWO MUTANTS THAT SURVIVED 58f0edf.
 * When this logic lived inside the React handler, swapping `save` and
 * `setMethods`, and turning the failed-subscribe early return into a
 * fallthrough, BOTH left the whole 859-test suite green — and the second
 * writes 'push' into a player's delivery methods when the subscription failed,
 * which is the single thing the switch exists to prevent. The e2e cannot reach
 * it either: that spec asserts the switch is absent. Hence effect injection,
 * and hence assertions on ORDER rather than only on outcome.
 */
function recordingEffects({
  subscribeResult,
  unsubscribeResult,
  ...overrides
}: Partial<PushToggleEffects> & {
  // Given as RESULTS rather than as replacement functions, so the injected
  // effect still records itself and the order assertions stay meaningful.
  subscribeResult?: SubscribeResult
  unsubscribeResult?: UnsubscribeResult
} = {}): { effects: PushToggleEffects; calls: Array<string> } {
  const calls: Array<string> = []
  // `vi.fn` around it, not a bare closure: the assertions below check both the
  // ORDER (via `calls`) and the ARGUMENTS (via `toHaveBeenCalledWith`), and
  // only a spy can answer the second.
  const record = <A extends Array<unknown>>(name: string, fn?: (...args: A) => unknown) =>
    vi.fn(async (...args: A) => {
      calls.push(name)
      return await fn?.(...args)
    })

  const effects: PushToggleEffects = {
    currentMethods: ['email'],
    subscribe: record(
      'subscribe',
      () =>
        subscribeResult ?? {
          ok: true as const,
          subscription: { endpoint: 'https://push.example/xyz', p256dh: 'p', auth: 'a' },
        },
    ) as PushToggleEffects['subscribe'],
    unsubscribe: record(
      'unsubscribe',
      () =>
        unsubscribeResult ?? { endpoint: 'https://push.example/xyz', unsubscribeError: null },
    ) as PushToggleEffects['unsubscribe'],
    save: record('save'),
    removeStored: record('removeStored'),
    setMethods: record('setMethods'),
    ...overrides,
  }
  return { effects, calls }
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
    // does not exist yet. Swapping the last two lines is a mutant the whole
    // suite missed until this assertion existed.
    expect(calls).toEqual(['subscribe', 'save', 'setMethods'])
    expect(effects.save).toHaveBeenCalledWith({
      endpoint: 'https://push.example/xyz',
      p256dh: 'p',
      auth: 'a',
    })
    // Rebuilt from the current array — 'email' survives.
    expect(effects.setMethods).toHaveBeenCalledWith(['email', 'push'])
  })

  test.each(['denied', 'unavailable', 'no-keys'] as const)(
    'a %s subscribe writes NOTHING — not the row, and above all not the method',
    async (reason) => {
      // THE RULE THE WHOLE TASK IS NAMED FOR. A method the browser will never
      // honour is worse than no method, so a failed subscribe must not reach
      // setMethods at all. Deleting the early return leaves the outcome
      // looking identical and this assertion is the only thing that notices.
      const { effects, calls } = recordingEffects({ subscribeResult: { ok: false, reason } })

      await expect(applyPushToggle(true, effects)).resolves.toEqual({ ok: false, reason })

      // `subscribe` ran; NOTHING after it did.
      expect(calls).toEqual(['subscribe'])
      expect(effects.save).not.toHaveBeenCalled()
      expect(effects.setMethods).not.toHaveBeenCalled()
    },
  )

  test('a save that rejects propagates BEFORE the method is written', async () => {
    // The store failing is the same hazard as the subscribe failing: 'push'
    // must not be promised against a row that never landed.
    const { effects } = recordingEffects({
      save: vi.fn().mockRejectedValue(new Error('NO_PLAYER')),
    })

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

    expect(calls).toEqual(['unsubscribe', 'removeStored', 'setMethods'])
    expect(effects.removeStored).toHaveBeenCalledWith('https://push.example/xyz')
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
    // UNCLEARABLE from that device. Removing the row and the method asks
    // nothing of the browser, so it must happen regardless — this path has no
    // early return at all now, and this is the test that keeps it that way.
    const { effects, calls } = recordingEffects({
      currentMethods: ['email', 'push'],
      unsubscribeResult: { endpoint: null, unsubscribeError: null },
    })

    await expect(applyPushToggle(false, effects)).resolves.toEqual({
      ok: true,
      unsubscribeError: null,
    })

    // Nothing to delete server-side — there is no endpoint to name — but the
    // METHOD goes, which is what actually stops the reminder sweep.
    expect(calls).toEqual(['unsubscribe', 'setMethods'])
    expect(effects.removeStored).not.toHaveBeenCalled()
    expect(effects.setMethods).toHaveBeenCalledWith(['email'])
  })

  test('a browser-side unsubscribe that failed still removes the row and the method', async () => {
    const failure = new Error('unsubscribe failed')
    const { effects, calls } = recordingEffects({
      currentMethods: ['push'],
      unsubscribeResult: { endpoint: 'https://push.example/xyz', unsubscribeError: failure },
    })

    await expect(applyPushToggle(false, effects)).resolves.toEqual({
      ok: true,
      unsubscribeError: failure,
    })

    expect(calls).toEqual(['unsubscribe', 'removeStored', 'setMethods'])
    expect(effects.setMethods).toHaveBeenCalledWith([])
  })

  test('off on a player who never had push is still a clean no-op write', async () => {
    const { effects } = recordingEffects({
      currentMethods: ['email'],
      unsubscribeResult: { endpoint: null, unsubscribeError: null },
    })
    await applyPushToggle(false, effects)
    expect(effects.setMethods).toHaveBeenCalledWith(['email'])
  })
})
