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
const rendered = vi.hoisted(() => ({ paths: [] as string[], status: 200 }))

vi.mock('@tanstack/react-start/server-entry', () => ({
  default: {
    fetch: (request: Request) => {
      const url = new URL(request.url)
      rendered.paths.push(`${url.pathname}${url.search}`)
      return new Response(`<html>rendered ${url.pathname}</html>`, {
        status: rendered.status,
        headers: { 'content-type': 'text/html' },
      })
    },
  },
}))

const { default: worker } = await import('./server.ts')

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext

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
})

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
