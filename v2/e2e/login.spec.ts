import { test, expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

test('signs in with an emailed OTP code', async ({ page }) => {
  const email = `e2e+${Date.now()}@wordleteams.com`
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

  await expect(page.getByTestId('signed-in-email')).toContainText(email)

  // The copied-data panel must RENDER, because that is what makes Phase 1's
  // done-when observable. This test account has no copied player, so the
  // expected outcome is the explicit "no match" branch rather than teams —
  // asserting the panel exists still catches the failure that actually
  // happened: a missing me:myData function took the whole signed-in page down
  // with a server error, and nothing else in this test noticed.
  await expect(page.getByTestId('copied-data')).toBeVisible()
  await expect(page.getByTestId('no-player')).toBeVisible()
})

// javaScriptEnabled is a context OPTION, so it has to be declared for the block
// rather than toggled inside a test.
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the form cannot be submitted before it is interactive', async ({ page }) => {
    // Directly asserts the wt-ksh.2.2 guarantee rather than inferring it. With
    // JavaScript off the page still renders — it is server-rendered — which is
    // exactly the state a real user sees for the moments before hydration. The
    // submit button must never be clickable then, because a click would fire a
    // native GET that carries nothing and reads as a broken app.
    await page.goto('/login')

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /send code/i })).toBeDisabled()
  })
})
