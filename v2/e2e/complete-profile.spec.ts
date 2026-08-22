import { expect, test } from '@playwright/test'
import { signIn } from './sign-in'

/**
 * Onboarding, end to end (wt-ksh.5.18).
 *
 * THIS FILE EXISTS BECAUSE THE UNIT SUITE CANNOT REACH THIS CODE AT ALL
 * (wordle-teams-obw): convex-test cannot stand up a Better Auth session, so the
 * body of every authed query and mutation wrapper — `needsProfile` included —
 * is unreachable there, and `needsProfile` is the one whose inversion is
 * catastrophic rather than merely wrong. Inverted, it is either an infinite
 * redirect to a form the user has already filled in, or an onboarding form
 * nobody with an incomplete profile ever sees. Nothing else in the repo catches
 * that. Driving a brand-new address through the real route exercises the
 * predicate in BOTH directions against a real deployment, which is the whole
 * point — obw explicitly rules out "fixing" this by extracting a
 * `needsProfileFor` helper for a single row-existence check.
 *
 * Every account here is created by signIn() and never seeded, which is what
 * makes it a cold signup: e2eSeed's helpers exist precisely because a fresh
 * sign-in has no players row at all.
 */

test('a cold signup lands on /complete-profile and reaches the dashboard once named', async ({
  page,
}) => {
  await signIn(page)

  // DIRECTION ONE — needsProfile true. Before Task 6 this account reached the
  // dashboard instead: getMyTeams returns [] for a playerless caller rather
  // than throwing, so the empty state rendered, and the only call to action on
  // it failed with NO_PLAYER (wt-ksh.5.1).
  await expect(page).toHaveURL('/complete-profile')
  await expect(page.getByRole('heading', { name: /complete your profile/i })).toBeVisible()

  await page.getByLabel('First Name').fill('E2E')
  await page.getByLabel('Last Name').fill('Onboarder')
  await page.getByRole('button', { name: 'Submit' }).click()

  // DIRECTION TWO — needsProfile false, which is the half that cannot be
  // asserted anywhere else. The dashboard's own beforeLoad re-reads the
  // predicate on this hop, so arriving here at all proves the mutation flipped
  // it; the empty state proves the page rendered through rather than dying on
  // NO_PLAYER.
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: /not on a team yet/i })).toBeVisible()

  // AND STAYS. A cached `true` surviving the hop would bounce the user back to
  // the form they just completed — the loop obw warns about — and would do it
  // slightly after arrival, so this reloads rather than merely re-reading the
  // URL a moment later.
  await page.reload()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: /not on a team yet/i })).toBeVisible()

  // The guard runs the other way too: with a player, the form is unreachable.
  await page.goto('/complete-profile')
  await expect(page).toHaveURL('/')
})

test('a name of only whitespace is refused locally, with an error and no navigation', async ({
  page,
}) => {
  await signIn(page)
  await expect(page).toHaveURL('/complete-profile')

  // Submit is gated on HYDRATION ALONE, never on the content of the fields —
  // a content-gated `disabled` takes the button out of the focus order, kills
  // Enter and hover, and explains nothing. Empty fields must still leave a
  // live button.
  await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled()

  // OFFLINE ON PURPOSE, and it is what gives this test teeth. Whitespace
  // satisfies the fields' `required` but not isCompleteName, and the server
  // rejects the same input with the same INVALID_NAME copy — so a run with the
  // network up cannot tell a local rejection from a round trip, and deleting
  // the client-side check would leave this test green. With no network, only
  // the local check can produce the message at all.
  await page.context().setOffline(true)
  try {
    await page.getByLabel('First Name').fill('   ')
    await page.getByLabel('Last Name').fill('   ')
    await page.getByRole('button', { name: 'Submit' }).click()

    await expect(page.getByRole('alert')).toHaveText('Enter both a first and a last name.')
    await expect(page).toHaveURL('/complete-profile')
  } finally {
    await page.context().setOffline(false)
  }

  // The alert is not sticky: a real name clears it and saves.
  await page.getByLabel('First Name').fill('Ada')
  await page.getByLabel('Last Name').fill('Lovelace')
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: /not on a team yet/i })).toBeVisible()
})

test('a one-character first and last name saves without bouncing back', async ({ page }) => {
  // v1's own latent bug, asserted so v2 cannot reacquire it: v1 saved any
  // non-empty name but guarded its /complete-profile redirect on `length > 1`,
  // so a one-character name saved and then redirected to the form forever. v2
  // has no second opinion — needsProfile checks for a ROW.
  await signIn(page)
  await expect(page).toHaveURL('/complete-profile')

  await page.getByLabel('First Name').fill('A')
  await page.getByLabel('Last Name').fill('B')
  await page.getByRole('button', { name: 'Submit' }).click()

  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: /not on a team yet/i })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL('/')
})

test('without JavaScript the form cannot be submitted before it is interactive', async ({
  page,
  browser,
}) => {
  // `!hydrated` is the ONLY thing that disables Submit now, which makes it
  // load-bearing rather than incidental: with JavaScript off the page still
  // renders — it is server-rendered — and that is exactly the state a real user
  // sees for the moments before hydration. A click then fires a native GET that
  // carries nothing and reads as a broken app, on the screen that creates the
  // account. Directly analogous to login.spec.ts's assertion of the same
  // guarantee (wt-ksh.2.2).
  //
  // The session has to be minted with JavaScript ON — the OTP flow is a React
  // form — so this hands the signed-in cookies to a second, script-free context
  // rather than declaring `javaScriptEnabled: false` for the whole test. That
  // also means baseURL has to be passed explicitly: a context built by hand
  // does not inherit playwright.config.ts's `use`.
  await signIn(page)
  await expect(page).toHaveURL('/complete-profile')
  const storageState = await page.context().storageState()

  const scriptless = await browser.newContext({
    javaScriptEnabled: false,
    storageState,
    baseURL: 'http://localhost:3000',
  })
  try {
    const bare = await scriptless.newPage()
    await bare.goto('/complete-profile')
    await expect(bare.getByRole('heading', { name: /complete your profile/i })).toBeVisible()
    await expect(bare.getByRole('button', { name: 'Submit' })).toBeDisabled()
  } finally {
    await scriptless.close()
  }
})
