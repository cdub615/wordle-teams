import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import type { Locator, Page } from '@playwright/test'

/**
 * The billing surface, end to end (wordle-teams-ksh, Task 11).
 *
 * THIS FILE EXISTS BECAUSE THE WIRING IS THE ONLY PART THAT CAN BREAK SILENTLY.
 * The copy is unit-tested (src/lib/billing-copy.test.ts) and the pending-invite
 * count is unit-tested (convex/billing.test.ts); what neither can see is a
 * button that calls nothing, a Convex hook mounted outside the provider, or a
 * failure swallowed into a menu item that simply does not respond. All three
 * are invisible to lint, tsc, the whole unit suite and `pnpm build`.
 *
 * IT ALSO GUARDS THE MOVE THIS TASK MADE. Header.tsx used to be rendered by the
 * root route's `shellComponent`, which @tanstack/react-router mounts OUTSIDE
 * the root route's component and therefore outside ConvexBetterAuthProvider.
 * Every Convex React hook in it threw there — measured as a 500 on GET /login,
 * "Could not find Convex client!". Test 2 below is that regression test, and it
 * costs no sign-in: if Header ever moves back, /login stops rendering at all.
 *
 * TWO TESTS AND ONE SIGN-IN, WHICH IS A DELIBERATE BUDGET RATHER THAN
 * LAZINESS, AND THE NUMBERS ARE MEASURED. The four smaller tests this started
 * as took three OTP sign-ins and pushed the suite from 15 tests to 19. At 15,
 * `pnpm e2e` passed 3 runs out of 3. At 19 it failed in all 5 runs — always the
 * same shape, the first 5s-default assertion after an OTP sign-in timing out on
 * "waiting for navigation to finish", never in this file, and spread across
 * invites.spec.ts:119, invites.spec.ts:254, teams.spec.ts:85 and
 * teams.spec.ts:145. Folded back to 17 tests and one sign-in it passed 4 runs
 * out of 5, the exception being invites.spec.ts:119, the flake this suite
 * already had (wordle-teams-1cd).
 *
 * SO THE SCARCE RESOURCE IS SIGN-INS, NOT TESTS. Each one polls for an OTP for
 * up to 15s while every other spec runs in parallel. Everything below that can
 * share one session does, and a new test here should only mint a session if it
 * genuinely cannot.
 *
 * WHAT IT CANNOT ASSERT: a redirect to Polar. No POLAR_* variable is set on the
 * deployment this drives — measured with `convex env list`, and the five are on
 * production only (wordle-teams-3bl) — so both actions stop at
 * `polarEnvProblem`. That makes the honest-failure path the observable one,
 * which is genuinely the behaviour worth pinning first — v1's bug was never a
 * broken checkout, it was a checkout that failed and said nothing, and
 * wordle-teams-9fm was a checkout that failed and said the wrong thing. Task 13
 * (wordle-teams-02c) does the sandbox pass; when POLAR_* lands here, test 1
 * becomes a redirect assertion.
 *
 * WHICH MAKES THIS THE ONLY PLACE THE `not-configured` BRANCH IS PROVEN END TO
 * END, and it is proven against a deployment that genuinely is not configured
 * rather than a stub. billing-copy.test.ts pins the sentence's properties and
 * polar.test.ts pins the classification; only this can see the two joined up.
 *
 * NOR THE BADGE ABOVE ZERO. Reaching one pending invite needs a SECOND account
 * that owns a team, since the count only rises when somebody else's invite is
 * parked — a non-pro invitee already on FREE_TEAM_LIMIT teams (teams.ts's
 * invitePlayerFor) or an address invited to more teams than the cap claims at
 * signup (players.ts's completeProfileFor). That is two OTP sign-ins and two
 * browser contexts, which is precisely the load this file just cut. The zero
 * case IS asserted below, and it is the one that catches a badge rendering
 * "0 Invites Pending"; pendingInviteCountFor's own tests cover the arithmetic.
 *
 * EVERY ADDRESS IS e2e+*@wordleteams.com, for the reason invites.spec.ts gives:
 * sign-in.ts reads the OTP back through testOtps.takeFor, which refuses any
 * other shape.
 */

/** A sonner toast by its copy. Substring, and case-SENSITIVE. */
const toastWith = (page: Page, text: string): Locator =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

/**
 * The header's billing affordance, found by its accessible name. That name
 * comes from an aria-label rather than the text, because the visible label is
 * hidden below the `sm` breakpoint — so this locator works at both viewport
 * sizes this file uses.
 */
const billingButton = (page: Page): Locator => page.getByRole('button', { name: 'Billing' })

test('the billing link and the upgrade CTA each report their own failure', async ({ page }) => {
  // One OTP sign-in plus a team creation. sign-in.ts alone polls for a code for
  // up to 15s, which does not fit Playwright's 30s default with a dashboard
  // load and two Polar round trips after it.
  test.setTimeout(120_000)

  const email = `e2e+billing-${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  // The team matters because `/` redirects an account with no `players` row to
  // /complete-profile, and ensureTeamFor creates the row. Same helper shape as
  // teams.spec.ts and invites.spec.ts, and deliberately not shared with them.
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await signIn(page, email)

  // The dashboard, not /complete-profile. The header renders on both, so the
  // team picker is what tells them apart. 20s for the reason invites.spec.ts
  // gives: a page that has just come through an OTP round trip is the slowest
  // load in this suite.
  await expect(page.getByRole('button', { name: 'Team: E2E Team' })).toBeVisible({
    timeout: 20_000,
  })

  // ── The badge, at zero ────────────────────────────────────────────────────
  // A fresh account is owed nothing, so the badge must be absent rather than
  // reading "0 Invites Pending". That is the whole of the `> 0` gate, and it is
  // the failure a `pendingInviteLabel` with no guard in front of it produces.
  await expect(page.getByText(/Invites? Pending/)).toHaveCount(0)

  // ── The portal ────────────────────────────────────────────────────────────
  const billing = billingButton(page)
  await expect(billing).toBeEnabled()
  await billing.click()

  // THE `not-configured` BRANCH, AND THE OTHER TWO ARE THE POINT OF ASSERTING
  // IT. This deployment has no POLAR_* variable (measured with `convex env
  // list`), so polarEnvProblem answers before any network call and the portal
  // reports a misconfiguration — which is the literal truth here.
  //
  // wordle-teams-9fm IS WHAT THE TWO NEGATIVE ASSERTIONS CATCH, and this is the
  // only place in the repo that can catch it end to end. `no-customer` would
  // mean the reasons had been collapsed between the action and the toast, as
  // before. `error` — "Could not open the billing portal. Please try again." —
  // is what this ACTUALLY SAID until wordle-teams-9fm: a sentence inviting a
  // retry that could never work, for a deployment that is simply not set up.
  await expect(toastWith(page, 'Billing is unavailable.')).toBeVisible({
    timeout: 15_000,
  })
  await expect(toastWith(page, 'You do not have a billing account yet.')).toHaveCount(0)
  await expect(toastWith(page, 'Please try again')).toHaveCount(0)

  // AND NOTHING NAMES A VARIABLE. The server knows exactly which of the five are
  // missing and logs it; this repo is public and the browser is not where that
  // goes. Asserted on the whole document rather than the toast, because a leak
  // anywhere on the page is the same leak.
  await expect(page.locator('body')).not.toContainText('POLAR_')

  // The button comes back rather than staying stuck pending: a failure the
  // player cannot retry is the same dead end as no message at all.
  await expect(billing).toBeEnabled()

  // ── The upgrade CTA ───────────────────────────────────────────────────────
  // FREE_TEAM_LIMIT is 2 and the seed gives one team, so one more is what swaps
  // team-picker.tsx's "New Team" for "Upgrade for more" (it gates on
  // `!isPro && teams.length >= FREE_TEAM_LIMIT`).
  const second = `Second Team ${Date.now()}`
  await page.getByRole('button', { name: 'Team: E2E Team' }).click()
  await page.getByRole('menuitem', { name: 'New Team' }).click()
  await page.getByLabel('Team Name').fill(second)
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('button', { name: `Team: ${second}` })).toBeVisible({
    timeout: 20_000,
  })

  await page.getByRole('button', { name: `Team: ${second}` }).click()
  // The swap itself: at the limit there is no "New Team" left to click.
  await expect(page.getByRole('menuitem', { name: 'New Team' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Upgrade for more' }).click()

  // Was `toast.info('More teams need a paid plan. Coming soon.')` until Task 11.
  // Nothing about a real checkout is observable without POLAR_*, but a CTA that
  // reaches createProCheckout and reports what it answers is exactly what
  // distinguishes the wired button from the placeholder it replaced.
  //
  // AND IT REPORTS THE SAME MISCONFIGURATION THE PORTAL DID, in its own words:
  // both paths had this bug (wordle-teams-9fm) and both were fixed. "Could not
  // start checkout. Please try again." is the operational sentence and is the
  // wrong answer on a deployment holding no access token.
  await expect(toastWith(page, 'Upgrades are unavailable.')).toBeVisible({ timeout: 15_000 })
  await expect(toastWith(page, 'Coming soon')).toHaveCount(0)
  await expect(toastWith(page, 'Please try again')).toHaveCount(0)

  // ── The return leg from checkout (wordle-teams-wxg) ───────────────────────
  // NO REAL CHECKOUT IS NEEDED TO REACH THIS, and none can be driven: with no
  // POLAR_* variable set, createProCheckout never returns a URL. But the state
  // Polar leaves the browser in is entirely a query parameter —
  // `${SITE_URL}/?checkout=success`, convex/polar.ts — so visiting it is the
  // real thing. This account is still free, which is precisely the case the
  // pending notice exists for.
  await page.goto('/?checkout=success')
  const pending = page.getByText('Finishing your upgrade')
  await expect(pending).toBeVisible({ timeout: 20_000 })

  // STILL THERE AFTER THE DASHBOARD'S OWN NAVIGATION, which is the assertion
  // with teeth. useDashboardSearchSync navigates on hydration to fill ?team=
  // and ?month= in; if that remounted the route — or if the notice's flag lived
  // anywhere that a remount resets — the message would flash and vanish while
  // the upgrade was still in flight. Waiting for ?team= to appear is waiting
  // for exactly that navigation to have happened.
  await expect.poll(() => new URL(page.url()).searchParams.get('team')).not.toBeNull()
  await expect(pending).toBeVisible()

  // The marker is stripped, so nothing can re-trigger on a reload.
  expect(new URL(page.url()).searchParams.get('checkout')).toBeNull()
  await page.reload()
  await expect(page.getByRole('button', { name: /^Team: / })).toBeVisible({ timeout: 20_000 })
  await expect(pending).toHaveCount(0)

  // ── On a phone ────────────────────────────────────────────────────────────
  // 390x844 is an iPhone 14. wordle-teams-ksh calls the phone the product's
  // primary device, and the header is the one bar every route carries —
  // index.tsx's grid-cols-1 note records what a single over-wide child does to
  // this page: a document-wide horizontal scrollbar with everything pushed edge
  // to edge. Resized here rather than in a test of its own because the only
  // thing a separate test would add is another OTP sign-in.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(billingButton(page)).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('a signed-out visitor is offered no billing link and no badge', async ({ page }) => {
  // NO SIGN-IN, WHICH IS WHY THIS ONE IS CHEAP AND WHY IT CATCHES THE MOST.
  // Header renders on /login for a visitor with no session; if its Convex hooks
  // are ever mounted outside the provider again, this page 500s and the
  // assertions below never get as far as being about billing.
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()

  await expect(billingButton(page)).toHaveCount(0)
  await expect(page.getByText(/Invites? Pending/)).toHaveCount(0)
})
