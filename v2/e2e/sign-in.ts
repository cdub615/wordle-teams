import { expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import type { Page } from '@playwright/test'

/**
 * Signs a page in through the emailed-OTP path.
 *
 * Extracted from login.spec.ts (wt-ksh.3.11) so board-entry.spec.ts does not
 * carry a second, drifting copy of the same mechanics. Reads the code back
 * through testOtps.takeFor rather than an inbox — see that mutation's
 * comment for the E2E_TEST_MODE / e2e+* guards that make this safe.
 *
 * Returns the email used so a caller that needs data seeded for this exact
 * account (board-entry.spec.ts giving it a team) can do so before or after
 * calling this.
 */
export async function signIn(
  page: Page,
  email: string = `e2e+${Date.now()}@wordleteams.com`,
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

  return email
}
