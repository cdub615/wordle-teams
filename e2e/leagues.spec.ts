import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { completeProfile } from './complete-profile'

/**
 * PUBLIC LEAGUES, END TO END (zic8.3): a teamless player picks an opener from
 * the onboarding card and sees their group on the standings page.
 *
 * THE DEPLOYMENT MUST HAVE LEAGUES_ENABLED SET (deploy-v2.yml does, beside
 * E2E_TEST_MODE). Without it the onboarding step never appears and this fails
 * at its first assertion rather than passing vacuously.
 *
 * SCOPED TO THE PICKER'S GROUP, NOT A BARE BUTTON NAME. The dashboard's leagues
 * card titles itself "Pick your opener" too, and the group names are short
 * words; `role="group"` named "Pick your opener" is GroupPicker's own label on
 * the standings page (league-page-view.tsx).
 *
 * A unique email per run, same as signIn()'s default: every spec shares one
 * Convex backend, so a reused address would arrive already in a league and the
 * onboarding step (shown only to a player who has never joined) would be gone.
 */
const TIMEOUT = { timeout: 15_000 }

/** The first assertion after a navigation pays for it — see onboarding.spec.ts's DASHBOARD_READY. */
const DASHBOARD_READY = { timeout: 20_000 }

test('a teamless player joins CRANE from onboarding and sees it on the standings', async ({ page }) => {
  const email = `e2e+league-${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  await new ConvexHttpClient(process.env.VITE_CONVEX_URL!).mutation(api.e2eSeed.ensureLeagueFor, { email })

  await signIn(page, email)
  await completeProfile(page)

  const step = page.getByRole('button', { name: /Pick your opener/ })
  await expect(step).toBeVisible(DASHBOARD_READY)
  await step.click()
  await expect(page).toHaveURL(/\/leagues\/starting-words$/, TIMEOUT)

  await page.getByRole('group', { name: 'Pick your opener' }).getByRole('button', { name: 'CRANE', exact: true }).click()
  await expect(page.getByTestId('league-membership')).toContainText('You play for CRANE', TIMEOUT)
  await expect(page.getByTestId('standing-CRANE')).toContainText('you', TIMEOUT)
})
