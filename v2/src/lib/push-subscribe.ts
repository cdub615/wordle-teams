/**
 * The browser half of web push: turning the VAPID key into bytes the Push API
 * accepts, driving `pushManager.subscribe`, and handing the result back in the
 * exact shape `convex/push.ts`'s `savePushSubscription` stores.
 *
 * EVERY BROWSER SURFACE IS A PARAMETER, never a global. That is the third time
 * this codebase has reached for the pattern and the reason is the same each
 * time — `registerServiceWorker(navigatorLike)` (register-sw.ts) because a
 * `[SecureContext]` getter that throws is not expressible through the DOM
 * lib's `Navigator`, and `decideLocalCapture({...})` (use-local-capture.ts)
 * because `window.matchMedia` exists in neither edge-runtime nor jsdom. Here
 * it buys the same thing: every branch below — permission refused, no push
 * manager, a `subscribe()` that rejects, a subscription with no keys, the key
 * round-trip itself — is reachable from a plain object in the default
 * edge-runtime suite, with no jsdom and no global stubbing anywhere.
 *
 * `browserPush()` at the bottom is the one place the real globals are read,
 * and it is deliberately the only part of this file with no unit test: it has
 * no logic to get wrong beyond wiring, and the wiring is what e2e and a real
 * device see.
 */

/**
 * `Uint8Array<ArrayBuffer>`, spelled out rather than left as the bare
 * `Uint8Array`. Since TypeScript 5.7 the typed arrays are generic in their
 * backing buffer and the bare name defaults to `ArrayBufferLike`, which
 * INCLUDES `SharedArrayBuffer` — and the DOM's `BufferSource` does not. So a
 * plain `Uint8Array` is not assignable to `PushSubscriptionOptionsInit`'s
 * `applicationServerKey` and the real `PushManager` stops matching
 * `PushManagerLike` below. Nothing here ever shares a buffer.
 */
type RawKeyBytes = Uint8Array<ArrayBuffer>

/**
 * `pushManager.subscribe` wants the application server key as raw bytes, and
 * every transport we have gives it to us as base64url. Both halves of that
 * conversion are here, and they are inverses — see the round-trip tests.
 *
 * GETTING THIS WRONG DOES NOT FAIL HERE, in either direction, and that is why
 * both halves are pinned rather than eyeballed:
 *
 * - a mis-DECODED application server key produces a subscription bound to a
 *   key nobody holds, which surfaces as a 403 from the push service hours
 *   later, inside a Convex action;
 * - a mis-ENCODED `p256dh`/`auth` pair produces a subscription the payload is
 *   encrypted against wrongly, and that fails SILENTLY — the push service
 *   answers 201 without decrypting anything and the browser drops the
 *   undecryptable message. Nothing anywhere reports it.
 */
export function urlBase64ToUint8Array(base64Url: string): RawKeyBytes {
  // `(4 - (len % 4)) % 4` — the OUTER `% 4` is what makes an already-padded
  // (or exactly-aligned) string decode instead of gaining four spurious `=`.
  // Nothing stops a hand-set `VAPID_PUBLIC_KEY` from carrying its padding.
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  // `-` and `_` are base64url's substitutes for `+` and `/`. `atob` speaks
  // only the standard alphabet, so without this a key containing either
  // decodes to the wrong bytes with no error at all.
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** The inverse of the above: raw bytes to unpadded base64url. */
export function uint8ArrayToUrlBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  // The trailing `=` strip is not cosmetic: `savePushSubscription` stores this
  // string verbatim and `web-push` feeds it straight to its own base64url
  // decoder, which rejects the padding character outright.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The parts of a real `PushSubscription` this module uses. */
export interface PushSubscriptionLike {
  readonly endpoint: string
  getKey(name: 'p256dh' | 'auth'): ArrayBuffer | null
  unsubscribe(): Promise<boolean>
}

/** The parts of a real `PushManager` this module uses. */
export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>
  subscribe(options: {
    userVisibleOnly: boolean
    applicationServerKey: RawKeyBytes
  }): Promise<PushSubscriptionLike>
}

/**
 * The injected browser surface. Two calls, both async, both allowed to say
 * "no": `requestPermission` returns whatever the browser reports, and
 * `pushManager` returns `null` on any browser that cannot do push at all
 * (or whose service worker never became ready — see `browserPush`).
 */
export interface PushBrowser {
  requestPermission(): Promise<string>
  pushManager(): Promise<PushManagerLike | null>
}

/** Exactly what `savePushSubscription` takes. */
export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * The three ways subscribing can fail WITHOUT throwing. Each needs a different
 * thing from the player, which is why they are distinct rather than one
 * boolean — see `pushFailureMessage` in notifications-tab.tsx.
 *
 * `denied` covers a dismissed prompt as well as an outright refusal: 'default'
 * means the browser will not deliver anything either.
 */
export type SubscribeFailureReason = 'denied' | 'unavailable' | 'no-keys'

export type SubscribeResult =
  | { ok: true; subscription: StoredSubscription }
  | { ok: false; reason: SubscribeFailureReason }

/**
 * Subscribes this browser to push and returns the record to store.
 *
 * ONLY `{ ok: true }` MAY WRITE 'push' INTO reminderDeliveryMethods. Every
 * other outcome — including a `subscribe()` that rejects, which propagates
 * rather than being folded into the union — means the browser will never
 * deliver anything, and a stored method the browser will never honour is
 * worse than no method at all.
 */
export async function subscribeToPush(
  browser: PushBrowser,
  applicationServerKey: string,
): Promise<SubscribeResult> {
  const permission = await browser.requestPermission()
  // NOT `permission === 'denied'`. 'default' is what a dismissed prompt
  // leaves behind, and it delivers exactly as much as a refusal does.
  if (permission !== 'granted') return { ok: false, reason: 'denied' }

  const pushManager = await browser.pushManager()
  if (!pushManager) return { ok: false, reason: 'unavailable' }

  // `userVisibleOnly: true` is not optional in Chromium — it rejects a
  // silent subscription outright — and it is honest here regardless: every
  // push this app sends shows a notification (src/sw.ts's `push` handler).
  const subscription = await pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(applicationServerKey),
  })

  const p256dh = subscription.getKey('p256dh')
  const auth = subscription.getKey('auth')

  // `getKey` IS TYPED `ArrayBuffer | null` AND THE NULL IS HANDLED, not
  // asserted away. A subscription with no keys cannot be encrypted to, so
  // storing it would produce the silent-delivery-failure described on
  // `uint8ArrayToUrlBase64` above: a 201 from the push service and nothing
  // ever arriving. Better to report it and stay off.
  if (!p256dh || !auth) {
    // And drop the useless subscription rather than leaving it registered —
    // a later attempt then gets a fresh one instead of the same keyless row.
    // Its own failure is not interesting: we are already returning an error.
    await subscription.unsubscribe().catch(() => false)
    return { ok: false, reason: 'no-keys' }
  }

  return {
    ok: true,
    subscription: {
      endpoint: subscription.endpoint,
      p256dh: uint8ArrayToUrlBase64(new Uint8Array(p256dh)),
      auth: uint8ArrayToUrlBase64(new Uint8Array(auth)),
    },
  }
}

export interface UnsubscribeResult {
  /**
   * The endpoint whose stored row must be deleted, or `null` when this
   * browser had no subscription to begin with.
   */
  endpoint: string | null
  /** What `unsubscribe()` rejected with, or `null`. NOT fatal — see below. */
  unsubscribeError: unknown
}

/**
 * Tears this browser's subscription down and reports the endpoint the server
 * row is keyed by.
 *
 * THE ENDPOINT COMES BACK EVEN WHEN `unsubscribe()` REJECTS, and the caller is
 * expected to delete the row anyway. Deleting the row is what actually stops
 * delivery; a browser-side subscription that outlives it is inert, and the
 * next time this player turns the switch back on `subscribe()` hands back that
 * same subscription and re-saves it. Losing the endpoint to a rejection would
 * be the genuinely bad outcome: the row would survive and this device would
 * keep receiving notifications the player has switched off.
 */
export async function unsubscribeFromPush(browser: PushBrowser): Promise<UnsubscribeResult> {
  const pushManager = await browser.pushManager()
  if (!pushManager) return { endpoint: null, unsubscribeError: null }

  const subscription = await pushManager.getSubscription()
  if (!subscription) return { endpoint: null, unsubscribeError: null }

  const endpoint = subscription.endpoint
  try {
    await subscription.unsubscribe()
    return { endpoint, unsubscribeError: null }
  } catch (error) {
    return { endpoint, unsubscribeError: error }
  }
}

/**
 * The five effects `applyPushToggle` needs. Injected rather than imported for
 * the same reason `PushBrowser` is: three of them are Convex mutations, which
 * no unit test in this repo can drive (convex-test cannot stand up a Better
 * Auth session — see convex/settings.ts), and the other two touch a browser
 * that does not exist under edge-runtime.
 */
export interface PushToggleEffects {
  /** The player's stored `reminderDeliveryMethods`, as loaded. */
  currentMethods: ReadonlyArray<string>
  /**
   * Subscribe this browser. Returns `{ ok: false, reason: 'unavailable' }`
   * rather than throwing where there is no browser surface or no configured
   * VAPID key — see the caller in notifications-tab.tsx.
   */
  subscribe(): Promise<SubscribeResult>
  /**
   * Tear the browser-side subscription down. MUST degrade to
   * `{ endpoint: null, unsubscribeError: null }` where there is no browser
   * surface, rather than refusing — see the ordering rules below.
   */
  unsubscribe(): Promise<UnsubscribeResult>
  save(subscription: StoredSubscription): Promise<unknown>
  removeStored(endpoint: string): Promise<unknown>
  setMethods(methods: ReadonlyArray<string>): Promise<unknown>
}

export type PushToggleOutcome =
  | { ok: true; unsubscribeError: unknown }
  | { ok: false; reason: SubscribeFailureReason }

/**
 * The whole of the Push switch's policy, with every effect handed in.
 *
 * EXTRACTED FROM THE HANDLER BECAUSE THE ORDERING *IS* THE RULE, and inside a
 * React event handler no test could reach it. Review of 58f0edf measured that
 * directly: swapping `save` and `setMethods`, and turning the failed-subscribe
 * early return into a fallthrough, BOTH left 859/859 green — and the second
 * mutant writes 'push' into a player's delivery methods when the subscription
 * failed, which is the single thing this switch exists to prevent. The e2e
 * cannot reach it either, since that spec asserts the switch is absent. This
 * is the third time this codebase has had to hand effects in to make a rule
 * testable, after `registerServiceWorker` and `decideLocalCapture`.
 *
 * TURNING PUSH ON — `subscribe`, then `save`, THEN `setMethods`, and any
 * failure before the last one returns or throws. 'push' in
 * reminderDeliveryMethods is a promise to the reminder sweep that a delivery
 * will work; writing it before the subscription is stored makes that promise
 * against something that does not exist yet, and writing it when `subscribe`
 * failed makes it against something that never will. A method the browser
 * will never honour is worse than no method.
 *
 * TURNING PUSH OFF — NO EARLY RETURN EXISTS ON THIS PATH, deliberately, and
 * that is the fix for a real bug in 58f0edf. That version bailed out above
 * the on/off split whenever `browserPush()` returned null, so a player who
 * subscribed on their phone and later opened settings on a browser without
 * the Push API (an older iOS Safari, or any origin with site data blocked)
 * saw the switch checked, clicked it off, and got told the browser cannot do
 * push — while the method stayed in their row. The switch was unclearable
 * from that device. Removing the stored row and the method is server-side
 * work that has nothing to ask of the browser, so it happens regardless; the
 * browser-side teardown is the only part that can be skipped, and
 * `unsubscribe` reports that as `endpoint: null` rather than by refusing.
 */
export async function applyPushToggle(
  enabled: boolean,
  { currentMethods, subscribe, unsubscribe, save, removeStored, setMethods }: PushToggleEffects,
): Promise<PushToggleOutcome> {
  if (enabled) {
    const result = await subscribe()
    if (!result.ok) return { ok: false, reason: result.reason }
    await save(result.subscription)
    // Rebuilt from the CURRENT array, never from scratch: 'email' lives in the
    // same field, and handleEmailToggle is symmetric for the same reason.
    await setMethods(Array.from(new Set([...currentMethods, 'push'])))
    return { ok: true, unsubscribeError: null }
  }

  const { endpoint, unsubscribeError } = await unsubscribe()
  // Deleting the stored row is what actually stops delivery, so it happens
  // even when the browser-side unsubscribe rejected — see unsubscribeFromPush.
  if (endpoint) await removeStored(endpoint)
  await setMethods(currentMethods.filter((method) => method !== 'push'))
  return { ok: true, unsubscribeError }
}

/**
 * Resolves to `null` rather than hanging forever.
 *
 * `navigator.serviceWorker.ready` IS SPECIFIED NEVER TO REJECT AND NEVER TO
 * TIME OUT: with no registration it simply stays pending, indefinitely. That
 * is reachable in production — `useServiceWorkerRegistration` warns and
 * carries on when registration fails (private browsing, blocked site data, a
 * script fetch an extension ate), and a `pushManager()` awaiting `ready` after
 * that never settles. Without this race the Push switch would spin, disabled,
 * for the rest of the session with nothing logged.
 */
export function settledWithin<T>(pending: Promise<T>, milliseconds: number): Promise<T | null> {
  // `| undefined` only because TypeScript cannot see that a Promise executor
  // runs synchronously; by the time `finally` can fire it is always set.
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    pending,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), milliseconds)
    }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * How long to wait for `serviceWorker.ready`. Generous: on a first visit the
 * worker is still installing and activating, which is legitimately slow on a
 * cold cache, and the cost of being wrong here is a false "not supported".
 */
const READY_TIMEOUT_MS = 10_000

/**
 * The real browser, or `null` where push cannot work at all.
 *
 * THE ONLY GLOBAL READS IN THIS FILE, kept behind a factory the callers invoke
 * at click time rather than at render: `Notification` is undefined during SSR,
 * and this component tree is server-rendered.
 *
 * The `try` around `navigator.serviceWorker` is not defensive padding — it is
 * the exact bug register-sw.test.ts pins. That property is a `[SecureContext]`
 * getter which THROWS `SecurityError` in Chromium when site data is blocked
 * for the origin, so a presence check passes and the read throws synchronously.
 */
export function browserPush(): PushBrowser | null {
  if (typeof navigator === 'undefined') return null
  if (typeof Notification === 'undefined') return null

  let container: ServiceWorkerContainer | undefined
  try {
    container = navigator.serviceWorker
  } catch {
    return null
  }
  if (!container) return null

  return {
    requestPermission: () => Notification.requestPermission(),
    pushManager: async () => {
      const registration = await settledWithin(container.ready, READY_TIMEOUT_MS)
      // TWO CASES, AND NEITHER IS THE ONE IT IS TEMPTING TO CITE. `registration`
      // is null when `settledWithin` timed out — no worker ever became ready.
      // `pushManager` is absent on a registration in an engine that ships
      // service workers without the Push API.
      //
      // NOT iOS Safari below 16.4: that browser has no `window.Notification`
      // either, so `browserPush` already returned null above and this line is
      // never reached for it. This is defensive against the ready timeout,
      // which IS reachable, plus any future engine in that shape.
      return registration?.pushManager ?? null
    },
  }
}
