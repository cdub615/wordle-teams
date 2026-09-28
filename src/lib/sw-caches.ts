import { cacheNames } from 'workbox-core'

/**
 * The service worker's cache eviction decision, lifted out of src/sw.ts so it
 * can be tested.
 *
 * WHY IT IS HERE AND NOT INLINE IN sw.ts: sw.ts runs `precacheAndRoute`,
 * `registerRoute` and five `addEventListener` calls at module scope against
 * globals that only exist inside a service worker, so importing it from a test
 * would execute all of that. Lifting the pure part out is the pattern this repo
 * already uses for the same reason — see scripts/lib/copy-filters.mjs, and the
 * note in vitest.config.ts, which spells out that the rule is "a test must not
 * trigger the module's side effects" rather than "everything must live in a lib
 * directory".
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
 *
 * TESTING THIS IS SUBTLER THAN IT LOOKS, and the first version of its test was
 * a false green: under vitest there is no `registration`, so `cacheNames.suffix`
 * is '' and workbox's `_createCacheName` filters the empty segment out — which
 * makes the derived names collapse to exactly the literals a re-hardcoded
 * version would return. Replacing this body with
 * `['workbox-precache-v2', 'workbox-runtime', 'workbox-googleAnalytics']`
 * passed all seven tests, while in a real worker it would match nothing in
 * `caches.keys()` and delete our own precache on every activate. sw-caches.test.ts
 * now sets a non-empty suffix through `setCacheNameDetails` so the two are
 * distinguishable, and that mutant is red.
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
 *     to be `workbox`. One `setCacheNameDetails({ prefix })` call anywhere and
 *     the worker would delete its own precache on every activate.
 * Both are pinned in sw-caches.test.ts.
 */
function staleCacheNames(existing: readonly string[], owned: readonly string[]): string[] {
  const keep = new Set(owned)
  return existing.filter((name) => !keep.has(name))
}

/**
 * THE WHOLE DECISION, in one call: given what Cache Storage currently holds,
 * which entries should the activate handler delete.
 *
 * sw.ts calls only this. The composition — "the keep-set is the DERIVED one,
 * not something the caller supplies" — is the part that actually has to be
 * right, and keeping it here rather than in sw.ts is what puts it under test.
 * `staleCacheNames` on its own is a set difference and could not go wrong;
 * pairing it with the wrong keep-set is the failure that matters.
 */
export function cachesToEvict(existing: readonly string[]): string[] {
  return staleCacheNames(existing, workboxOwnedCacheNames())
}
