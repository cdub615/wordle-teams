/**
 * Wordle Teams' service worker.
 *
 * NOT BUILT BY VITE. `vite build` never sees this file. `scripts/build-sw.mjs`
 * bundles it with esbuild and then injects the precache manifest with
 * workbox-build's `injectManifest`, writing dist/client/sw.js — see that script
 * for why vite-plugin-pwa cannot work in this repo (spike S3) and for the four
 * assertions that stop the build going green when nothing was emitted.
 *
 * IT MUST LAND AT THE ROOT of the served origin. A service worker can only
 * control paths at or below the path it is served from, so dist/client/sw.js
 * gives scope `/` and dist/client/assets/sw.js would give scope `/assets/` and
 * control nothing anyone visits. That is a correctness requirement, not a
 * preference, and build-sw.mjs asserts the path.
 *
 * TYPING: THIS FILE NAMES NO AMBIENT SERVICE-WORKER TYPE, ON PURPOSE.
 * tsconfig.json's `lib` is ES2022/DOM/DOM.Iterable — no "webworker" — and its
 * `types` array pulls in worker-configuration.d.ts, which declares Cloudflare's
 * OWN global `ServiceWorkerGlobalScope` (a Workers runtime scope, not a browser
 * one) and `declare const self: ServiceWorkerGlobalScope`. Riding that ambient
 * type gets the wrong shape in ways that bite: Cloudflare's `CacheStorage` has
 * `open` and `default` but no `keys()`, which is exactly the call the eviction
 * below is built on, and its `addEventListener` is keyed to Workers events, so
 * 'push' and 'notificationclick' are not assignable. Adding "webworker" to
 * `lib` was the alternative and was rejected: tsconfig.json is project-wide,
 * every `.ts`/`.tsx` file compiles under it, and lib.webworker and lib.dom
 * redeclare hundreds of the same names. So the browser globals this file
 * actually touches are declared locally and minimally, below. Nothing is
 * widened, nothing is `any`, and `pnpm typecheck` and `pnpm lint` both hold.
 */
import { cacheNames } from 'workbox-core'
import { matchPrecache, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

const OFFLINE_URL = '/offline.html'

/**
 * public/wt-icon-192x192.png — a file that EXISTS. v1's worker pointed `icon`
 * at /icon.png and `badge` at /badge.png, both marked TODO and neither ever
 * added to public/, so every notification it ever rendered fell back to the
 * browser's generic icon.
 */
const NOTIFICATION_ICON = '/wt-icon-192x192.png'

/**
 * There is no purpose-made monochrome badge asset, and a badge is rendered as a
 * silhouette on Android. This is the app icon at the badge's rough size, so it
 * shows as a filled circle rather than as Chrome's own logo. Replace it if a
 * flat single-colour mark is ever drawn; do not point it at a file that is not
 * in public/.
 */
const NOTIFICATION_BADGE = '/wt-icon-144x144.png'

// ---------------------------------------------------------------------------
// Local declarations of the browser service-worker globals this file uses.
// See the TYPING note above for why these are not imported from a lib.
// ---------------------------------------------------------------------------

interface SwExtendableEvent {
  waitUntil(promise: Promise<unknown>): void
}

interface SwPushEvent extends SwExtendableEvent {
  readonly data: { json(): unknown; text(): string } | null
}

interface SwNotificationEvent extends SwExtendableEvent {
  readonly notification: { close(): void; readonly data: unknown }
}

interface SwWindowClient {
  readonly url: string
  focus(): Promise<SwWindowClient>
  navigate(url: string): Promise<SwWindowClient | null>
}

interface SwNotificationOptions {
  body?: string
  icon?: string
  badge?: string
  data?: unknown
}

declare const self: {
  __WB_MANIFEST: Array<PrecacheEntry | string>
  readonly location: { readonly origin: string }
  readonly registration: {
    showNotification(title: string, options?: SwNotificationOptions): Promise<void>
  }
  readonly clients: {
    claim(): Promise<void>
    matchAll(options?: {
      type?: 'window'
      includeUncontrolled?: boolean
    }): Promise<SwWindowClient[]>
    openWindow(url: string): Promise<SwWindowClient | null>
  }
  readonly caches: {
    keys(): Promise<string[]>
    delete(cacheName: string): Promise<boolean>
  }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: SwExtendableEvent) => void): void
  addEventListener(type: 'push', listener: (event: SwPushEvent) => void): void
  addEventListener(
    type: 'notificationclick',
    listener: (event: SwNotificationEvent) => void,
  ): void
}

// ---------------------------------------------------------------------------
// 1. Precache the static build output.
// ---------------------------------------------------------------------------

/**
 * `self.__WB_MANIFEST` is a PLACEHOLDER STRING, not a real global. esbuild
 * leaves it alone (it mangles no properties by default) and workbox-build's
 * `injectManifest` string-replaces it with the hashed manifest afterwards.
 * build-sw.mjs fails the build if that replacement did not happen or produced
 * zero entries, because the failure it is guarding against — S3's — was silent.
 */
precacheAndRoute(self.__WB_MANIFEST)

// ---------------------------------------------------------------------------
// 2. Navigations are NEVER cached. Offline gets the precached offline page.
// ---------------------------------------------------------------------------

/**
 * The last resort behind the last resort. `matchPrecache` returns
 * `Response | undefined`, and undefined is reachable in the real world — a user
 * clearing site data, storage eviction under pressure, an install that failed
 * partway. Letting undefined fall through would hand the browser its own error
 * page at the one moment nobody is watching, so there is something to render
 * either way. Kept to a few lines deliberately: this is not a second copy of
 * offline.html to maintain, it is the message that survives when the cache does
 * not.
 */
const OFFLINE_FALLBACK_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline &middot; Wordle Teams</title></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0a0a0a;color:#fafafa;font-family:system-ui,sans-serif;text-align:center;padding:1.5rem"><main><h1 style="font-size:1.5rem;margin:0 0 .75rem">You&rsquo;re offline</h1><p style="margin:0;color:#a1a1aa">Wordle Teams needs a connection. Your scores are safe on the server &mdash; reconnect and reload.</p></main></body></html>`

/**
 * WHY NetworkOnly AND NOT NetworkFirst, StaleWhileRevalidate, OR ANYTHING THAT
 * WRITES: v1 got this wrong and it was measured (wordle-teams-bpt). serwist's
 * `defaultCache` matches its HTML rule on the REQUEST's Content-Type, which a
 * navigation GET never sends, so that rule was dead code and every same-origin
 * document fell through to a NetworkFirst catch-all writing into a cache named
 * `others`. One person's rendered /me dashboard then sat in Cache Storage for
 * up to 24 hours and could be served to the NEXT person on a shared device,
 * after sign-out. Nothing here is cacheable anyway: every screen reads live
 * Convex data, so a cached document is stale the instant it is written.
 *
 * NavigationRoute matches on `request.mode === 'navigate'`, which is a property
 * of the request itself and cannot be absent the way a header can.
 *
 * THE FALLBACK USES `matchPrecache`, NOT `caches.match`. Workbox stores each
 * precached entry under a REVISIONED cache key —
 * `/offline.html?__WB_REVISION__=<hash>` — so `caches.match('/offline.html')`
 * misses, returns undefined, and the user gets the browser's error page. That
 * failure only appears when offline, which is precisely when nobody is looking.
 * `matchPrecache` resolves the revisioned key from the precache manifest.
 */
registerRoute(
  new NavigationRoute(
    new NetworkOnly({
      plugins: [
        {
          handlerDidError: async () => {
            const precached = await matchPrecache(OFFLINE_URL)
            if (precached) return precached
            return new Response(OFFLINE_FALLBACK_HTML, {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            })
          },
        },
      ],
    }),
  ),
)

// ---------------------------------------------------------------------------
// 3. Push notifications.
// ---------------------------------------------------------------------------

interface ReminderPayload {
  title: string
  body: string
  url: string
}

/**
 * The one payload this app sends, from convex/pushSend.ts:
 *   { title: 'Wordle Teams', body: "You have not entered today's board yet…",
 *     url: '/' }
 *
 * Parsed defensively anyway. `event.data.json()` THROWS on a non-JSON body, and
 * v1's `event.data?.json() ?? {}` did not catch that — `??` only guards a null
 * `data`, not a parse failure — so a malformed or empty push would kill the
 * handler and show nothing at all. A push event that produces no notification
 * is also a visible penalty in Chrome, which shows its own "This site has been
 * updated in the background" notice, so silently swallowing it is not an
 * option: we always show something.
 */
function readReminder(event: SwPushEvent): ReminderPayload {
  const fallback: ReminderPayload = {
    title: 'Wordle Teams',
    body: "You have not entered today's board yet. Don't miss out on those points!",
    url: '/',
  }

  if (!event.data) return fallback

  let parsed: unknown
  try {
    parsed = event.data.json()
  } catch {
    return fallback
  }

  if (typeof parsed !== 'object' || parsed === null) return fallback
  const data = parsed as Partial<Record<keyof ReminderPayload, unknown>>

  return {
    title: typeof data.title === 'string' && data.title ? data.title : fallback.title,
    body: typeof data.body === 'string' && data.body ? data.body : fallback.body,
    url: typeof data.url === 'string' && data.url ? data.url : fallback.url,
  }
}

self.addEventListener('push', (event) => {
  const { title, body, url } = readReminder(event)
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      // Carried through to the click handler so the destination is the sender's
      // choice, not a constant hardcoded in two places.
      data: { url },
    }),
  )
})

/**
 * FOCUS AN OPEN TAB RATHER THAN OPENING A SECOND ONE. v1 called
 * `clients.openWindow('/')` unconditionally, so tapping the reminder while the
 * app was already open left the user with two copies of it — and on a phone in
 * standalone mode that is two app windows, which is worse than it sounds.
 *
 * `includeUncontrolled: true` matters on the FIRST visit after this worker
 * installs: `clients.claim()` below fixes it going forward, but a tab loaded
 * before this worker activated is not controlled by it, and without this flag
 * `matchAll` would not see it and we would open a duplicate anyway.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data
  const requested =
    typeof data === 'object' && data !== null && typeof (data as { url?: unknown }).url === 'string'
      ? (data as { url: string }).url
      : '/'

  event.waitUntil(
    (async () => {
      const target = new URL(requested, self.location.origin)

      // Only ever our own origin. `requested` arrives from a push payload,
      // which is signed but still remote input; navigating a client to an
      // arbitrary origin on its say-so is not something to leave open.
      if (target.origin !== self.location.origin) {
        target.href = self.location.origin + '/'
      }

      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue
        await client.focus()
        if (client.url !== target.href) {
          // `navigate` needs the client to be controlled by this worker and
          // rejects if it is not — which is exactly the uncontrolled first-visit
          // tab above. A focused tab on the wrong page beats an unhandled
          // rejection, so the failure is absorbed.
          try {
            await client.navigate(target.href)
          } catch {
            // Focused, not navigated. Good enough.
          }
        }
        return
      }

      await self.clients.openWindow(target.href)
    })(),
  )
})

// ---------------------------------------------------------------------------
// 4. Install/activate: take over immediately, and evict serwist.
// ---------------------------------------------------------------------------

/**
 * THE SERWIST KILL SWITCH.
 *
 * v1 registers a serwist-built worker at /sw.js, and this one is served from
 * the same path. At cutover the domain points at the Worker, the browser
 * byte-compares the script it fetches against the one it has, finds it
 * different, and installs this one. Without skipWaiting + clients.claim() that
 * takeover needs every tab closed first, so a returning user would keep
 * serwist's behaviour — including its cached documents — for two more visits.
 *
 * Deleting the caches we do not own is the other half. serwist's `defaultCache`
 * leaves behind `others`, `pages-*`, `apis`, `static-*` and a
 * `serwist-precache-v2-<scope>`, and nothing else will ever clear them: the
 * code that created them is gone.
 *
 * THE KEEP-SET IS DERIVED FROM WORKBOX, NOT GUESSED. `cacheNames` is
 * workbox-core's own accessor for the three caches it owns, built from its
 * prefix/suffix details (`workbox-precache-v2-<scope>`,
 * `workbox-runtime-<scope>`, `workbox-googleAnalytics-<scope>`). Reading them
 * from the library is what makes "delete everything else" safe.
 *
 * A PREDICATE LIKE `!name.startsWith('workbox-') && !name.includes('precache')`
 * WOULD BE WRONG IN BOTH DIRECTIONS, and I checked serwist's source rather than
 * assuming: serwist 9.2.1 builds its cache names with prefix `serwist` and
 * precache detail `precache-v2` (serwist/dist/chunks/waitUntil.js), so v1's
 * precache is literally named `serwist-precache-v2-https://wordleteams.com/`.
 * `!name.includes('precache')` is false for it, so the single largest cache
 * this switch exists to remove would be SPARED forever. In the other direction
 * the predicate is only accidentally safe for our own precache: it survives
 * because workbox's default prefix happens to be `workbox`, and one call to
 * `cacheNames.updateDetails` anywhere would turn it into a worker that deletes
 * its own precache on every activate.
 */
self.addEventListener('install', () => {
  // Does NOT cut precaching short. skipWaiting only skips the WAITING phase,
  // which begins after `install` and all of its waitUntil promises — including
  // workbox's own precache population — have settled.
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([
        cacheNames.precache,
        cacheNames.runtime,
        cacheNames.googleAnalytics,
      ])

      const existing = await self.caches.keys()
      await Promise.all(
        existing.filter((name) => !keep.has(name)).map((name) => self.caches.delete(name)),
      )

      // After the eviction, so the first controlled fetch cannot race a cache
      // that is halfway deleted.
      await self.clients.claim()
    })(),
  )
})
