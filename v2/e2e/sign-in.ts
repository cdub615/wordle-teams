import { expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import type { Page } from '@playwright/test'

/**
 * Signs a page in through the emailed-OTP path.
 *
 * RETURNS ONLY ONCE THE SIGN-IN HAS LANDED — the post-verify document load has
 * finished and the page is off /login. It used to return on the click instead,
 * which is what made wordle-teams-1cd flake; see the wait at the bottom.
 *
 * Extracted from login.spec.ts (wt-ksh.3.11) so board-entry.spec.ts does not
 * carry a second, drifting copy of the same mechanics. Reads the code back
 * through testOtps.takeFor rather than an inbox — see that mutation's
 * comment for the E2E_TEST_MODE / e2e+* guards that make this safe.
 *
 * Returns the email used so a caller that needs data seeded for this exact
 * account (board-entry.spec.ts giving it a team) can do so before or after
 * calling this.
 *
 * THE DEFAULT ADDRESS CARRIES A RANDOM SUFFIX, not just a timestamp. Playwright
 * runs specs in parallel and playwright.config.ts pins no `workers`, so two
 * workers calling this in the same millisecond would otherwise share an
 * account — and since Phase 4 that account owns a `players` row, so the second
 * caller would find a profile already completed and land on the dashboard
 * instead of /complete-profile, for a reason nobody would guess from the
 * failure. Same shape the spec-local helpers in board-entry.spec.ts and
 * teams.spec.ts already use.
 */
export async function signIn(
  page: Page,
  email: string = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`,
): Promise<string> {
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  await page.goto('/login')

  // No retry-until-hydrated loop any more, and its absence is the regression
  // test for wt-ksh.2.2. This used to need one: the SSR form rendered
  // interactive before hydration, so a click submitted natively and the
  // controlled input wiped what had been typed. The submit button is now
  // disabled until hydrated and the inputs are uncontrolled, so waiting for the
  // button to be enabled is sufficient — and if either regresses, this fails.
  await expect(page.getByRole('button', { name: /send code/i })).toBeEnabled()

  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: /send code/i }).click()
  await expect(page.getByLabel('Code')).toBeVisible({ timeout: 8000 })

  // takeFor is a mutation, not a query: it deletes the row as it returns it, so
  // a captured code cannot outlive this read (wt-ksh.1.14). Once it yields a
  // value the poll must stop asking, hence the ??= — a second call would return
  // null and fail the assertion.
  let otp: string | null = null
  await expect
    .poll(async () => (otp ??= await convex.mutation(api.testOtps.takeFor, { email })), {
      timeout: 15_000,
    })
    .not.toBeNull()

  await page.getByLabel('Code').fill(otp!)
  await page.getByRole('button', { name: /verify/i }).click()

  // THIS WAIT IS THE FIX FOR wordle-teams-1cd, AND IT IS NOT PADDING. Without
  // it this helper returned the instant the click was dispatched, so everything
  // the click sets in motion was billed to whatever the caller asserted next —
  // and that assertion carries Playwright's 5s default. login.tsx's verifyCode
  // finishes with `window.location.href = '/app?signin=otp'`, a FULL DOCUMENT
  // LOAD, so the caller's first assertion had to absorb: the Better Auth verify
  // round-trip, a fresh SSR of '/app' (its beforeLoad awaits
  // players.needsProfile, then its loader awaits getMyTeams, amIPro and
  // getMyPlayerId one after the other), several hundred module requests from
  // the dev server, and hydration.
  //
  // MEASURED, 54 sign-ins over three full-suite runs: 0.76s to 3.96s, median
  // ~2.2s. Against a 5s ceiling that also had to cover the assertion itself,
  // which is why the failure was intermittent and why it landed on whichever
  // spec happened to be signing in while the others were — never on a faulty
  // spec. The call log said it plainly every time: "waiting for
  // /app?signin=otp navigation to finish".
  //
  // NOT A CONVEX CONTENTION BUG, which was the other candidate. Six concurrent
  // sign-ins driven straight through /api/auth (no browser) took 1.2-1.5s each
  // against 0.58s for one alone — 2.2x wall-clock for 6x concurrency, so
  // nothing on the auth path serialises. The seconds are browser-side document
  // load, which is dev-server cost the product does not pay.
  //
  // 20s is ~5x the measured worst case and still inside Playwright's 30s
  // default test timeout, so a sign-in that genuinely never lands fails HERE,
  // naming the sign-in, instead of being reported as a missing team card.
  //
  // The predicate is "left /login" rather than the exact destination because
  // both are correct outcomes: an account with a players row lands on
  // '/app?signin=otp', one without is redirected to /complete-profile by
  // app.tsx's beforeLoad. Callers still assert the destination they expect — see
  // login.spec.ts's toHaveURL('/complete-profile') — so this weakens nothing.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })

  return email
}
