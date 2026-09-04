import { test, expect, type Page } from '@playwright/test'
import { openAppMenu } from './app-menu.ts'
import { signIn } from './sign-in'
import { completeProfile } from './complete-profile'

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

  test('an anonymous visitor to / gets the marketing landing, not a login wall', async ({
    page,
  }) => {
    // THE WHOLE POINT OF PHASE 7 TASK 4. Between Phase 0 and that task `/` was
    // the dashboard and 307'd an anonymous visitor to /login, so v2 had no
    // page that said what the product is — while v1's sitemap advertises this
    // exact URL at priority 1 and ~93% of /login arrivals never finish signing
    // in (wordle-teams-390). Both halves are asserted: the h1 the landing
    // renders, AND that the address bar is still `/`, which is what says no
    // bounce happened.
    await page.goto('/')
    await expect(page).toHaveURL('/')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Compete with friends', exact: true }),
    ).toBeVisible()
  })

  test('/home renders the whole landing — hero, all six feature cards, both CTAs', async ({
    page,
  }) => {
    // v1's src/app/sitemap.ts lists /home at priority 0.9 and v1's own app bar
    // links its wordmark there, so the path is advertised to crawlers and
    // carried by inbound links. src/routes/home.tsx's claim is not "renders a
    // landing" but "IT IS THE SAME PAGE, NOT A VARIANT", so this asserts the
    // whole surface rather than the h1 alone — the h1 is the one thing a
    // hero-only /home would also satisfy, which is what the old, wider-named
    // version of this test would have passed on.
    //
    // THE SIX CARDS ARE PINNED HERE AND NOWHERE ELSE IN THIS FILE. Their COPY
    // is src/components/home/feature-cards.test.ts's job — v2 has no DOM under
    // vitest, so that suite reads the exported FEATURES array. What only a
    // browser can say is that they reach the page at all, and `/home` is the
    // route whose entire justification is being identical to `/`.
    await page.goto('/home')
    await expect(page).toHaveURL('/home')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Compete with friends', exact: true }),
    ).toBeVisible()

    // toEqual on the whole list: a deleted card, a reorder and a reworded title
    // all have to fail. `toHaveCount(6)` would miss two of the three.
    await expect(page.getByRole('heading', { level: 3 })).toHaveText([
      'Create Teams',
      'Wordle Boards',
      'Competitive Scoring',
      'Go Pro',
      'Easy Sign In',
      'Privacy',
    ])

    await expect(page.getByRole('link', { name: 'Get Started', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign In', exact: true })).toBeVisible()
  })

  test('a signed-in visitor to /home stays on /home', async ({ page }) => {
    // THE OTHER HALF OF THE `/` BOUNCE, AND THE MOST-ARGUED DECISION IN PHASE 7
    // TASK 4. v1's welcomePaths (src/lib/supabase/middleware.ts:7) is exactly
    // ['/', '/login']; `/home` is deliberately absent, so in v1 a signed-in
    // user who follows a link there — including the app bar wordmark, which in
    // v1 points at /home — SEES the marketing page. src/routes/home.tsx has no
    // beforeLoad for that reason and writes four sentences about it.
    //
    // NOTHING TESTED IT. Adding a beforeLoad to home.tsx left all 39 specs
    // green: the /home test above navigates anonymously, and a signed-in-only
    // redirect is invisible to an anonymous visit. src/routes.test.ts pins the
    // absence in the source, which is the half CI can see; this is the half
    // that says what a user experiences.
    //
    // THE PROFILE IS COMPLETED FIRST for the same reason as the `/` test below
    // — it makes this account's state identical to that one's, so the pair is a
    // true A/B on the route and not on the account.
    await signIn(page)
    await expect(page).toHaveURL('/complete-profile')
    await completeProfile(page, { lastName: 'Home' })
    await expect(page).toHaveURL('/app')

    // The WHOLE chain: one entry is the assertion. A beforeLoad here would make
    // it ['/home', '/app'], exactly as `/`'s does.
    const chain = await redirectChain(page, '/home')
    expect(chain).toEqual(['/home'])
    await expect(
      page.getByRole('heading', { level: 1, name: 'Compete with friends', exact: true }),
    ).toBeVisible()
  })

  test('/ and /home both carry the site-wide default title', async ({ page }) => {
    // BOTH ROUTE FILES REASON ABOUT THIS AND NEITHER WAS PINNED. Each declares
    // `head: () => ({ meta: [{ title: pageTitle() }] })` with NO SEGMENT,
    // because v1's src/app/page.tsx and src/app/home/page.tsx declare no
    // metadata of their own and so inherit the Next.js default. Passing a
    // segment to either would produce "X - Wordle Teams" and silently diverge
    // from production's apex title, which is a real SEO artefact on the URL
    // v1's sitemap ranks first.
    //
    // THE LITERAL, NOT APP_DEFAULT_TITLE IMPORTED FROM #/lib/seo. Importing the
    // constant would make this pass no matter what the constant became; the
    // string is what ships in the document.
    await page.goto('/')
    await expect(page).toHaveTitle('Wordle Teams: The ultimate app for Wordle enthusiasts')

    await page.goto('/home')
    await expect(page).toHaveTitle('Wordle Teams: The ultimate app for Wordle enthusiasts')
  })

  test('both of the landing\'s CTAs link to /login', async ({ page }) => {
    // The links the landing exists to hand over, asserted as the resolved href
    // of each element — not as "/login appears somewhere in the document",
    // which the Header's own markup would satisfy on its own.
    //
    // BOTH, BECAUSE PINNING ONE WAS AN ASYMMETRY AND MUTATION FOUND IT. The
    // hero's "Get Started" was covered from the start; dashboard-preview.tsx's
    // "Sign In" could be re-pointed at /app with every gate and every spec
    // still green. They are two CTAs to the same destination on purpose — the
    // comment in dashboard-preview.tsx says so, v1 has both — so the second one
    // drifting is exactly the change nothing would have looked at.
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Get Started', exact: true })).toHaveAttribute(
      'href',
      '/login',
    )
    await expect(page.getByRole('link', { name: 'Sign In', exact: true })).toHaveAttribute(
      'href',
      '/login',
    )
  })

  test('a signed-in visitor to / is bounced to /app', async ({ page }) => {
    // v1's src/lib/supabase/middleware.ts puts `/` in `welcomePaths`: "A
    // signed-in user should never land here (e.g. an iOS PWA relaunch that
    // ignores manifest start_url and restores the welcome page)". src/routes/
    // index.tsx's beforeLoad is that rule, and this is the only place it is
    // observable.
    //
    // THE PROFILE IS COMPLETED FIRST, DELIBERATELY. signIn() mints a brand-new
    // account with no `players` row, so /app's own beforeLoad would send it on
    // to /complete-profile and the chain would be three long — this test would
    // then be pinning that bounce as well as this one. Naming the account makes
    // /app terminal, and it is exactly how e2e/complete-profile.spec.ts drives
    // the same form rather than a second mechanism invented here.
    await signIn(page)
    await expect(page).toHaveURL('/complete-profile')
    await completeProfile(page, { lastName: 'Landing' })
    await expect(page).toHaveURL('/app')

    // The WHOLE chain, not a slice: two entries is the assertion. A third hop
    // would mean the bounce landed somewhere that bounced again.
    const chain = await redirectChain(page, '/')
    expect(chain).toEqual(['/', '/app'])
  })

  test('the app bar wordmark points at the landing', async ({ page }) => {
    // THIS DESTINATION HAS ALREADY BEEN CHANGED ONCE BY ACCIDENT, which is the
    // reason it is pinned. Phase 7 Task 1 deleted the old index route, which
    // took `'/'` out of the router's `to` union and left /app as the only
    // spelling that compiled — so the wordmark silently became a dashboard
    // link, and all four CI gates stayed green. Task 4 put it back on `/` on
    // parity with v1's own app bar (src/components/app-bar/app-bar-base.tsx:73
    // links its wordmark to the marketing page). Nothing but this notices if it
    // moves again.
    //
    // IT IS THE BAR'S ONLY LINK SINCE wordle-teams-lyab, which raises the
    // stakes rather than lowering them: the "Home" and "About" links that used
    // to sit beside it are menu items now, so if the wordmark points at the
    // wrong page there is no second link in the chrome to compensate.
    //
    // ON /about RATHER THAN ON `/`: hrefs read the same either way, but a link
    // to the page you are already on is the one place a wrong destination is
    // least visible, and the next test needs this page anyway.
    await page.goto('/about')
    await expect(page.getByRole('link', { name: 'Wordle Teams', exact: true })).toHaveAttribute(
      'href',
      '/',
    )
  })

  /*
   * THE NAV THAT MOVED INTO THE MENU (wordle-teams-lyab).
   *
   * WHAT THESE REPLACE, AND WHY IT IS NOT A LOSS OF COVERAGE. Three tests used
   * to stand here: one on the "Home" link's href, and a pair on whether it
   * carried TanStack's `is-active` class on the landing but not elsewhere. That
   * pair existed for a specific hazard — TanStack matches an active Link
   * fuzzily by default and `/` is a prefix of every path in the app, so the
   * underline could have sat under "Home" on every route, a nav that always
   * claims you are on the home page.
   *
   * THAT HAZARD IS GONE WITH THE UNDERLINE. A dropdown menu item has no active
   * styling to be wrong about: the `nav-link` class and its `::after` rule are
   * no longer applied to anything in the header, so there is no fuzzy-match
   * outcome left to pin. Keeping the assertions would have meant asserting
   * against a class the component no longer sets, which passes for the wrong
   * reason forever.
   *
   * WHAT REPLACES THEM IS THE THING THAT CAN NOW GO WRONG INSTEAD: the
   * destinations are still real, and the menu that holds them still opens for a
   * visitor with no session. The second is the new failure mode — the menu's
   * predecessor only ever mounted for a signed-in player, and restoring that
   * gate anywhere would leave /login and /about with no navigation in the
   * chrome at all.
   */
  test('a signed-out visitor can open the menu and navigate from it', async ({ page }) => {
    await page.goto('/about')

    // openAppMenu, not a bare click: the header server-renders, so the trigger
    // exists before React attaches a handler to it, and on this page — no
    // session, nothing else to wait for — a click lands on a dead button. See
    // the helper's note; this test is where that was measured.
    await openAppMenu(page)

    const home = page.getByRole('menuitem', { name: 'Home' })
    await expect(home).toHaveAttribute('href', '/')
    await expect(page.getByRole('menuitem', { name: 'About' })).toHaveAttribute('href', '/about')
    // `/home` is the compatibility duplicate of the landing — the two render
    // the identical component, and sitemap.ts ranks `/` at priority 1 against
    // /home at 0.9. Linking internally to the duplicate advertises the
    // non-canonical copy of a page we serve twice, and it is the plausible
    // wrong answer rather than an arbitrary one.
    await expect(home).not.toHaveAttribute('href', '/home')

    // AND IT ACTUALLY NAVIGATES. An href is not a working link: these are
    // `DropdownMenuItem asChild` wrapping a TanStack `Link`, so Radix merges
    // its own props — including an `onSelect` that closes the menu — onto the
    // anchor, and a mis-wired asChild can swallow the click while leaving the
    // href perfectly correct.
    await home.click()
    await expect(page).toHaveURL(/\/$/)
  })

  /*
   * V1'S TWO LEGAL PAGES (Phase 7 Task 5).
   *
   * ASSERTED AS A PARSED HEADING, NEVER AS A SUBSTRING OF THE DOCUMENT. Both
   * pages quote their own title inside their prose — "This Privacy Policy
   * explains...", "you agree to be bound by these Terms of Service" — so
   * `expect(await page.content()).toContain('Privacy Policy')` passes on a page
   * that renders the text and no heading at all, and passes on /terms as well
   * once the footer links are there. `getByRole('heading', { level: 1 })` is
   * the only form that distinguishes the page from a mention of it.
   */
  test('/privacy renders the Privacy Policy as its h1', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page).toHaveURL('/privacy')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Privacy Policy', exact: true }),
    ).toBeVisible()
  })

  test('/terms renders the Terms of Service as its h1', async ({ page }) => {
    await page.goto('/terms')
    await expect(page).toHaveURL('/terms')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Terms of Service', exact: true }),
    ).toBeVisible()
  })

  test('/privacy and /terms carry v1\'s own page titles', async ({ page }) => {
    // v1 sets these in src/app/privacy/layout.tsx and src/app/terms/layout.tsx
    // as `metadata.title`, which Next runs through the root layout's
    // `title.template` of '%s - Wordle Teams'. src/lib/seo.ts's pageTitle() is
    // that interpolation done by hand, and the whole point of it is that these
    // two strings are byte-identical to what production serves today — they are
    // the <title> on two URLs v1's sitemap advertises.
    //
    // THE LITERALS, NOT pageTitle() IMPORTED — same reason as the '/ and /home'
    // title test above: importing the helper would make this pass whatever the
    // helper became.
    await page.goto('/privacy')
    await expect(page).toHaveTitle('Privacy Policy - Wordle Teams')

    await page.goto('/terms')
    await expect(page).toHaveTitle('Terms of Service - Wordle Teams')
  })

  test('the footer links to /privacy and /terms', async ({ page }) => {
    // THE LINKS ARE THE REASON THE ROUTES WERE PORTED. Footer.tsx omitted both
    // from Phase 0 until Task 5 because they would have been 404s, and the
    // comment recording that omission is gone with them.
    //
    // RESOLVED hrefs on the named links, not "the string /privacy appears in
    // the document" — the document contains that string anyway, in the router's
    // dehydrated state and in the route manifest. And BOTH, because one is
    // exactly the asymmetry mutation found on the landing's two CTAs: deleting
    // either <Link> here has to go red.
    //
    // ON /about: the footer renders under every route (__root.tsx), and reading
    // it from a third page keeps the assertion off the pages being linked to.
    await page.goto('/about')
    await expect(
      page.getByRole('link', { name: 'Privacy Policy', exact: true }),
    ).toHaveAttribute('href', '/privacy')
    await expect(page.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute(
      'href',
      '/terms',
    )
  })

  test('/login-error renders the failure page and offers a way back to sign in', async ({
    page,
  }) => {
    // THE ROUTE PHASE 7 TASK 6 CREATED. Nothing in the app links here — it is
    // reached only by a redirect issued inside Better Auth — so this is the
    // first navigation that has ever proved the path resolves at all.
    //
    // The h1 AND the link, because either alone is a page that half works: v1's
    // src/app/login-error/page.tsx renders exactly one control, and a heading
    // with no way out of it is the dead end wordle-teams-vjh was filed about.
    await page.goto('/login-error')
    await expect(page).toHaveURL('/login-error')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sign In Failed', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Head to Sign In', exact: true }),
    ).toHaveAttribute('href', '/login')
  })

  test('/login-error carries v1\'s title, which is /login\'s own title', async ({ page }) => {
    // v1's src/app/login-error/layout.tsx sets `metadata.title` to the SAME
    // string as src/app/login/layout.tsx, because this page is a step in the
    // sign-in flow and not a destination. Asserted as a pair so "the same as
    // /login" stays a fact about both pages rather than a comment on one.
    //
    // THE LITERAL, not pageTitle() imported — same reason as the '/privacy and
    // /terms' title test above.
    await page.goto('/login-error')
    await expect(page).toHaveTitle('Login / Signup - Wordle Teams')

    await page.goto('/login')
    await expect(page).toHaveTitle('Login / Signup - Wordle Teams')
  })

  test('/login-error names the failure when the provider sent a code for it', async ({ page }) => {
    // THE wordle-teams-vjh DECISION, END TO END AND IN A REAL BROWSER. The
    // unit tests call the component; this is the only thing that proves
    // `validateSearch` is actually wired into the route the router built, which
    // is where an allowlist would silently stop being consulted.
    //
    // BOTH DIRECTIONS IN ONE TEST, because the claim is a difference: the point
    // of the issue is that a declined consent and an expired passcode used to
    // look identical. One assertion on its own cannot say that they no longer
    // do.
    await page.goto('/login-error?error=access_denied')
    await expect(
      page.getByText(
        'You cancelled at your sign in provider, or declined the permissions it asked for.',
        { exact: false },
      ),
    ).toBeVisible()

    // A code with no sentence of its own, and the raw string of an unknown one,
    // both fall back to the generic page rather than rendering anything from
    // the query string.
    await page.goto('/login-error?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Sign In Failed', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('alert(1)', { exact: false })).toHaveCount(0)
  })

  test('/login-error tells the user how long a passcode actually lasts', async ({ page }) => {
    // v1's copy promises "1 hour". convex/authEmails.ts sets OTP_EXPIRY_SEC to
    // 300 and writes "It expires in 5 minutes" into the code email from it, so
    // porting v1's sentence unchanged would have this page contradict the email
    // the reader is holding — and tell someone with a forty-minute-old code
    // that it should still work.
    //
    // THE WHOLE SENTENCE, not the number: '5' appears elsewhere in a rendered
    // document, and it is the promise that matters rather than the digit.
    await page.goto('/login-error')
    await expect(
      page.getByText(
        'a One Time Passcode (OTP) will expire after 5 minutes. If your email has been delayed you may need to try again.',
        { exact: false },
      ),
    ).toBeVisible()
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
  test('an anonymous GET / is edge-cacheable now that the landing renders', async ({ request }) => {
    // NEW WITH THE LANDING, AND IT IS A REAL CHANGE OF BEHAVIOUR RATHER THAN A
    // SECOND COPY OF THE /about CASE BELOW. `/` has been in cache-policy.ts's
    // STATIC_DOCUMENTS since Phase 0, but src/server.ts shares only a 200 and
    // `/` answered 404 — so the listing was inert and this path correctly got
    // `private, no-store`. Phase 7 Task 4 made it a 200, which is the moment the
    // listing takes effect: the apex, the single most-requested document at
    // cutover and the one v1's sitemap ranks first, is now published to the edge
    // for a day. That flip is worth its own assertion.
    const response = await request.get('/')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )
  })

  test('an anonymous GET /home is edge-cacheable too', async ({ request }) => {
    // /home WENT LIVE IN THE SAME COMMIT AS `/` AND WAS THE ONLY HALF LEFT
    // UNASSERTED. It is in cache-policy.ts's STATIC_DOCUMENTS for the same
    // reason `/` is, and it was inert for the same reason — it 404'd, and
    // src/server.ts applies the static policy to a 200 and nothing else.
    //
    // AND IT IS THE PATH THE ORIGINAL BUG WAS MEASURED ON, which is why this is
    // not a third copy of the /about case: cache-policy.ts's header names /home
    // first — v1 emitted `public, max-age=0, must-revalidate` here and 28-41% of
    // requests missed the edge and woke a ~1.9s cold function
    // (wordle-teams-jcj). This is the assertion that says v2 did not re-create
    // it on the very route where it was found.
    const response = await request.get('/home')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )
  })

  test('an anonymous static document is edge-cacheable', async ({ request }) => {
    // /about is the oldest static route in v2 and its path is not moving. It
    // was the subject here from the start because it was, for several tasks,
    // the ONLY listed path that answered 200; /privacy and /terms joined it in
    // Phase 7 Task 5 and have their own cases below.
    const response = await request.get('/about')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )
  })

  test('an anonymous GET /privacy is edge-cacheable now that the policy page renders', async ({
    request,
  }) => {
    // THE OTHER HALF OF WHAT PHASE 7 TASK 5 CHANGED, and the half a route test
    // cannot see. /privacy has been in cache-policy.ts's STATIC_DOCUMENTS since
    // Phase 0 and was inert the whole time — src/server.ts shares only a 200 and
    // this path 404'd, so it correctly got `private, no-store` and the case
    // below asserted exactly that. Landing src/routes/privacy.tsx is the moment
    // the listing takes effect.
    //
    // It is worth its own assertion rather than folding into the /about case:
    // /privacy and /terms are v1's two prerendered legal pages, and they are
    // named in cache-policy.ts's header as two of the three routes where
    // wordle-teams-jcj was measured. Re-creating that bug here is the specific
    // regression this file exists to prevent.
    const response = await request.get('/privacy')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )
  })

  test('an anonymous GET /terms is edge-cacheable too', async ({ request }) => {
    // /terms went live in the same commit as /privacy and is the other half of
    // the same flip. Both are asserted because both are listed, and a route
    // dropped from STATIC_DOCUMENTS silently loses the edge with every gate
    // green — which is what makes a missing entry a latency bug nobody sees.
    const response = await request.get('/terms')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )
  })

  test('an unlisted route is not cached, even when it 404s', async ({ request }) => {
    // THE SUBJECT HAS MOVED TWICE AND HAS NOW RUN OUT OF LISTED PATHS. This
    // case was /privacy, then /maintenance, each time picking whichever path
    // was in cache-policy.ts's STATIC_DOCUMENTS while still 404ing — which
    // pinned src/server.ts's rule that ONLY A 200 MAY BE SHARED. Phase 7 Task 7
    // landed src/routes/maintenance.tsx, and with it every one of the seven
    // listed paths now answers 200. There is no listed-but-missing path left to
    // point this at.
    //
    // So it does what the previous comment said to do in exactly this case:
    // keeps the test and asserts a 404 on an UNLISTED path instead. SAY THE
    // COST OUT LOUD — that is a different assertion. This now pins the
    // STATIC_DOCUMENTS lookup (an unrecognised path defaults to no-store) and
    // NOT the status gate, and nothing else in this file reaches the status
    // gate any more. The gate is still load-bearing: a transient 5xx on a route
    // that DOES exist is the identical hazard, and `wrangler deploy` purges
    // nothing. Its cover is now src/server.test.ts, which calls the composed
    // Worker fetch directly and can hand it any status it likes — and unlike
    // this file, that one runs in CI.
    //
    // If a listed path is ever added ahead of its route again, move this back
    // to it: a real 404 on a listed path tests strictly more than this does.
    const response = await request.get('/no-such-page-exists')
    expect(response.status()).toBe(404)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe('private, no-store')
  })

  test('/maintenance renders, and is edge-cacheable like the other static pages', async ({
    request,
  }) => {
    // The page every gated route is sent to while MAINTENANCE is on. It is in
    // STATIC_DOCUMENTS and always renders the same, so a direct request for it
    // keeps the static policy — unlike the 307 that points here, which
    // src/server.ts marks `private, no-store` so a transient state cannot
    // outlive itself in a cache. Both live in src/server.test.ts, which is a
    // gate; this asserts the page is actually reachable and rendering.
    const response = await request.get('/maintenance')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )
  })

  test('/app emits its anonymous redirect with an explicit no-store', async ({ request }) => {
    // The 307 ITSELF, with redirects off — which is why this is a separate test
    // from the followed-redirect one below: that one asserts /login's headers,
    // not /app's.
    //
    // THIS ASSERTED `toBeUndefined()` UNTIL wordle-teams-d2oc, and the old
    // comment called an unheadered redirect "fine — there is no body to cache".
    // That was wrong in a way worth recording: a response with no Cache-Control
    // is HEURISTICALLY cacheable, so the absence is not neutral, it is a
    // delegation to whatever the caching layer decides to invent.
    const response = await request.get('/app', { maxRedirects: 0 })
    expect(response.status()).toBe(307)
    expect(response.headers()['location']).toBe('/login')
    expect(response.headers()['cache-control']).toBe('private, no-store')
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

  test('/ emits its SIGNED-IN redirect with an explicit no-store', async ({ page, context }) => {
    // THE ONE COMBINATION THIS TASK CREATED THAT NOTHING ELSE COVERS. `/` is in
    // STATIC_DOCUMENTS — unlike /app, whose identical-looking test above is on a
    // path the policy would never share anyway — so if src/server.ts ever
    // computed a policy for a status other than 200, this response is the one
    // that would go out `public, s-maxage=86400`: a cached instruction sending
    // every anonymous visitor to the apex into the dashboard for a day, which
    // `wrangler deploy` could not purge. The content-type guard is what actually
    // prevents it (a 307 carries none), and the status gate behind it is the
    // belt to that braces.
    //
    // SINCE wordle-teams-d2oc THE ANSWER IS STRONGER THAN "no header". This used
    // to assert the redirect went out unheadered; it now carries an explicit
    // `private, no-store`, which serves the same concern better — the worry was
    // never that a header existed, it was that a SHAREABLE one might. An absent
    // header left that to heuristic caching; this states it.
    await signIn(page)
    const cookieHeader = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')

    const response = await page.request.get('/', {
      maxRedirects: 0,
      headers: { cookie: cookieHeader },
    })
    expect(response.status()).toBe(307)
    expect(response.headers()['location']).toBe('/app')
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

  test('an anonymous GET /login-error is edge-cacheable now that the page renders', async ({
    request,
  }) => {
    // THE FLIP PHASE 7 TASK 6 CAUSED, and the half no unit test can see.
    // '/login-error' has been in cache-policy.ts's STATIC_DOCUMENTS since Phase
    // 0 and was inert the whole time — src/server.ts shares only a 200 and this
    // path 404'd, so it correctly answered `private, no-store`. MEASURED BEFORE
    // AND AFTER: `curl -sI` returned `404` + `private, no-store` before the
    // route existed and `200` + the value below immediately after.
    //
    // Worth its own case rather than folding into /about: this page is the one
    // static document a user only ever reaches mid-authentication, so it is the
    // one where "is it really safe to share this?" deserves an answer on the
    // record. It is — the anonymous rendering is four fixed sentences and a
    // link, the provider's code lives in the query string and Cloudflare keys
    // on the full URL, and a signed-in request gets `private, no-store` from
    // the session dimension like every other route.
    const response = await request.get('/login-error')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )
  })
})

/**
 * THE CRAWLER SURFACE OVER REAL HTTP.
 *
 * src/crawler-metadata.test.ts already pins the CONTENT of all three artefacts,
 * and it is the important half: it runs under `vitest run`, which CI runs, and
 * this file does not (wt-ksh.8.49). What is left here is what only a real
 * server can answer — that the assets layer serves public/robots.txt and the
 * PNG at all and with the right content types, that the `[.]` in
 * `sitemap[.]xml.ts` really produced /sitemap.xml, and that the OG tags survive
 * the round trip into the rendered document.
 *
 * DELIBERATELY NOT RE-ASSERTING THE VALUES. Restating the nineteen meta tags or
 * the seven sitemap URLs here would be a second copy to keep in step, and the
 * copy nobody runs.
 */
test.describe('crawler and social metadata', () => {
  test('robots.txt is served as text and disallows the app', async ({ request }) => {
    const response = await request.get('/robots.txt')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/plain')

    // PARSED, NOT `toContain`. A `toContain('Disallow: /app')` passes on a file
    // that says `Allow: /app` two lines lower and on one where the rule is
    // inside a comment. Comments go first, for the same reason.
    const directives = (await response.text())
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean)
      .map((line) => [
        line.slice(0, line.indexOf(':')).trim().toLowerCase(),
        line.slice(line.indexOf(':') + 1).trim(),
      ])

    const valuesOf = (field: string) =>
      directives.filter(([name]) => name === field).map(([, value]) => value)

    expect(valuesOf('disallow').sort()).toEqual(['/api', '/app', '/complete-profile', '/me'])
    expect(valuesOf('sitemap')).toEqual(['https://wordleteams.com/sitemap.xml'])
  })

  test('/sitemap.xml is a real route serving XML', async ({ request }) => {
    // The route file is named `sitemap[.]xml.ts`; without the brackets TanStack
    // reads the dot as a separator and registers /sitemap/xml, and every unit
    // test still passes. This is where that shows.
    const response = await request.get('/sitemap.xml')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/xml')

    // Not a document, so src/server.ts's content-type guard must have left the
    // header the route set. If this ever reads 'private, no-store' the guard
    // has started matching more than text/html.
    expect(response.headers()['cache-control']).toBe(
      'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    )

    const locs = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.length).toBeGreaterThan(0)
    // The one claim worth restating over HTTP: no URL the crawler is sent to is
    // one robots.txt just told it not to fetch.
    for (const loc of locs) {
      expect(new URL(loc).pathname).not.toMatch(/^\/(app|me|complete-profile|api)/)
    }
  })

  test('the OpenGraph image is served as a PNG', async ({ request }) => {
    const response = await request.get('/opengraph-image.png')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
    expect((await response.body()).byteLength).toBeGreaterThan(0)
  })

  test('the rendered document carries the social card, and its image resolves', async ({
    page,
    request,
  }) => {
    // THE ROUND TRIP. The unit test proves lib/seo.ts holds the right values
    // and that __root.tsx spreads them; only a rendered document proves
    // TanStack emits `property="og:..."` rather than dropping an attribute
    // React's meta typings do not list.
    await page.goto('/home')
    const content = (name: string) =>
      page.locator(`meta[property="${name}"], meta[name="${name}"]`).getAttribute('content')

    expect(await content('description')).toBeTruthy()
    expect(await content('og:type')).toBe('website')
    expect(await content('twitter:card')).toBe('summary_large_image')

    // og:image is absolute and points at the production origin on beta too —
    // it names where the site canonically lives. So it is fetched from THIS
    // server by path, which is what has to exist for the card to render after
    // cutover.
    const image = await content('og:image')
    expect(image).not.toBeNull()
    const url = new URL(image!)
    expect(url.origin).toBe('https://wordleteams.com')
    expect((await request.get(url.pathname)).status()).toBe(200)
  })

  test('every advertised route renders exactly one canonical, and og:url agrees', async ({
    page,
  }) => {
    /**
     * THE ROUND TRIP FOR wt-ksh.8.55, and the only place the claim can be
     * checked at all. The unit tests prove lib/seo.ts computes the right URLs
     * and that each route file calls publicRouteHead with its own path. They
     * cannot prove TanStack RENDERS a route-level `links:` entry, nor that
     * removing og:url from the root actually leaves one tag rather than none.
     *
     * EXACTLY ONE OF EACH IS THE ASSERTION. Two canonicals is the failure mode
     * that would follow from putting og:url back in the root as well, and a
     * document with two canonical links has none as far as Google is concerned.
     */
    const expected: Readonly<Record<string, string>> = {
      '/': 'https://wordleteams.com',
      // The duplicate-content case: /home renders the same component as / and
      // points at it rather than at itself.
      '/home': 'https://wordleteams.com',
      '/about': 'https://wordleteams.com/about',
      '/privacy': 'https://wordleteams.com/privacy',
      '/terms': 'https://wordleteams.com/terms',
      '/login': 'https://wordleteams.com/login',
      '/maintenance': 'https://wordleteams.com/maintenance',
    }

    for (const [path, canonical] of Object.entries(expected)) {
      await page.goto(path)
      const links = page.locator('link[rel="canonical"]')
      await expect(links, `${path} canonical count`).toHaveCount(1)
      expect(await links.getAttribute('href'), `${path} canonical`).toBe(canonical)

      const ogUrls = page.locator('meta[property="og:url"]')
      await expect(ogUrls, `${path} og:url count`).toHaveCount(1)
      expect(await ogUrls.getAttribute('content'), `${path} og:url`).toBe(canonical)
    }
  })
})
