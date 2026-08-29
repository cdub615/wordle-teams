import { cacheNames } from 'workbox-core'

/**
 * The service worker's cache eviction decision, lifted out of src/sw.ts so it
 * can be tested.
 *
 * WHY IT IS HERE AND NOT INLINE IN sw.ts: sw.ts runs `precacheAndRoute`,
 * `registerRoute` and four `addEventListener` calls at module scope, against
 * globals that only exist inside a service worker. Importing it from a test
 * would execute all of that. The repo already has this pattern and says so in
 * vitest.config.ts — "anything worth asserting is lifted into scripts/lib" —
 * and scripts/lib/copy-filters.mjs exists for exactly the same reason. These
 * two functions are pure and take everything they need as arguments, so the
 * eviction rule is an assertion in sw-caches.test.ts rather than a claim in a
 * comment.
 */

/**
 * The caches Workbox itself owns, ASKED OF WORKBOX rather than guessed.
 *
 * workbox-core builds each name as `prefix-detail-suffix`, where prefix
 * defaults to `workbox` and suffix is `registration.scope`. Reading them back
 * through `cacheNames` is what makes "delete everything else" safe: a
 * hand-written predicate would be a second, independent guess about a naming
 * scheme this module does not own.
 *
 * A FUNCTION, NOT A CONSTANT, because `cacheNames`' members are getters and the
 * scope suffix is only meaningful once the worker is running.
 */
export function workboxOwnedCacheNames(): string[] {
  return [cacheNames.precache, cacheNames.runtime, cacheNames.googleAnalytics]
}

/**
 * Everything in Cache Storage that Workbox did not create — which, on a browser
 * upgrading from v1, is the whole of serwist's leftovers.
 *
 * THE OBVIOUS PREDICATE IS WRONG IN BOTH DIRECTIONS, and it is worth writing
 * down which, because it was in the plan for this task.
 * `!name.startsWith('workbox-') && !name.includes('precache')` would:
 *   - SPARE serwist's precache forever. serwist 9.2.1 builds cache names with
 *     prefix `serwist` and precache detail `precache-v2`
 *     (serwist/dist/chunks/waitUntil.js), so v1's is literally
 *     `serwist-precache-v2-<scope>` — the single largest cache this eviction
 *     exists to remove, and `!name.includes('precache')` is false for it.
 *   - keep OUR precache only by luck, because workbox's default prefix happens
 *     to be `workbox`. One `cacheNames.updateDetails` call anywhere and the
 *     worker would delete its own precache on every activate.
 * Both are pinned in sw-caches.test.ts.
 */
export function staleCacheNames(existing: readonly string[], owned: readonly string[]): string[] {
  const keep = new Set(owned)
  return existing.filter((name) => !keep.has(name))
}
