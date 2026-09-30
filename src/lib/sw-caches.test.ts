import { cacheNames, setCacheNameDetails } from 'workbox-core'
import { beforeEach, describe, expect, test } from 'vitest'
import { cachesToEvict, workboxOwnedCacheNames } from './sw-caches.ts'

/**
 * The serwist kill switch, pinned.
 *
 * At cutover the domain moves to the Worker and the browser installs this
 * worker over v1's serwist one at the same /sw.js path. The activate handler
 * then deletes every cache Workbox does not own — the only thing that will ever
 * clear serwist's, because the code that created them is gone.
 *
 * Getting the keep-set wrong is silent in both directions: too wide and v1's
 * cached documents survive (including the rendered dashboards of
 * wordle-teams-bpt), too narrow and the worker deletes its own precache on
 * every activate and refetches the whole ~1 MB precache each time. Neither
 * shows up in a build.
 *
 * ══ WHY THE SUFFIX SETUP BELOW IS LOAD-BEARING ══
 * The first version of this suite was a FALSE GREEN on its central claim.
 * Under vitest there is no `registration` global, so `cacheNames.suffix` is ''
 * and workbox's `_createCacheName` filters the empty segment out. The derived
 * names therefore collapse to `workbox-precache-v2` etc. — exactly the strings
 * a hardcoded keep-set would return — so a mutant that replaced
 * `workboxOwnedCacheNames`' body with those three literals passed all seven
 * tests, while in a real worker (where suffix IS registration.scope) it would
 * match nothing and delete our own precache on every activation.
 *
 * `setCacheNameDetails({ suffix: SCOPE })` gives the suite the scope a real
 * worker has, which is what makes derived and hardcoded distinguishable. Every
 * expectation below is written against SCOPE-bearing names for that reason.
 *
 * The serwist names are not invented for the test either: `_cacheNameDetails`
 * in serwist/dist/chunks/waitUntil.js sets prefix `serwist`, precache
 * `precache-v2`, runtime `runtime`, suffix `registration.scope`; the flat names
 * come from @serwist/next's `defaultCache` (dist/index.worker.js), which v1's
 * sw.ts passes as `runtimeCaching`.
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

const OWNED = [
  `workbox-precache-v2-${SCOPE}`,
  `workbox-runtime-${SCOPE}`,
  `workbox-googleAnalytics-${SCOPE}`,
]

beforeEach(() => {
  // Reset BOTH, every test: `setCacheNameDetails` mutates module state, and the
  // prefix test below changes it deliberately.
  setCacheNameDetails({ prefix: 'workbox', suffix: SCOPE })
})

describe('workboxOwnedCacheNames', () => {
  test('returns the SCOPED names a real worker actually has', () => {
    // THE MUTATION KILLER. Hardcoded literals return the unscoped forms and
    // fail here. Written as exact strings rather than as a comparison against
    // `cacheNames`, because comparing the function to the accessor it calls is
    // what made the first version of this suite vacuous.
    expect(workboxOwnedCacheNames()).toEqual(OWNED)
  })

  test('every returned name carries the registration scope', () => {
    // The property that fails for ANY hardcoded or scope-blind implementation,
    // stated independently of the exact prefix and detail strings.
    for (const name of workboxOwnedCacheNames()) {
      expect(name.endsWith(SCOPE)).toBe(true)
    }
  })

  test('tracks workbox when the naming details change', () => {
    // Derivation, demonstrated: a rename flows through without this module
    // being touched. A hardcoded keep-set cannot do this, and neither can a
    // `startsWith('workbox-')` predicate.
    setCacheNameDetails({ prefix: 'wt' })
    expect(workboxOwnedCacheNames()).toEqual([
      `wt-precache-v2-${SCOPE}`,
      `wt-runtime-${SCOPE}`,
      `wt-googleAnalytics-${SCOPE}`,
    ])
  })

  test('is exactly the set of caches workbox-core exposes a name for', () => {
    // `prefix` and `suffix` are components, not caches. If a future workbox
    // adds a fourth real cache, this fails and the keep-set gets updated
    // deliberately instead of the new cache being silently deleted on activate.
    const componentKeys = ['prefix', 'suffix']
    const cacheKeys = Object.keys(cacheNames).filter((k) => !componentKeys.includes(k))
    expect(cacheKeys.sort()).toEqual(['googleAnalytics', 'precache', 'runtime'])
    expect(workboxOwnedCacheNames()).toHaveLength(cacheKeys.length)
  })
})

describe('cachesToEvict', () => {
  test('deletes every serwist cache, including its PRECACHE', () => {
    const evict = cachesToEvict([...SERWIST_LEFTOVERS, ...OWNED])
    expect(evict).toEqual(SERWIST_LEFTOVERS)

    // Called out on its own because the predicate in this task's plan —
    // `!name.startsWith('workbox-') && !name.includes('precache')` — evaluates
    // FALSE for this name and would have spared it forever.
    expect(evict).toContain(`serwist-precache-v2-${SCOPE}`)
  })

  test('KEEPS all three of workbox’s own caches', () => {
    // The catastrophic direction: deleting our own precache on every activate,
    // refetching ~1 MB each time. Also the assertion that fails if
    // `workboxOwnedCacheNames` is hardcoded, since then none of these scoped
    // names are in the keep-set.
    expect(cachesToEvict(OWNED)).toEqual([])
  })

  test('keeps them after a prefix change, without being told the new names', () => {
    // The composition under test: `cachesToEvict` derives the keep-set itself.
    // Supplying it as an argument — as an earlier version of this suite did —
    // tested a set difference and nothing else.
    setCacheNameDetails({ prefix: 'wt' })
    const renamed = [
      `wt-precache-v2-${SCOPE}`,
      `wt-runtime-${SCOPE}`,
      `wt-googleAnalytics-${SCOPE}`,
    ]
    expect(cachesToEvict([...renamed, 'others'])).toEqual(['others'])
  })

  test('does not spare a cache that merely looks workbox-ish', () => {
    // An unscoped `workbox-precache-v2` is NOT ours in a real worker — it is
    // what a differently-scoped or older registration left behind. A
    // `startsWith('workbox-')` predicate would keep it forever.
    expect(cachesToEvict([...OWNED, 'workbox-precache-v2', 'workbox-runtime'])).toEqual([
      'workbox-precache-v2',
      'workbox-runtime',
    ])
  })

  test('returns nothing for an empty browser, and never invents work', () => {
    expect(cachesToEvict([])).toEqual([])
  })

  test('deletes a cache no one recognises', () => {
    // An abandoned experiment, or a cache from a previous framework. Anything
    // this worker did not create is not this worker's to keep alive.
    expect(cachesToEvict([...OWNED, 'some-old-thing'])).toEqual(['some-old-thing'])
  })
})
