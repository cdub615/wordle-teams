import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { CONCEALED_MESSAGE } from '../src/components/teams/team-boards-model'

/**
 * The Team Boards panel, on the real dashboard.
 *
 * NOT THE GATE. CI runs lint, typecheck, `vitest run` and build and no
 * Playwright at all (wt-ksh.8.49), so everything this file proves that MATTERS
 * is proved again in src/components/teams/team-boards.hook.test.ts, which is
 * collected by `vitest run`. What this adds is the one thing no unit test can:
 * that the panel survives the real route, the real Convex query and a real
 * hydration in a real browser — and that the browser console stays clean while
 * it does, which is the failure v1 left two comments about.
 */

/** A fresh account with a fresh team, exactly as board-entry.spec.ts does it. */
async function signInWithTeam(page: import('@playwright/test').Page) {
  const email = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await signIn(page, email)
  return email
}

test("today's boards are concealed until you enter your own, and the console stays clean", async ({
  page,
}) => {
  // Collected from the first navigation, so a hydration mismatch on the
  // dashboard — which React reports as a console error and nothing else would
  // fail on — is a test failure here.
  const consoleErrors: Array<string> = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await signInWithTeam(page)

  const panel = page.getByRole('group', { name: 'Team boards' })
  await panel.waitFor()

  // Asserted HERE, on the first paint after hydration, which is where a
  // mismatch would be reported — not only at the end of the test, by which
  // point a failure earlier on would have skipped it.
  expect(consoleErrors).toEqual([])

  // The panel opens on today, resolved in the BROWSER's zone. Derived the same
  // way the app derives it rather than hardcoded, so this holds whenever the
  // suite runs — and it is the assertion that would fail if the day were ever
  // resolved on the server, which runs UTC.
  const todayLabel = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  await expect(page.getByRole('button', { name: todayLabel })).toBeVisible()

  // A one-player team, so exactly one slide, and it is withheld: the account is
  // brand new and has entered nothing today.
  await expect(panel.getByText(CONCEALED_MESSAGE)).toHaveCount(1)
  await expect(panel.locator('[data-slot="wordle-board"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Board Entry' }).click()
  const entry = page.getByRole('region', { name: 'Wordle Board' })
  await entry.waitFor()
  await page.keyboard.type('SPEED')
  await entry.click()
  await page.keyboard.type('CRANESPEED')
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(entry).toBeHidden()

  // The submission unlocks the day — live, through the Convex subscription, with
  // no reload — and the board that appears is the one just entered.
  await expect(panel.locator('[data-slot="wordle-board"]')).toHaveCount(1)
  await expect(panel.getByText(CONCEALED_MESSAGE)).toHaveCount(0)

  // Both day arrows are present. Whether stepping is POSSIBLE is date-dependent
  // — on the 1st of a month there is no previous day inside it, because the
  // panel is bounded to the month it has data for, and this suite really did
  // fail on a 1st the first time it ran — so the stepping itself is pinned in
  // team-boards.hook.test.ts against a fixed clock, which is also the file CI
  // actually runs. What matters here is that the controls reached the page.
  await expect(page.getByRole('button', { name: 'Previous day' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next day' })).toBeVisible()

  expect(consoleErrors).toEqual([])
})
