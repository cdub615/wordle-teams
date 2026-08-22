import { test, expect } from '@playwright/test'
import { signIn } from './sign-in'

test('signs in with an emailed OTP code', async ({ page }) => {
  await signIn(page)

  // The Phase 1 debug view this used to assert against (getByTestId
  // 'signed-in-email' / 'copied-data' / 'no-player') was replaced by the real
  // dashboard when Phase 2's Task 6 rewrote routes/index.tsx (2df6872) — the
  // same UI is gone for every caller, and this drifted out of sync because no
  // e2e run caught it at the time.
  //
  // WHERE A COLD SIGNUP LANDS CHANGED AGAIN IN PHASE 4 (wt-ksh.5.18), and this
  // is that landing spot: signIn() mints an account with no `players` row, and
  // '/' now redirects exactly that account to /complete-profile, which is the
  // whole point of the guard. Reaching an authenticated route at all remains
  // the observable "the OTP round-trip worked" signal, because BOTH of these
  // routes bounce an unauthenticated visitor to /login. Each does so in its own
  // `beforeLoad` — __root's contains no redirect at all; it resolves the
  // session (`fetchAuth`) and returns `isAuthenticated` for the child routes to
  // act on. Do not read the guard on index.tsx as redundant with something
  // inherited: deleting it ships an unguarded dashboard. The heading proves the
  // signed-in page rendered all the way through rather than dying on a server
  // error, which is what the old copied-data assertion was guarding against.
  //
  // What happens AFTER the form is submitted belongs to
  // complete-profile.spec.ts, not here; this test is about the OTP round trip.
  await expect(page).toHaveURL('/complete-profile')
  await expect(page.getByRole('heading', { name: /complete your profile/i })).toBeVisible()
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
