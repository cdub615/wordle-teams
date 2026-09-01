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
 * there leaves every unit test green. These three tests are the only thing
 * that fails when the worker stops applying the policy it computes.
 *
 * EVERY ASSERTION COMPARES THE WHOLE HEADER WITH toBe. `toContain('public')`
 * is satisfied by a header that also says no-store, which is precisely the
 * class of over-wide assertion that has slipped through this phase three times
 * already.
 */
test.describe('document cache headers', () => {
  test('an anonymous static document is edge-cacheable', async ({ request }) => {
    // /about, NOT /privacy: /privacy is in cache-policy.ts's static set but the
    // route itself does not exist until a later task in this phase, and a 404
    // is not a document. /about exists today and is not moving — the same
    // reason playwright.config.ts probes it.
    const response = await request.get('/about')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe(
      'public, s-maxage=86400, stale-while-revalidate=604800',
    )
  })

  test('an anonymous authenticated route is never cached', async ({ request }) => {
    // /app answers a 307 to /login for an anonymous visitor, so follow it and
    // assert on the document that actually comes back rather than on a
    // redirect with no body. Either way the answer must be no-store: /login is
    // deliberately absent from the static set.
    const response = await request.get('/app')
    expect(response.headers()['cache-control']).toBe('private, no-store')
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
