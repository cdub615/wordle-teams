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
import { matchPrecache, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'
// RELATIVE, NOT THE `#/` ALIAS THE REST OF src/ USES, AND DELIBERATELY SO.
// This is the one file under src/ that vite never sees: scripts/build-sw.mjs
// bundles it with esbuild, which resolves imports on its own and does not read
// vite.config.ts. A relative specifier is resolved identically by both, so it
// keeps working whichever tool picks the file up. Do not "tidy" these to `#/`
// along with the rest of src/ without checking that esbuild still resolves them.
import { cachesToEvict } from './lib/sw-caches.ts'
import { readReminder, resolveNotificationUrl } from './lib/sw-push.ts'

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
    // Optional because it is absent on browsers without navigation preload,
    // and the activate handler must not throw there.
    readonly navigationPreload?: { disable(): Promise<void> }
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

/**
 * PUSH INPUT PARSING AND URL CLAMPING LIVE IN ./lib/sw-push.ts, lifted out for
 * the same reason as ./lib/sw-caches.ts: nothing can import this file, so
 * nothing here can be tested. Those two functions are the only place the app
 * handles remote input, and one of them decides where to navigate a browser —
 * src/lib/sw-push.test.ts pins both, including the origin clamp.
 *
 * The payload convex/pushSend.ts sends is
 *   { title: 'Wordle Teams', body: "You have not entered today's board yet…",
 *     url: '/app' }
 * and sw-push.ts's REMINDER_FALLBACK duplicates it verbatim for the case where
 * the body cannot be parsed. Its test asserts the two are byte-identical, so
 * the "CHANGE BOTH" note on each side is enforced rather than merely written.
 */
self.addEventListener('push', (event) => {
  const { title, body, url } = readReminder(event.data)
  event.waitUntil(
    self.registration
      .showNotification(title, {
        body,
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE,
        // Carried through to the click handler so the destination is the
        // sender's choice, not a constant hardcoded in two places.
        data: { url },
      })
      // A rejected waitUntil does not crash the worker, but it does surface as
      // an unhandled rejection in the service worker console and tells us
      // nothing. There is no recovery — the notification permission was
      // revoked, or the platform refused — so this only makes the failure
      // legible.
      .catch((error: unknown) => {
        console.warn('[sw] showNotification failed', error)
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
 *
 * EVERY STEP IS BRACKETED, because the failure mode of this handler is that THE
 * TAP DOES NOTHING. A rejection inside waitUntil is invisible: no crash, no
 * error surface, just a notification that vanishes and no window. So a failure
 * to enumerate or focus falls through to `openWindow` rather than aborting, and
 * `openWindow` itself is bracketed so the reason at least reaches the console.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  event.waitUntil(
    (async () => {
      // Always an http(s) URL on our own origin — see resolveNotificationUrl.
      const target = resolveNotificationUrl(event.notification.data, self.location.origin)
      let handled = false

      try {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

        for (const client of windows) {
          if (new URL(client.url).origin !== self.location.origin) continue

          await client.focus()
          // Set as soon as focus succeeds, so a later navigate failure cannot
          // cause a SECOND window to be opened on top of the one now focused.
          handled = true

          if (client.url !== target) {
            // `navigate` needs the client to be controlled by this worker and
            // rejects if it is not — which is exactly the uncontrolled
            // first-visit tab above. A focused tab on the wrong page beats an
            // unhandled rejection.
            try {
              await client.navigate(target)
            } catch {
              // Focused, not navigated. Good enough.
            }
          }
          break
        }
      } catch (error) {
        // matchAll or focus failed. Fall through to openWindow: a new window is
        // a worse outcome than reusing one, and a far better outcome than the
        // tap doing nothing at all.
        console.warn('[sw] notificationclick: could not reuse an open window', error)
      }

      if (handled) return

      try {
        await self.clients.openWindow(target)
      } catch (error) {
        console.warn('[sw] notificationclick: openWindow failed', error)
      }
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
 * Deleting the caches we do not own is the second half. serwist's
 * `defaultCache` leaves behind `others`, `pages-*`, `apis`, `static-*` and a
 * `serwist-precache-v2-<scope>`, and nothing else will ever clear them: the
 * code that created them is gone.
 *
 * NAVIGATION PRELOAD IS THE THIRD HALF, and it is the one that is easy to miss
 * because it is not in Cache Storage at all. v1's sw.ts constructs
 * `new Serwist({ …, navigationPreload: true })`, and serwist's constructor then
 * calls `enableNavigationPreload()`, which registers its own activate listener
 * calling `self.registration.navigationPreload.enable()` (verified in
 * serwist/dist/index.js and dist/chunks/printInstallDetails.js). Preload is
 * STATE ON THE REGISTRATION, not on the worker script, so it survives the
 * byte-compare update at cutover and outlives the code that switched it on.
 *
 * WHAT IT DOES *NOT* CAUSE, because the obvious claim is wrong and I checked:
 * it does not produce a second, discarded document request. workbox-strategies'
 * StrategyHandler.fetch consumes `event.preloadResponse` for any request whose
 * mode is 'navigate' (StrategyHandler.js:123-127, and present verbatim in our
 * built dist/client/sw.js), so a preloaded response would be used, not thrown
 * away, and Chrome's "preload request was cancelled" warning does not appear.
 *
 * It is disabled anyway, for a smaller and more honest reason: it is leftover
 * state from a worker that no longer exists, and leaving it makes v1 upgraders
 * behave differently from everyone else running identical code. That divergence
 * is invisible until something depends on it — and this worker's whole job is
 * to leave every browser in the same state.
 *
 * THE KEEP-SET IS DERIVED FROM WORKBOX, NOT GUESSED, and both halves of that
 * decision live in ./lib/sw-caches.ts — lifted out of this file because
 * everything here runs at module scope against service-worker globals, so a
 * test could not import it. src/lib/sw-caches.test.ts pins the rule, including
 * the two ways the obvious hand-written predicate gets it wrong.
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
      const stale = cachesToEvict(await self.caches.keys())
      await Promise.all(stale.map((name) => self.caches.delete(name)))

      // Guarded: `navigationPreload` is absent on browsers that do not support
      // it, and a throw here would abort the activate handler AFTER the cache
      // eviction above but BEFORE clients.claim() below — leaving the takeover
      // half-done. Nothing depends on the disable succeeding.
      try {
        await self.registration.navigationPreload?.disable()
      } catch (error) {
        console.warn('[sw] could not disable navigation preload', error)
      }

      // After the eviction, so the first controlled fetch cannot race a cache
      // that is halfway deleted.
      await self.clients.claim()
    })(),
  )
})
