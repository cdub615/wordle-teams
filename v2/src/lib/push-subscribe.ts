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
 * Whether `error` is the Push API's InvalidStateError.
 *
 * BY `name`, NOT `instanceof DOMException`. The error crosses a realm boundary
 * on its way out of the service worker container in some engines, and this
 * suite runs under edge-runtime where the constructor identity is not the
 * page's anyway — an `instanceof` check would quietly stop matching and take
 * the recovery path below with it.
 */
function isInvalidStateError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'InvalidStateError'
  )
}

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
  const options = {
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(applicationServerKey),
  }

  let subscription: PushSubscriptionLike
  try {
    subscription = await pushManager.subscribe(options)
  } catch (error) {
    if (!isInvalidStateError(error)) throw error
    // A SUBSCRIPTION FROM A PREVIOUS APPLICATION SERVER KEY IS IN THE WAY.
    // The Push API rejects `subscribe()` with InvalidStateError when one
    // already exists under a DIFFERENT applicationServerKey — so rotating
    // VAPID_PUBLIC_KEY bricks the switch on every device that had ever
    // subscribed, permanently: the rejection propagates to a generic "Failed
    // to update delivery methods" toast, and the only escape is toggling OFF
    // first, which nothing tells the player to do. The handoff already
    // records that regenerating VAPID keys kills existing subscriptions
    // silently; this is the client-side face of it.
    //
    // RETRY RATHER THAN COMPARE `subscription.options.applicationServerKey`:
    // a matching key needs no reconciliation at all (the spec returns the
    // existing subscription), so the common path stays a single call, and
    // `PushSubscriptionOptions` is not carried by every engine that ships
    // the rest of this API — a comparison against a missing value would
    // either resubscribe every time or never.
    //
    // The stale row left in Convex is not orphaned: the endpoint stops
    // resolving and pushSend.ts's 404/410 branch prunes it on the next send.
    const stale = await pushManager.getSubscription()
    if (stale) await stale.unsubscribe()
    // Not caught again. A second InvalidStateError is not something a third
    // attempt fixes, and it must reach the caller rather than be reported as
    // a subscription that worked.
    subscription = await pushManager.subscribe(options)
  }

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
 * What `applyPushToggle` needs: two RAW INPUTS and three mutations.
 *
 * `browser` AND `applicationServerKey` ARE VALUES, NOT PRE-BUILT CLOSURES, and
 * that distinction is the whole point of this shape. 159eab4 passed `subscribe`
 * and `unsubscribe` closures instead, which meant the decision "can this
 * browser do push, and does that block turning it OFF?" was made in the
 * component, in wiring no test could execute — so an exact revert of that
 * commit's fix reintroduced the bug with the entire suite still green. The
 * decision belongs in here, where it is reachable. The caller is left with
 * three mutation functions and two values, which is wiring rather than policy.
 *
 * The three mutations stay injected because convex-test cannot stand up a
 * Better Auth session (see convex/settings.ts), so a Convex mutation is not
 * callable from any unit test in this repo.
 */
export interface PushToggleEffects {
  /** `null` on a browser that cannot do push at all — see `browserPush()`. */
  browser: PushBrowser | null
  /** `null` where this deployment has no VAPID key configured. */
  applicationServerKey: string | null
  save(subscription: StoredSubscription): Promise<unknown>
  removeStored(endpoint: string): Promise<unknown>
  /**
   * Turn the PUSH method on or off. Intent only — the array is composed
   * server-side against the current row (`setReminderMethodFor`), so this
   * function no longer needs to know what the other methods are.
   *
   * IT USED TO TAKE THE WHOLE ARRAY, built here from a `currentMethods` the
   * caller had captured at render time. Between that render and this call sits
   * the browser's push permission prompt, which is MODAL and can stay open for
   * minutes — so a player toggling Email in another tab had their change
   * silently reverted (`wordle-teams-069`).
   */
  setMethod(enabled: boolean): Promise<unknown>
}

export type PushToggleOutcome =
  | { ok: true; unsubscribeError: unknown }
  | { ok: false; reason: SubscribeFailureReason }

/**
 * The whole of the Push switch's policy, with the browser handed in.
 *
 * EXTRACTED FROM THE REACT HANDLER BECAUSE THE ORDERING *IS* THE RULE, and
 * inside an event handler no test could reach it. Review of 58f0edf measured
 * that directly: swapping `save` and `setMethod`, and turning the
 * failed-subscribe early return into a fallthrough, BOTH left 859/859 green —
 * and the second writes 'push' into a player's delivery methods when the
 * subscription failed, which is the single thing this switch exists to
 * prevent. This is the fourth time this codebase has had to hand inputs in to
 * make a rule testable, after `registerServiceWorker` and `decideLocalCapture`.
 *
 * TURNING PUSH ON — `subscribe`, then `save`, THEN `setMethod`, and any
 * failure before the last one returns or throws. 'push' in
 * reminderDeliveryMethods is a promise to the reminder sweep that a delivery
 * will work; writing it before the subscription is stored makes that promise
 * against something that does not exist yet, and writing it when the subscribe
 * failed makes it against something that never will. A method the browser will
 * never honour is worse than no method.
 *
 * TURNING PUSH OFF IGNORES BOTH `browser` AND `applicationServerKey`, and has
 * no early return at all. That is the fix for a real bug in 58f0edf: that
 * version bailed out above the on/off split whenever `browserPush()` returned
 * null, so a player who subscribed on their phone and later opened settings on
 * a browser without the Push API (an older iOS Safari, or any origin with site
 * data blocked) saw the switch CHECKED — it reads the server's array, which
 * still held 'push' — clicked it off, was told the browser cannot do push, and
 * the method stayed. The switch was UNCLEARABLE from that device. Deleting the
 * stored row and the method is server-side work with nothing to ask of the
 * browser, so it happens regardless; only the browser-side teardown is skipped.
 */
export async function applyPushToggle(
  enabled: boolean,
  {
    browser,
    applicationServerKey,
    save,
    removeStored,
    setMethod,
  }: PushToggleEffects,
): Promise<PushToggleOutcome> {
  if (enabled) {
    // THE ONLY PLACE `browser` BLOCKS ANYTHING. Reported as 'unavailable'
    // rather than thrown, so the caller can say something useful instead of
    // showing the generic mutation-failure copy.
    if (!browser || !applicationServerKey) return { ok: false, reason: 'unavailable' }

    const result = await subscribeToPush(browser, applicationServerKey)
    if (!result.ok) return { ok: false, reason: result.reason }
    await save(result.subscription)
    await setMethod(true)
    return { ok: true, unsubscribeError: null }
  }

  // No browser is not a refusal here, it is simply nothing to tear down.
  const { endpoint, unsubscribeError } = browser
    ? await unsubscribeFromPush(browser)
    : { endpoint: null, unsubscribeError: null }
  // Deleting the stored row is what actually stops delivery, so it happens
  // even when the browser-side unsubscribe rejected — see unsubscribeFromPush.
  if (endpoint) await removeStored(endpoint)
  await setMethod(false)
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
