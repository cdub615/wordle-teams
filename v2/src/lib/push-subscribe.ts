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
  return Promise.race([
    pending,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), milliseconds)),
  ])
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
      // iOS Safari below 16.4 registers service workers happily and has no
      // PushManager at all, so this is a real browser rather than a
      // hypothetical one.
      return registration?.pushManager ?? null
    },
  }
}
