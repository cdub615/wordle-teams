/**
 * The service worker's two decisions about push input, lifted out of src/sw.ts
 * so they can be tested.
 *
 * WHY THEY ARE HERE. src/sw.ts runs `precacheAndRoute`, `registerRoute` and
 * five `addEventListener` calls at module scope against globals that exist only
 * inside a service worker, so a test cannot import it — and there is no e2e for
 * the worker either, because `pnpm dev` never serves dist/client/sw.js. That
 * left the two functions below as the only remote-input handling in the app
 * with no coverage of any kind. Same lift, same reason, as ./sw-caches.ts.
 *
 * BOTH TAKE REMOTE INPUT. A push payload is signed by VAPID, which proves it
 * came from our server — not that its contents are well-formed, and not that a
 * future server bug cannot put something unexpected in it. `resolveNotificationUrl`
 * in particular decides where to navigate a user's browser.
 */

export interface ReminderPayload {
  title: string
  body: string
  url: string
}

/**
 * The reminder copy shown when the push body cannot be read.
 *
 * DUPLICATES convex/pushSend.ts's `payload` in `deliverTo` VERBATIM, and
 * nothing mechanical keeps them in step — sw-push.test.ts asserts they are
 * byte-identical, which is what turns the "CHANGE BOTH" note on each side into
 * something a build can enforce. Deliberately not a shared module: the sender
 * is a Convex 'use node' action and this is a browser service worker bundled
 * separately by scripts/build-sw.mjs, so sharing would drag one runtime's
 * dependencies into the other's bundle for three string literals.
 */
export const REMINDER_FALLBACK: ReminderPayload = {
  title: 'Wordle Teams',
  body: "You have not entered today's board yet. Don't miss out on those points!",
  url: '/app',
}

/** The shape of `PushEvent.data`, structurally, so a test can supply one. */
interface PushMessageDataLike {
  json(): unknown
}

/**
 * Reads a push body into the three fields the notification needs, falling back
 * field by field.
 *
 * `event.data.json()` THROWS on a non-JSON body. v1's `event.data?.json() ?? {}`
 * did not catch that — `??` only guards a null `data`, not a parse failure — so
 * a malformed or empty push killed the handler and showed nothing at all. A
 * push that renders no notification is itself a visible penalty: Chrome
 * substitutes its own "This site has been updated in the background" notice. So
 * every path here returns a renderable payload; there is no way out that shows
 * nothing.
 *
 * FIELD BY FIELD, NOT ALL OR NOTHING: a payload with a good body and a missing
 * title should still show the body. The truthiness half of each check matters
 * as much as the typeof half — `title: ''` is a string, and a notification with
 * an empty title renders as a blank line.
 */
export function readReminder(data: PushMessageDataLike | null | undefined): ReminderPayload {
  if (!data) return REMINDER_FALLBACK

  let parsed: unknown
  try {
    parsed = data.json()
  } catch {
    return REMINDER_FALLBACK
  }

  // `typeof null === 'object'`, so the null check is not redundant; without it
  // the property reads below would throw and take the handler with them.
  if (typeof parsed !== 'object' || parsed === null) return REMINDER_FALLBACK
  const fields = parsed as Partial<Record<keyof ReminderPayload, unknown>>

  return {
    title:
      typeof fields.title === 'string' && fields.title ? fields.title : REMINDER_FALLBACK.title,
    body: typeof fields.body === 'string' && fields.body ? fields.body : REMINDER_FALLBACK.body,
    url: typeof fields.url === 'string' && fields.url ? fields.url : REMINDER_FALLBACK.url,
  }
}

/**
 * Where a notification tap should send the browser, resolved against our own
 * origin and CLAMPED TO IT.
 *
 * THE ORIGIN CHECK IS THE SECURITY BOUNDARY OF THIS WORKER. The value arrives
 * inside a push payload and is handed to `clients.openWindow` / `client.navigate`.
 * Without the clamp, anything that can put a string in that payload — a server
 * bug, a compromised sender, a future feature that echoes user input into a
 * notification — becomes an open redirect that opens in the app's own window,
 * with our icon on the notification that launched it. Deleting the clamp is
 * mutation-tested in sw-push.test.ts.
 *
 * TWO CONDITIONS, AND THE SECOND IS NOT REDUNDANT. The origin comparison is
 * positive rather than a blocklist of schemes, which is what makes it hold for
 * the cases a blocklist forgets: `javascript:` (whose URL origin is the opaque
 * string "null"), protocol-relative `//evil.example/x` (which the URL
 * constructor resolves to a DIFFERENT host while keeping our scheme), `data:`,
 * and any absolute https URL elsewhere.
 *
 * The scheme check is there because `blob:` INHERITS THE ORIGIN OF ITS INNER
 * URL — `new URL('blob:https://beta.wordleteams.com/abc').origin` is
 * `https://beta.wordleteams.com`, so an origin comparison alone passes it.
 * Found by the test below, not reasoned about in advance. Requiring http(s)
 * also makes the return value exactly what `openWindow` and `client.navigate`
 * accept, so the function's guarantee is one sentence: an http(s) URL on our
 * own origin, always.
 *
 * @param rawData `event.notification.data`, whatever it turns out to be
 * @param origin `self.location.origin`
 * @returns an absolute http(s) href that is always on `origin`
 */
export function resolveNotificationUrl(rawData: unknown, origin: string): string {
  const requested =
    typeof rawData === 'object' &&
    rawData !== null &&
    typeof (rawData as { url?: unknown }).url === 'string'
      ? (rawData as { url: string }).url
      : REMINDER_FALLBACK.url

  const root = new URL('/', origin).href

  let target: URL
  try {
    target = new URL(requested, origin)
  } catch {
    // `new URL` throws on input the parser cannot make sense of at all. The
    // app's root is always a safe answer.
    return root
  }

  const sameOrigin = target.origin === origin
  const navigable = target.protocol === 'https:' || target.protocol === 'http:'
  return sameOrigin && navigable ? target.href : root
}
