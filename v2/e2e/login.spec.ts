import { test, expect } from '@playwright/test'
import { signIn } from './sign-in'

test('signs in with an emailed OTP code', async ({ page }) => {
  await signIn(page)

  // The Phase 1 debug view this used to assert against (getByTestId
  // 'signed-in-email' / 'copied-data' / 'no-player') was replaced by the real
  // dashboard when Task 6 rewrote routes/index.tsx (2df6872) — nothing here
  // touches that; the same UI is gone for every caller, and this drifted out
  // of sync because no e2e run caught it at the time. '/' is guarded by
  // __root's beforeLoad, which bounces an unauthenticated visitor to
  // /login — reaching it at all is now the observable "the OTP round-trip
  // worked" signal. This account is freshly minted and was never given a
  // team, so the dashboard's empty state is the current analogue of the old
  // "no-player" assertion: it proves the signed-in page rendered all the way
  // through rather than dying on a server error, exactly what the old
  // copied-data assertion was guarding against. Task 13 (wt-ksh.4.30) replaced
  // the placeholder paragraph with TeamsEmptyState, whose heading is a real
  // <h1> rather than text alone.
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: /not on a team yet/i })).toBeVisible()
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
