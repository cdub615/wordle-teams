// Stub for spike S3. Task 13 replaces this entirely.
//
// `ServiceWorkerGlobalScope` is NOT the browser/WebWorker-lib type here: this
// tsconfig has no "webworker" lib (only ES2022, DOM, DOM.Iterable) and its
// `types` array includes worker-configuration.d.ts (from `wrangler types`),
// which declares its OWN global `interface ServiceWorkerGlobalScope` and
// `declare const self: ServiceWorkerGlobalScope` for the Cloudflare Worker
// runtime. Naming that type here resolves to Cloudflare's flavor, which has
// no `__WB_MANIFEST` — so it's extended locally rather than assumed to be
// workbox/browser-shaped. Task 13 should decide deliberately whether to keep
// riding Cloudflare's ambient type or bring in "webworker" lib for this file.
import { precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>
}

precacheAndRoute(self.__WB_MANIFEST)
