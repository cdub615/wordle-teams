import { test, expect, type Page } from '@playwright/test'
import { signIn } from './sign-in'

// REAL RESPONSES, NOT UNIT TESTS. v2 has no component-rendering tests — the
// vitest environment is edge-runtime, so there is no DOM — which means the
// wiring in server.ts and the route tree is reachable from nowhere else.

/**
 * Every path the browser was handed on the way to the page it ended on, oldest
 * first, so `/me` answers `['/me', '/app', '/login']` for a signed-out visitor.
 * The QUERY STRING IS PART OF EACH ENTRY, because whether a param survives a
 * hop is a thing this file has to be able to ask.
 *
 * ASSERTING THE CHAIN RATHER THAN `toHaveURL`, because the address bar cannot
 * answer the question this file asks. `/me` redirects to `/app` and `/app` in
 * turn bounces an anonymous visitor to `/login`, so the URL settles on `/login`
 * either way — including in the world where `/me` 404s or points somewhere
 * else entirely. The hop that has to be true is `/me` -> `/app`, and it is only
 * visible here. Both hops are server-side 307s (measured), which is what makes
 * them reachable as redirected requests at all.
 */
async function redirectChain(page: Page, path: string): Promise<string[]> {
  const response = await page.goto(path)
  expect(response, `no response at all for ${path}`).not.toBeNull()

  const chain: string[] = []
  let request = response!.request()
  for (;;) {
    const url = new URL(request.url())
    chain.unshift(`${url.pathname}${url.search}`)
    const previous = request.redirectedFrom()
    if (!previous) return chain
    request = previous
  }
}

test.describe('route shape', () => {
  test('/me redirects to /app, because installed PWAs carry start_url: /me', async ({ page }) => {
    // v1's src/app/manifest.json sets "start_url": "/me", and an installed iOS
    // PWA does not adopt a new start_url from a re-fetched manifest — so at
    // cutover this is the path every existing installation opens on. See the
    // note in src/routes/me.tsx: the route is permanent, and so is this test.
    const chain = await redirectChain(page, '/me')
    expect(chain.slice(0, 2)).toEqual(['/me', '/app'])
  })

  test('/me carries its query string over to /app', async ({ page }) => {
    // v1's src/lib/polar/checkout.ts sets
    // `successUrl: ${appOrigin()}/me?checkout=success`, and that is a LIVE
    // PRODUCTION URL — so a checkout in flight across the DNS cutover comes
    // back to a v2 /me with the marker on it. `redirect({ to: '/app' })` with
    // no `search` dropped it, and src/lib/checkout-return.ts reads exactly
    // that param: the player would have landed on the dashboard with the
    // "Finishing your upgrade" notice never firing. The route's own comment
    // promises this for bookmarks and shared links generally, too.
    const chain = await redirectChain(page, '/me?checkout=success&team=abc')
    expect(chain.slice(0, 2)).toEqual([
      '/me?checkout=success&team=abc',
      '/app?checkout=success&team=abc',
    ])
  })

  test('/app bounces an anonymous visitor to /login', async ({ page }) => {
    // The bounce, and only the bounce. That /app RENDERS the dashboard for a
    // signed-in player is covered by e2e/complete-profile.spec.ts.
    await page.goto('/app')
    await expect(page).toHaveURL('/login')
  })
})

/*
 * CACHE HEADERS ON REAL RESPONSES.
 *
 * src/lib/cache-policy.test.ts covers the policy function exhaustively and
 * covers src/server.ts NOT AT ALL — deleting the `doc.headers.set(...)` line
 * there leaves every unit test green. These tests are the only thing that fails
 * when the worker stops applying the policy it computes, or applies it to
 * something it should not: the status gate and the content-type guard are both
 * unreachable from any unit test and are each pinned by exactly one case below.
 *
 * EVERY ASSERTION COMPARES THE WHOLE HEADER WITH toBe. `toContain('public')`
 * is satisfied by a header that also says no-store, which is precisely the
 * class of over-wide assertion that has slipped through this phase three times
 * already.
 */
test.describe('document cache headers', () => {
  test('an anonymous static document is edge-cacheable', async ({ request }) => {
    // /about, NOT /privacy: /privacy is in cache-policy.ts's static set but its
    // route does not exist until a later task in this phase, so it 404s and is
    // deliberately NOT shared — see the next test. /about exists today and is
    // not moving, the same reason playwright.config.ts probes it.
    const response = await request.get('/about')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )
  })

  test('a listed route that does not exist yet is not cached', async ({ request }) => {
    // /privacy IS in cache-policy.ts's STATIC_DOCUMENTS but has no route until a
    // later task in this phase, so it 404s today — and src/server.ts refuses to
    // share anything that is not a 200. Without that gate the edge takes a day
    // of `s-maxage` on a 404 that `wrangler deploy` will never purge.
    //
    // WHEN A LATER TASK LANDS THE REAL /privacy THIS FLIPS. The route starts
    // answering 200 and the expected header becomes the STATIC_CACHE value
    // asserted above. Change this assertion to match — that is the correct
    // response, and the test is still pinning the same rule. Do NOT delete it:
    // the status gate it guards outlives the missing routes, because a
    // transient 5xx on a route that does exist is the identical hazard. If you
    // are the one landing /privacy, consider swapping the 404 subject here for
    // whichever listed path is still unbuilt, so the gate keeps a live example.
    const response = await request.get('/privacy')
    expect(response.status()).toBe(404)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe('private, no-store')
  })

  test('/app emits its anonymous redirect with no cache-control at all', async ({ request }) => {
    // The 307 ITSELF, with redirects off. It carries no content-type, so the
    // guard in src/server.ts returns before any policy is computed and the
    // redirect goes out unheadered. That is fine — there is no body to cache —
    // but it means the followed-redirect test below is asserting /login's
    // headers and not /app's, which is why these are two tests and not one.
    const response = await request.get('/app', { maxRedirects: 0 })
    expect(response.status()).toBe(307)
    expect(response.headers()['location']).toBe('/login')
    expect(response.headers()['cache-control']).toBeUndefined()
  })

  test('/login, at the end of the anonymous /app bounce, is never cached', async ({ request }) => {
    // Named for /login because /login is what this asserts: request.get follows
    // the 307 and the headers that come back are the destination's. /login is
    // the one deliberate omission from the static set — it is the top of the
    // funnel and its job is to START a session — so no-store is the point of
    // the test, not an incidental.
    const response = await request.get('/app')
    expect(new URL(response.url()).pathname).toBe('/login')
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe('private, no-store')
  })

  test('a non-HTML response keeps whatever cache-control it set for itself', async ({
    request,
  }) => {
    // The content-type guard, which nothing else reaches: delete it and 935
    // unit tests plus every other case here stay green.
    //
    // /api/funnel POST is the subject because it is the most stable non-HTML
    // response in the app — it is documented to ALWAYS answer 204 whatever
    // happens downstream (see src/routes/api/funnel.ts: a vendor outage
    // blocking sign-in was wordle-teams-4ov), so it cannot start returning a
    // different status and quietly stop testing this. An empty body is an
    // unknown event name, which is `dropped`: no LogSnag call, no network
    // dependency in the assertion.
    const response = await request.post('/api/funnel', { data: {} })
    expect(response.status()).toBe(204)
    expect(response.headers()['x-funnel']).toBe('dropped')
    // Untouched means ABSENT here — the route sets none. If it ever sets one,
    // this becomes a toBe on that value; what must never appear is the document
    // policy, which for this path would be 'private, no-store'.
    expect(response.headers()['cache-control']).toBeUndefined()
  })

  test('a SIGNED-IN request for a static document is not cached', async ({ page, context }) => {
    // The second dimension, end to end. A signed-in GET /about embeds
    // `{isAuthenticated:!0,token:"eyJ..."}` in its dehydrated router state —
    // verified against this very server, where the embedded string was
    // byte-identical to the request's better-auth.convex_jwt cookie. A public
    // copy of that document is one visitor's bearer token served to the next.
    await signIn(page)

    const cookies = await context.cookies()
    expect(
      cookies.some((c) => c.name === 'better-auth.session_token'),
      'sign-in did not set better-auth.session_token — if the cookie was renamed, ' +
        'hasSessionCookie() in src/lib/cache-policy.ts must be updated with it',
    ).toBe(true)

    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const response = await page.request.get('/about', { headers: { cookie: cookieHeader } })

    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('private, no-store')

    // Pins the PREMISE the policy rests on, not just the header: if TanStack
    // Start ever stopped serialising root context into the document, this
    // assertion would fail and the session dimension could be revisited. It
    // failing is a prompt to re-measure, never to relax the header.
    expect(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(
      await response.text(),
    )).toBe(true)
  })
})
