import { test, expect, type Page } from '@playwright/test'

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
