import { expect, test } from '@playwright/test'
import { closeAppMenu, openAppMenu } from './app-menu.ts'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import type { Locator, Page } from '@playwright/test'

/**
 * The billing surface, end to end (wordle-teams-ksh, Task 11).
 *
 * THIS FILE EXISTS BECAUSE THE WIRING IS THE ONLY PART THAT CAN BREAK SILENTLY.
 * The copy is unit-tested (src/lib/billing-copy.test.ts), the pending-invite
 * count is unit-tested (convex/billing.test.ts), and since Task 12 the header's
 * own render states and both handlers are too (src/components/Header.hook.test.ts,
 * src/lib/use-start-upgrade.hook.test.ts); what none of them can see is a
 * Convex hook mounted outside the provider, or a real action answering a real
 * deployment. Those are invisible to lint, tsc, the whole unit suite and
 * `pnpm build`.
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
 * WHICH MAKES THIS THE ONLY PLACE EITHER `not-configured` BRANCH IS PROVEN END
 * TO END, and they are proven against a deployment that genuinely is not
 * configured rather than a stub. billing-copy.test.ts pins the two sentences'
 * properties and polar.test.ts pins both classifications; only this can see
 * them joined up.
 *
 * BOTH, INCLUDING THE PORTAL'S, AND THAT TOOK A FIX RATHER THAN A SIGN-IN.
 * Task 12 shipped the header's Billing button behind `isPro === true`, which
 * put it out of reach of every account this file can mint — all of them free —
 * and the portal's end-to-end proof went with it (wordle-teams-dyvt). It was
 * also wrong: v1 shows Billing to anyone who has ever subscribed, lapsed
 * included, and gating on amIPro took the customer portal away from every
 * player in 'cancelled' or 'expired'. Billing is now unconditional for a
 * signed-in player, so a plain free account reaches it here again — no second
 * OTP sign-in, and no comp-pro seed mutation convex/e2eSeed.ts does not have.
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
 * The billing affordance, WHICH IS A MENU ITEM AND NOT A BUTTON SINCE
 * wordle-teams-lyab. It used to sit in the bar beside Upgrade; the phone bar
 * carried five controls plus a wrapped nav row, so Billing moved into the
 * account menu along with the nav links and the theme control.
 *
 * IT STILL HAS NO CONDITION OF ITS OWN. app-menu.tsx offers Billing to every
 * signed-in player — v1's shape, and the lapsed subscriber is the person it is
 * for. The render states are pinned at gate level in
 * src/components/app-menu.hook.test.ts; what only this file can see is the
 * click reaching a real Convex action.
 */
const billingItem = (page: Page): Locator => page.getByRole('menuitem', { name: 'Billing' })

/**
 * The upgrade entry point, which STAYED IN THE BAR when Billing left it.
 *
 * That is a deliberate asymmetry, not an oversight: wordle-teams-456 measures
 * 87% of production signups never entering a board, and the only
 * always-reachable route to checkout is not something to put behind a
 * hamburger. Its name comes from an aria-label rather than the text, because
 * the visible label is hidden below the `sm` breakpoint — so this locator works
 * at both viewport sizes this file uses.
 */
const upgradeButton = (page: Page): Locator => page.getByRole('button', { name: 'Upgrade' })

/** Waits for sonner to clear, so the NEXT assertion cannot pass on a stale toast. */
const noToasts = async (page: Page): Promise<void> => {
  // The two upgrade entry points produce the SAME sentence, so "visible" after
  // the second click is satisfied by the first click's toast if it has not aged
  // out. The portal's sentence differs, but its NEGATIVE assertions are counts
  // over every toast on the page, so a leftover one can answer them too.
  // Sonner's default duration is 4s.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })
}

test('the portal and both upgrade entry points each report their own failure', async ({ page }) => {
  // One OTP sign-in plus a team creation. sign-in.ts alone polls for a code for
  // up to 15s, which does not fit Playwright's 30s default with a dashboard
  // load and three Polar round trips after it.
  test.setTimeout(120_000)

  const email = `e2e+billing-${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  // The team matters because `/app` redirects an account with no `players` row
  // to /complete-profile, and ensureTeamFor creates the row. Same helper shape
  // as teams.spec.ts and invites.spec.ts, and deliberately not shared with them.
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

  // ── The header's upgrade entry point ──────────────────────────────────────
  // WHAT wordle-teams-6tp FIXED, AND THE STATE THIS ACCOUNT IS IN IS THE WHOLE
  // BUG: one team, not pro. Until Task 12 the only route to createProCheckout
  // was the team-picker CTA below, which needs TWO teams first — so this player
  // could not pay, and the owner, comped pro, could not reach checkout as
  // himself to test it at all.
  const upgrade = upgradeButton(page)
  await expect(upgrade).toBeEnabled()
  // BOTH, NOT ONE — still, across two surfaces now. Task 12 shipped these as
  // alternatives and asserted Billing had count 0 here; that gate is what took
  // the customer portal away from lapsed subscribers, and this is the line
  // that would have caught it if it had been written the other way round.
  // Opened and closed again so the Upgrade click below is not aimed through an
  // open menu's overlay.
  await openAppMenu(page)
  await expect(billingItem(page)).toBeVisible()
  await closeAppMenu(page)

  await upgrade.click()

  // THE `not-configured` BRANCH, AND THE OTHER TWO ARE THE POINT OF ASSERTING
  // IT. This deployment has no POLAR_* variable (measured with `convex env
  // list`), so polarEnvProblem answers before any network call and the checkout
  // reports a misconfiguration — which is the literal truth here.
  //
  // wordle-teams-9fm IS WHAT THE NEGATIVE ASSERTION CATCHES, and this is the
  // only place in the repo that can catch it end to end. "Could not start
  // checkout. Please try again." is the OPERATIONAL sentence and is the wrong
  // answer for a deployment that is simply not set up: a retry cannot set an
  // access token.
  await expect(toastWith(page, 'Upgrades are unavailable.')).toBeVisible({
    timeout: 15_000,
  })
  await expect(toastWith(page, 'Please try again')).toHaveCount(0)

  // AND NOTHING NAMES A VARIABLE. The server knows exactly which of the five are
  // missing and logs it; this repo is public and the browser is not where that
  // goes. Asserted on the whole document rather than the toast, because a leak
  // anywhere on the page is the same leak.
  await expect(page.locator('body')).not.toContainText('POLAR_')

  // The button comes back rather than staying stuck pending: a failure the
  // player cannot retry is the same dead end as no message at all.
  await expect(upgrade).toBeEnabled()

  // ── The portal, reached by the same free account ──────────────────────────
  // THE JOIN THIS FILE EXISTS FOR, ON THE OTHER ACTION. Same deployment, same
  // absent POLAR_* variables, a different action and a different sentence.
  await noToasts(page)
  await openAppMenu(page)
  const billing = billingItem(page)
  await expect(billing).toBeEnabled()
  await billing.click()

  // wordle-teams-9fm IS WHAT THE TWO NEGATIVE ASSERTIONS CATCH, and this is the
  // only place in the repo that can catch it end to end. `no-customer` would
  // mean the reasons had been collapsed between the action and the toast, as
  // before — and this account genuinely has no Polar customer, so it is the
  // plausible wrong answer rather than an arbitrary one. `error` — "Could not
  // open the billing portal. Please try again." — is what this ACTUALLY SAID
  // until wordle-teams-9fm: a sentence inviting a retry that could never work,
  // for a deployment that is simply not set up.
  await expect(toastWith(page, 'Billing is unavailable.')).toBeVisible({ timeout: 15_000 })
  await expect(toastWith(page, 'You do not have a billing account yet.')).toHaveCount(0)
  await expect(toastWith(page, 'Please try again')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('POLAR_')
  // The item comes back rather than staying stuck pending: a failure the player
  // cannot retry is the same dead end as no message at all. It is asserted
  // WHILE THE MENU IS STILL OPEN, which is only possible because
  // app-menu.tsx's onSelect calls preventDefault — a menu that closed on select
  // would have unmounted the item along with its spinner, and there would be
  // nothing left to assert about.
  await expect(billing).toBeEnabled()

  // AND THEN CLOSED, WHICH IS LOAD-BEARING FOR EVERYTHING BELOW. That same
  // preventDefault means the menu is still open here, and an open Radix menu
  // lays an overlay over the page and sets `pointer-events: none` on the body —
  // so the team-picker click below is swallowed and times out waiting for a
  // button that is plainly visible. Measured: this is exactly how this test
  // failed first time round, 2m into a 2m budget, pointing at the team picker
  // rather than at the menu that was covering it.
  await closeAppMenu(page)

  // ── The team-picker CTA, which is the SECOND upgrade entry point ──────────
  // Both reach the same action, and both stay: two entry points to one upgrade
  // is what v1 had in the equivalent places. FREE_TEAM_LIMIT is 2 and the seed
  // gives one team, so one more is what swaps team-picker.tsx's "New Team" for
  // "Upgrade for more" (it gates on `!isPro && teams.length >= FREE_TEAM_LIMIT`).
  await noToasts(page)
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
  // THE SAME SENTENCE THE HEADER GAVE, because Task 12 made both call one
  // shared lib/use-start-upgrade.ts rather than two hand-written copies — and
  // `noToasts` above is what stops this assertion passing on the header's toast
  // instead of this one's.
  await expect(toastWith(page, 'Upgrades are unavailable.')).toBeVisible({ timeout: 15_000 })
  await expect(toastWith(page, 'Coming soon')).toHaveCount(0)
  await expect(toastWith(page, 'Please try again')).toHaveCount(0)

  // ── The return leg from checkout (wordle-teams-wxg) ───────────────────────
  // NO REAL CHECKOUT IS NEEDED TO REACH THIS, and none can be driven: with no
  // POLAR_* variable set, createProCheckout never returns a URL. But the state
  // Polar leaves the browser in is entirely a query parameter —
  // `${SITE_URL}/app?checkout=success`, convex/polar.ts — so visiting it is the
  // real thing. This account is still free, which is precisely the case the
  // pending notice exists for.
  await page.goto('/app?checkout=success')
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
  // app.tsx's grid-cols-1 note records what a single over-wide child does to
  // this page: a document-wide horizontal scrollbar with everything pushed edge
  // to edge. Resized here rather than in a test of its own because the only
  // thing a separate test would add is another OTP sign-in.
  await page.setViewportSize({ width: 390, height: 844 })
  // UPGRADE IS THE ONLY OCCUPANT LEFT AT 390px, WHICH IS THE POINT OF
  // wordle-teams-lyab. This is the width the issue's screenshots were taken at:
  // the old bar put Billing, the avatar, the menu trigger and an "Auto" theme
  // pill in one row and wrapped Home/About onto a second line beneath them.
  // Upgrade's label is `hidden sm:inline` here, so it is an icon and an
  // aria-label — which icon it carries is pinned in
  // src/components/Header.hook.test.ts, because this assertion passes with the
  // wrong one.
  await expect(upgradeButton(page)).toBeVisible()
  // AND BILLING IS REACHABLE, not merely gone. "Moved into the menu" and
  // "deleted" look identical from the bar, and only one of them is the change
  // that was made.
  await openAppMenu(page)
  await expect(billingItem(page)).toBeVisible()
  await closeAppMenu(page)
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

  // BILLING HAS NO isPro CONDITION, so `isAuthenticated` is the only thing
  // keeping it off this page — which makes this the assertion that stops
  // "unconditional for a signed-in player" turning into "offered to anyone".
  //
  // AND THE MENU IS OPENED TO PROVE IT, WHICH IS NEW AND IS THE WHOLE REASON
  // THIS ASSERTION STILL EARNS ITS PLACE. Since wordle-teams-lyab the menu
  // renders for a signed-out visitor too — it holds the nav and the theme
  // control, which a visitor on /login needs — so `toHaveCount(0)` against the
  // closed bar would now pass trivially, whatever the menu contained. The item
  // has to be absent from an OPEN menu.
  await openAppMenu(page)
  await expect(billingItem(page)).toHaveCount(0)
  // Log out is the same leak wearing a different hat: offering it to a visitor
  // with no session would call signOut against nothing.
  await expect(page.getByRole('menuitem', { name: 'Log out' })).toHaveCount(0)
  await closeAppMenu(page)
  // NOR THE UPGRADE BUTTON, which is the assertion Task 12 added: `isPro` is
  // undefined for a signed-out visitor, so a `!isPro` spelling of its condition
  // would offer checkout to somebody with no account.
  await expect(upgradeButton(page)).toHaveCount(0)
  await expect(page.getByText(/Invites? Pending/)).toHaveCount(0)
})
