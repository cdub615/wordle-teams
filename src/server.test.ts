import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NO_STORE, STATIC_CACHE } from './lib/cache-policy.ts'
import { MAINTENANCE_PATH } from './lib/maintenance.ts'

/**
 * THE WORKER'S OWN fetch, COMPOSED, NOT THE PIECES IT IS MADE OF.
 *
 * src/lib/maintenance.test.ts proves the two pure functions answer correctly.
 * That is not the same claim as "the Worker consults them", and this phase has
 * been caught by exactly that gap more than once: a config literal that was
 * lifted out of its call into a dead `const` passed all four gates and all 54
 * e2e tests with the feature silently un-wired. v1's own maintenance mode is
 * the extreme case — the code was correct and the file was in the wrong place,
 * so it never ran in production once in the life of the project.
 *
 * So this imports src/server.ts and calls the default export's fetch the way
 * the Workers runtime does. Deleting the gate from server.ts turns this red;
 * so does reordering it behind the cache policy, dropping the try/catch, or
 * redirecting to the wrong path.
 *
 * THE ONE MOCK IS THE START SERVER ENTRY, and it is the only thing that has to
 * be faked: it is the app itself, which needs a router, a build and a Convex
 * deployment. Everything the file under test actually does — the Sentry
 * wrappers, the gate, the redirect, the cache policy — is the real code. The
 * mock echoes the pathname it was handed as an HTML document, which is what
 * makes "what did the app get asked to render" observable.
 */
const rendered = vi.hoisted(() => ({
  paths: [] as string[],
  status: 200,
  // Settable, because the content-type guard in server.ts is a real branch:
  // /sitemap.xml and the /api routes are not HTML and skip the document
  // handler entirely. A fixed 'text/html' here would let a test that means to
  // exercise that branch pass without ever reaching it.
  contentType: 'text/html',
}))

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: {
    fetch: (request: Request) => {
      const url = new URL(request.url)
      rendered.paths.push(`${url.pathname}${url.search}`)
      return new Response(`<html>rendered ${url.pathname}</html>`, {
        status: rendered.status,
        headers: { 'content-type': rendered.contentType },
      })
    },
  },
}))

const { default: worker } = await import('./server.ts')

/**
 * waitUntil COLLECTS RATHER THAN DISCARDS, because the edge-cache write happens
 * inside it. A no-op here would let every "it was stored" assertion below race
 * the put and pass or fail on timing. `settle()` is what makes the write
 * observable at a defined point.
 */
const deferred: Promise<unknown>[] = []
const ctx = {
  waitUntil: (promise: Promise<unknown>) => deferred.push(promise),
  passThroughOnException: () => {},
} as unknown as ExecutionContext

/** Wait for everything the Worker handed to waitUntil during this request. */
const settle = async () => {
  await Promise.all(deferred.splice(0))
}

const url = (path: string) => `https://beta.wordleteams.com${path}`

/** One request through the real Worker entry, with the env it would be given. */
const send = (request: Request, env: unknown) =>
  (worker as { fetch: (r: Request, e: unknown, c: ExecutionContext) => Promise<Response> }).fetch(
    request,
    env,
    ctx,
  )

const get = (path: string, env: unknown) => send(new Request(url(path)), env)

/** The single path the app was asked to render for the request just made. */
const renderedPath = () => {
  expect(rendered.paths, 'the app was not rendered exactly once').toHaveLength(1)
  return rendered.paths[0]
}

beforeEach(() => {
  rendered.paths = []
  rendered.status = 200
  rendered.contentType = 'text/html'
  deferred.length = 0
  edgeStore.clear()
  installEdgeCache()
})

/**
 * A REAL MAP BEHIND A FAKE `caches`, not a spy.
 *
 * `caches` does not exist under plain vitest — the test script is `vitest`, not
 * @cloudflare/vitest-pool-workers — so without this the Worker's edgeCacheFor
 * returns null and EVERY assertion below would pass against a handler that
 * caches nothing whatsoever. That is the exact shape of the un-wired-feature
 * bug this file's header describes being caught by more than once, so the store
 * is a real one and the tests read back out of it.
 *
 * Keyed by the key Request's url, which is what the Worker actually varies:
 * the deploy version and the pathname.
 */
const edgeStore = new Map<string, Response>()
const installEdgeCache = (): void => {
  const cache = {
    match: async (key: Request) => edgeStore.get(key.url)?.clone(),
    put: async (key: Request, response: Response) => {
      edgeStore.set(key.url, response)
    },
  }
  ;(globalThis as unknown as { caches: unknown }).caches = { default: cache }
}

/** The env a deployed version is given: a real CF_VERSION_METADATA id. */
const VERSIONED = { CF_VERSION_METADATA: { id: 'v1' } }

describe('the maintenance switch is OFF', () => {
  // Both of the off states, because only one of them is the interesting one.
  for (const [label, env] of [
    ['the var is unset entirely', {}],
    // THE TRAP. Every non-empty string is truthy, so `if (env.MAINTENANCE)`
    // takes the whole site down the moment someone writes the word "false" in
    // the dashboard field meaning to turn it off. This is the case that makes
    // maintenanceEnabled a comparison and not a coercion.
    ['the var says the string "false"', { MAINTENANCE: 'false' }],
    // A MISSING `env` IS NOT LISTED HERE, and the omission is measured rather
    // than assumed: Sentry.withSentry dereferences env.SENTRY_DSN before this
    // file's code runs at all, so the case throws in the SDK and can never
    // reach the gate. The property read below is inside the try either way, so
    // an env that is not an object degrades to "let the request through" — see
    // the failure-path block at the bottom, which is how that is exercised.
  ] as const) {
    test(`${label}: /app renders /app`, async () => {
      const response = await get('/app', env)
      expect(renderedPath()).toBe('/app')
      expect(response.status).toBe(200)
    })
  }

  test('a static page keeps its edge cache when nothing is gated', async () => {
    // Pins that the gate did not displace the cache policy on the way past. A
    // gate that returns early for everything would still pass the case above.
    // One path is enough for THAT claim; the per-page walk is the ON block's
    // 'the static pages are still served' case below.
    const response = await get('/privacy', {})
    expect(renderedPath()).toBe('/privacy')
    expect(response.headers.get('cache-control')).toBe(STATIC_CACHE)
  })
})

describe('the maintenance switch is ON', () => {
  const ON = { MAINTENANCE: 'true' }

  test('/app is answered with a 307 to /maintenance, and no body at all', async () => {
    const response = await get('/app', ON)
    // THE APP IS NEVER ASKED TO RENDER. A gated request is turned around in the
    // Worker, which is the difference between this and v1's rewrite — see the
    // hydration measurement in src/server.ts. `paths` staying empty is the
    // assertion that says so.
    expect(rendered.paths).toEqual([])
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(MAINTENANCE_PATH)
    expect(response.headers.get('location')).toBe('/maintenance')
  })

  test('the redirect is never stored, by any cache, for any length of time', async () => {
    // A REDIRECT CARRIES NO CONTENT-TYPE, so withCachePolicyOnDocuments would
    // have returned it untouched and a browser would have been free to apply
    // heuristic freshness to it — a visitor still being sent to the outage page
    // after the outage, with nothing to invalidate. The header is set on the
    // redirect itself for exactly that reason. `/` is used because it IS in
    // STATIC_DOCUMENTS: if the gate ever moved behind the cache policy this
    // would come back with a day of shared freshness instead.
    const response = await get('/', ON)
    expect(response.status).toBe(307)
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
  })

  test('307 and not a permanent redirect, which would outlive the outage', async () => {
    // A 301 is the one status a browser is entitled to remember forever, and
    // there is no way to take it back. Asserted as an equality on the number
    // rather than `response.redirected`, which cannot tell them apart.
    const response = await get('/me', ON)
    expect(response.status).toBe(307)
  })

  test('a POST to a gated path is turned around too, not only a GET', async () => {
    // MEASURED: adding `request.method === 'GET' &&` to the gate in
    // src/server.ts left every other test in this file green. The gate reads
    // the URL and nothing else, and that is deliberate — a server-function
    // POST is exactly the shape that arrives wanting to WRITE to the app, so
    // it is the one that must not slip past into a dark one while every GET is
    // being turned around. Confirmed against a live `wrangler dev` Worker with
    // --var MAINTENANCE:true as well: POST /app and HEAD /app both answer 307.
    const response = await send(new Request(url('/app'), { method: 'POST' }), ON)
    expect(rendered.paths).toEqual([])
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(MAINTENANCE_PATH)
  })

  test('the query string does not travel to the outage page', async () => {
    // Deliberate, and pinned so it stays deliberate: the path a param belonged
    // to is not what is being rendered any more. `?checkout=success` on the
    // maintenance page is a claim about a dashboard nobody is looking at.
    const response = await get('/app?checkout=success&team=abc', ON)
    expect(response.headers.get('location')).toBe('/maintenance')
  })

  test('the static pages are still served, which is the point of the allowlist', async () => {
    // v1's matcher comment: the legal and marketing pages are "static and
    // render fine while the app is down", and covering them is the WORSE
    // behaviour. Asserted per path rather than in a loop so a failure names the
    // page that went dark.
    for (const path of ['/home', '/about', '/privacy', '/terms', '/login-error']) {
      rendered.paths = []
      const response = await get(path, ON)
      expect(renderedPath(), `${path} was swallowed by maintenance mode`).toBe(path)
      expect(response.status).toBe(200)
    }
  })

  test('/maintenance is served, and does not redirect to itself', async () => {
    // If the redirect target were gated, a browser would follow this Worker in
    // a circle until it gave up. A 200 with the page rendered once is the
    // assertion that the loop does not exist.
    const response = await get(MAINTENANCE_PATH, ON)
    expect(renderedPath()).toBe('/maintenance')
    // A DIRECT request for this path is not the transient case: the page is in
    // STATIC_DOCUMENTS and always renders the same, so it keeps the static
    // policy. This is deliberately DIFFERENT from the 307 that points here,
    // which is `private, no-store`; the pair is what records that the
    // difference is intended and not an oversight in one of the two.
    expect(response.headers.get('cache-control')).toBe(STATIC_CACHE)
  })

  test('the API routes are not handed a web page', async () => {
    // /api/auth/$ is Better Auth's proxy to Convex and /api/funnel takes
    // beacons. fetch() follows a 307 by default, so gating either would answer
    // a JSON call with the outage page's markup — a parse error at the caller
    // rather than an outage notice anybody reads.
    for (const path of ['/api/funnel', '/api/auth/callback/microsoft']) {
      rendered.paths = []
      const response = await get(path, ON)
      expect(renderedPath(), `${path} was turned into a redirect`).toBe(path)
      expect(response.status).toBe(200)
    }
  })

  test('/login is gated too, so nobody spends a passcode to reach a dark app', async () => {
    // The decision recorded in src/lib/maintenance.ts: /login exists to start a
    // session and a session's only destination is /app, which is gated.
    const response = await get('/login', ON)
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(MAINTENANCE_PATH)
  })
})

/**
 * THE STATUS GATE, WHICH LOST ITS ONLY TEST WHEN THIS TASK LANDED.
 *
 * e2e/routes.spec.ts used to assert it by requesting whichever path was in
 * STATIC_DOCUMENTS but had no route yet — /privacy, then /maintenance. Task 7
 * built the last of them, so every listed path answers 200 and that case had to
 * become a 404 on an UNLISTED path, which pins the STATIC_DOCUMENTS lookup
 * instead. The gate itself is unchanged in importance: a transient 5xx on a
 * route that DOES exist would otherwise be published with a day of shared
 * freshness, and `wrangler deploy` purges nothing. Here it is exercised
 * directly, on a path that IS listed, with a status the app chose — which e2e
 * could never arrange. This one also runs in CI, and e2e does not.
 */
describe('only a 200 may be shared', () => {
  for (const status of [404, 500, 503] as const) {
    test(`a ${status} on a listed path is never cached`, async () => {
      rendered.status = status
      const response = await get('/privacy', {})
      expect(response.status).toBe(status)
      expect(response.headers.get('cache-control')).toBe(NO_STORE)
    })
  }

  test('the same path at 200 is the one that gets the edge', async () => {
    // The control. Without it the block above passes on a handler that caches
    // nothing at all, which is the bug the whole cache policy exists to undo.
    const response = await get('/privacy', {})
    expect(response.headers.get('cache-control')).toBe(STATIC_CACHE)
  })
})

describe('the maintenance switch cannot be read', () => {
  test('fails open: the request is served normally, and nothing throws', async () => {
    // v1: "A transient Edge Config or Supabase outage must degrade to 'let the
    // request through', never to a 500." The env here throws on the property
    // read itself, which is the failure a try/catch around a plain lookup
    // exists for and the only way to reach that catch from outside.
    const hostile = {
      get MAINTENANCE(): string {
        throw new Error('binding unavailable')
      },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const response = await get('/app', hostile)
      expect(response.status).toBe(200)
      expect(renderedPath()).toBe('/app')
      // The outage is logged rather than swallowed silently — an unexplained
      // "maintenance mode did nothing" is the shape of bug this file exists for.
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})


/**
 * THE EDGE CACHE (wordle-teams-fqeq).
 *
 * wt-ksh.8.45 measured that `s-maxage` alone reaches nothing: a Worker that
 * renders its own response, with no origin subrequest, is not eligible for the
 * CDN cache, and Cache Rules run ahead of the Worker and cannot reach it. So
 * the header was correct and the edge win was zero. These tests pin the Cache
 * API round-trip that actually buys it.
 *
 * THE DANGEROUS DIRECTION IS SHARING, NOT MISSING, and that is why the four
 * negative cases outnumber the positive one. cache-policy.ts documents, from
 * measurement rather than assumption, that a document rendered for a session
 * carries a bearer JWT in its dehydrated router state — so a write that skips
 * the session check publishes a credential, and a read that skips it hands one
 * to the next visitor.
 */
describe('the edge cache', () => {
  test('an anonymous static document is stored, then served from the store', async () => {
    const first = await get('/about', VERSIONED)
    expect(first.headers.get('x-doc-cache')).toBe('MISS')
    expect(first.headers.get('cache-control')).toBe(STATIC_CACHE)
    expect(renderedPath()).toBe('/about')
    await settle()

    rendered.paths = []
    const second = await get('/about', VERSIONED)
    expect(second.headers.get('x-doc-cache')).toBe('HIT')
    // THE ASSERTION THAT MATTERS. A HIT header on a response the app rendered
    // again would be a lie that still passes every other check here.
    expect(rendered.paths, 'the app was rendered again on a cache hit').toEqual([])
    expect(await second.text()).toBe('<html>rendered /about</html>')
  })

  test('the stored copy says HIT while the live one says MISS', async () => {
    // Pinned rather than trusted: this rests on Response.clone() copying the
    // header list rather than sharing it, and a shared list would make the
    // FIRST response claim HIT — which is precisely the reading that would send
    // someone verifying beta to the wrong conclusion.
    const live = await get('/about', VERSIONED)
    await settle()
    expect(live.headers.get('x-doc-cache')).toBe('MISS')
    expect([...edgeStore.values()][0].headers.get('x-doc-cache')).toBe('HIT')
  })

  test('a signed-in request is neither served from nor written to the cache', async () => {
    // Populate it anonymously first, so "not served from" is a real claim
    // rather than an empty-cache tautology.
    await get('/about', VERSIONED)
    await settle()
    expect(edgeStore.size).toBe(1)

    rendered.paths = []
    const signedIn = await send(
      new Request(url('/about'), { headers: { cookie: 'better-auth.session_token=abc' } }),
      VERSIONED,
    )
    expect(signedIn.headers.get('cache-control')).toBe(NO_STORE)
    expect(signedIn.headers.get('x-doc-cache')).toBeNull()
    // It was RENDERED for them, not handed the shared copy.
    expect(renderedPath()).toBe('/about')
    await settle()
    // And their document did not displace or join the shared one.
    expect(edgeStore.size).toBe(1)
  })

  test('a non-static path is never stored, however anonymous', async () => {
    const response = await get('/app', VERSIONED)
    await settle()
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
    expect(edgeStore.size).toBe(0)
  })

  for (const status of [404, 500] as const) {
    test(`a ${status} on a listed path is not stored`, async () => {
      rendered.status = status
      await get('/privacy', VERSIONED)
      await settle()
      expect(edgeStore.size, 'a non-200 reached the edge').toBe(0)
    })
  }

  test('a query string is never cached, so a bare path cannot be poisoned', async () => {
    // The key is the pathname, so storing /about?x=1 under /about would serve
    // it to the next visitor asking for /about.
    await send(new Request(url('/about?utm_source=x')), VERSIONED)
    await settle()
    expect(edgeStore.size).toBe(0)
  })

  test('without a deploy version nothing is cached at all', async () => {
    // The version IS the invalidation mechanism: `wrangler deploy` purges
    // nothing, so an unversioned key would strand the previous build's pages at
    // the edge with no event able to evict them. Declining is the safe answer.
    const response = await get('/about', {})
    await settle()
    expect(response.headers.get('cache-control')).toBe(STATIC_CACHE)
    expect(response.headers.get('x-doc-cache')).toBeNull()
    expect(edgeStore.size).toBe(0)
  })

  test('a new deploy version does not serve the document the previous one stored', async () => {
    await get('/about', { CF_VERSION_METADATA: { id: 'old' } })
    await settle()
    expect(edgeStore.size).toBe(1)

    rendered.paths = []
    const afterDeploy = await get('/about', { CF_VERSION_METADATA: { id: 'new' } })
    expect(afterDeploy.headers.get('x-doc-cache')).toBe('MISS')
    expect(renderedPath(), 'the new version served a page from the old build').toBe('/about')
  })

  test('a cache that throws degrades to rendering rather than to a 500', async () => {
    // Same posture as the maintenance gate above: the marketing pages must not
    // all fail at once because the cache had a bad day.
    ;(globalThis as unknown as { caches: unknown }).caches = {
      get default(): never {
        throw new Error('cache unavailable')
      },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const response = await get('/about', VERSIONED)
      expect(response.status).toBe(200)
      expect(renderedPath()).toBe('/about')
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})


/**
 * X-Robots-Tag (wt-ksh.8.54).
 *
 * lib/robots-policy.test.ts proves the hostname predicate answers correctly.
 * That is a different claim from "the Worker consults it", which is the gap
 * this file's header exists for and the one that left v1's maintenance mode
 * dead for the life of the project. These tests are about the WIRING, and in
 * particular about the three response shapes that never reach the document
 * handler and would silently miss a header set there.
 *
 * NOTE THAT EVERY OTHER TEST IN THIS FILE REQUESTS A BETA URL, so they are all
 * now exercising the tagged path incidentally. That is not coverage — none of
 * them asserts the header — which is why it is asserted explicitly here.
 */
describe('the staging noindex header', () => {
  const prod = (path: string) => new Request(`https://wordleteams.com${path}`)

  test('a beta document is tagged', async () => {
    const response = await get('/about', VERSIONED)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  test('the SAME request on the production host is NOT tagged', async () => {
    // The control, and the one that matters. Without it every assertion above
    // passes on a Worker that tags unconditionally — which would remove
    // production from search the day the apex is added to this deployment.
    const response = await send(prod('/about'), VERSIONED)
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })

  test('the maintenance redirect is tagged, though it never reaches the document handler', async () => {
    const response = await send(new Request(url('/app')), { MAINTENANCE: 'true' })
    expect(response.status).toBe(307)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  test('a response served from the edge cache is tagged', async () => {
    // A cache hit returns before the document handler runs, so an inner
    // placement would tag the first request and not the second.
    await get('/about', VERSIONED)
    await settle()
    const second = await get('/about', VERSIONED)
    expect(second.headers.get('x-doc-cache')).toBe('HIT')
    expect(second.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  test('a non-HTML response is tagged too', async () => {
    // The content-type guard skips these entirely, and /sitemap.xml is a
    // document a crawler is specifically invited to fetch.
    rendered.contentType = 'application/xml; charset=utf-8'
    try {
      const response = await get('/sitemap.xml', VERSIONED)
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    } finally {
      rendered.contentType = 'text/html'
    }
  })

})


/**
 * REDIRECTS CARRY AN EXPLICIT CACHE POLICY (wordle-teams-d2oc).
 *
 * The content-type guard returns early on anything that is not HTML, and a
 * redirect has no content-type — so these went out with no Cache-Control at
 * all, which is heuristically cacheable rather than neutral. /me is the
 * start_url every v1 PWA install has burned in, so it is re-requested on every
 * launch forever.
 */
describe('a redirect is never left without a cache policy', () => {
  test('an app-route redirect carries no-store', async () => {
    rendered.status = 307
    rendered.contentType = ''
    const response = await get('/me', VERSIONED)
    expect(response.status).toBe(307)
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
  })

  test('the maintenance redirect still carries its policy', async () => {
    /**
     * AN EQUIVALENT MUTANT LIVES HERE, AND IT IS RECORDED RATHER THAN CLAIMED.
     *
     * The branch is guarded on `!headers.has('cache-control')` so it cannot
     * overwrite a policy a redirect already set for itself. Removing that guard
     * changes NOTHING OBSERVABLE today, because the only other redirect writer
     * is the maintenance gate and it writes the same NO_STORE — verified by
     * mutation, which survived.
     *
     * The guard stays because it is right, not because a test proves it: the
     * day any redirect wants a policy other than no-store, an unguarded branch
     * silently replaces it. This test pins the outcome; it does not pretend to
     * pin the guard.
     */
    const response = await send(new Request(url('/app')), { MAINTENANCE: 'true' })
    expect(response.status).toBe(307)
    expect(response.headers.get('cache-control')).toBe(NO_STORE)
    expect(response.headers.get('location')).toBe(MAINTENANCE_PATH)
  })

  test('a 200 document is untouched by the redirect branch', async () => {
    // The control. Without it the branch could match everything and this file
    // would still be green on the assertions above.
    const response = await get('/about', VERSIONED)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe(STATIC_CACHE)
  })
})
