import { cacheNames } from 'workbox-core'
import { describe, expect, test } from 'vitest'
import { staleCacheNames, workboxOwnedCacheNames } from './sw-caches.ts'

/**
 * The serwist kill switch, pinned.
 *
 * At cutover the domain moves to the Worker and the browser installs this
 * worker over v1's serwist one at the same /sw.js path. The activate handler
 * then deletes every cache Workbox does not own — which is the only thing that
 * will ever clear serwist's, because the code that created them is gone.
 *
 * Getting the keep-set wrong is silent in both directions: too wide and v1's
 * cached documents survive (including the rendered dashboards of
 * wordle-teams-bpt), too narrow and the worker deletes its own precache on
 * every activate and refetches the whole bundle. Neither shows up in a build.
 *
 * The serwist names below are not invented for the test. They are what serwist
 * 9.2.1 produces: `_cacheNameDetails` in serwist/dist/chunks/waitUntil.js sets
 * prefix `serwist`, precache `precache-v2`, runtime `runtime`, suffix
 * `registration.scope`; the flat names come from @serwist/next's `defaultCache`
 * (dist/index.worker.js), which v1's sw.ts passes as `runtimeCaching`.
 */

const SCOPE = 'https://wordleteams.com/'

/** Exactly what a v1 browser has in Cache Storage. */
const SERWIST_LEFTOVERS = [
  `serwist-precache-v2-${SCOPE}`,
  `serwist-runtime-${SCOPE}`,
  'others',
  'pages-rsc',
  'pages-rsc-prefetch',
  'pages',
  'apis',
  'static-image-assets',
  'static-js-assets',
  'static-style-assets',
  'next-static-js-assets',
  'next-data',
  'cross-origin',
  'google-fonts-webfonts',
]

describe('workboxOwnedCacheNames', () => {
  test('is derived from workbox-core, not restated', () => {
    // If this ever drifts, the eviction is deleting a cache Workbox is still
    // writing to. Compared against the library's own accessor rather than
    // against literals, which is the entire point of the function.
    expect(workboxOwnedCacheNames()).toEqual([
      cacheNames.precache,
      cacheNames.runtime,
      cacheNames.googleAnalytics,
    ])
  })

  test('covers every cache workbox-core exposes a name for', () => {
    // `prefix` and `suffix` are components, not caches. If a future workbox
    // adds a fourth real cache, this fails and the keep-set gets updated
    // deliberately instead of the new cache being silently deleted on activate.
    const componentKeys = ['prefix', 'suffix']
    const cacheKeys = Object.keys(cacheNames).filter((k) => !componentKeys.includes(k))
    expect(cacheKeys.sort()).toEqual(['googleAnalytics', 'precache', 'runtime'])
  })
})

describe('staleCacheNames', () => {
  const owned = [
    `workbox-precache-v2-${SCOPE}`,
    `workbox-runtime-${SCOPE}`,
    `workbox-googleAnalytics-${SCOPE}`,
  ]

  test('deletes every serwist cache, including its PRECACHE', () => {
    const stale = staleCacheNames([...SERWIST_LEFTOVERS, ...owned], owned)
    expect(stale).toEqual(SERWIST_LEFTOVERS)

    // Called out on its own because the predicate in this task's plan —
    // `!name.startsWith('workbox-') && !name.includes('precache')` — evaluates
    // FALSE for this name and would have spared it forever.
    expect(stale).toContain(`serwist-precache-v2-${SCOPE}`)
  })

  test('keeps all three of workbox’s own caches', () => {
    // The catastrophic direction: deleting our own precache on every activate.
    expect(staleCacheNames(owned, owned)).toEqual([])
  })

  test('keeps them even when the prefix is not "workbox"', () => {
    // `cacheNames.updateDetails({ prefix: 'wt' })` is a supported workbox call.
    // A `startsWith('workbox-')` predicate would delete all three here; a
    // keep-set derived from the library survives it. This is what "derived, not
    // guessed" buys.
    const renamed = [`wt-precache-v2-${SCOPE}`, `wt-runtime-${SCOPE}`, `wt-googleAnalytics-${SCOPE}`]
    expect(staleCacheNames([...renamed, 'others'], renamed)).toEqual(['others'])
  })

  test('leaves nothing behind when the browser is empty, and never invents work', () => {
    expect(staleCacheNames([], owned)).toEqual([])
  })

  test('deletes a cache no one recognises', () => {
    // An abandoned experiment, or a cache from a previous framework. Anything
    // this worker did not create is not this worker's to keep alive.
    expect(staleCacheNames([...owned, 'some-old-thing'], owned)).toEqual(['some-old-thing'])
  })
})
