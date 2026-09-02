import { expect, type Page } from '@playwright/test'

/**
 * Fills the profile form and does not return until the app has left
 * `/complete-profile`.
 *
 * THE WAIT IS THE WHOLE POINT, and it is the same fix `sign-in.ts` carries one
 * hop earlier (`wordle-teams-1cd`). Without it the helper returns the instant
 * the click is dispatched, so everything the click sets in motion is billed to
 * whatever the caller asserts next — and that assertion carries Playwright's 5s
 * default.
 *
 * What has to happen inside those 5s: `complete-profile.tsx`'s handleSubmit
 * awaits the `completeProfile` mutation, then awaits `navigate({ to: '/app' })`;
 * `/app`'s beforeLoad calls ensureQueryData for `needsProfile` and its loader
 * then awaits `getMyTeams`, `amIPro` and `getMyPlayerId` SEQUENTIALLY. That is
 * the same shape of tail `1cd` measured at 0.76-3.96s for the sign-in hop, on a
 * dev server, under parallel workers.
 *
 * OBSERVED, not theorised. Full-suite run 2026-09-02, after the read-set fix in
 * `convex/e2eSeed.ts` removed the OptimisticConcurrency failures, two specs
 * failed with the page still ON `/complete-profile` when a 5s `toHaveURL` gave
 * up — `routes.spec.ts:146` expecting `/app` and `invites.spec.ts:213`
 * expecting `/?team=`. Both passed in isolation. That is the signature.
 *
 * NOT A RAISED CEILING. `wt-ksh.8.51` is explicit that `1cd`'s fix was the
 * helper's contract and not the timeout, and blanket-widening the callers'
 * assertions would hide a real stall instead of absorbing a known one. The 20s
 * here mirrors sign-in.ts: ~5x the measured worst case, still inside
 * Playwright's 30s test timeout, so a profile submit that genuinely never lands
 * fails HERE, naming the submit, rather than surfacing as a missing team card
 * three assertions later.
 *
 * THE PREDICATE IS "LEFT /complete-profile", NOT A DESTINATION, because there is
 * more than one correct landing: a plain signup goes to `/app`, and an invited
 * address goes to `/?team=<id>`. Callers still assert the destination they
 * expect, so this weakens nothing — it only stops them paying for the hop.
 */
export async function completeProfile(
  page: Page,
  { firstName = 'E2E', lastName = 'Tester' }: { firstName?: string; lastName?: string } = {},
): Promise<void> {
  // Gated on hydration alone, never on field content — see
  // complete-profile.spec.ts:67. Asserting it here means a submit that was
  // dispatched into a dead button fails on the button rather than on the URL.
  await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled()

  await page.getByLabel('First Name').fill(firstName)
  await page.getByLabel('Last Name').fill(lastName)
  await page.getByRole('button', { name: 'Submit' }).click()

  await page.waitForURL((url) => !url.pathname.startsWith('/complete-profile'), { timeout: 20_000 })
}
