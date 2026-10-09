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
 * THE JOIN IS SCOPED TO THE JOIN SECTION, NOT A BARE BUTTON NAME. The page
 * has more than one "Join"-ish control and CRANE appears as a quick pick and
 * as a standings row, so the word box and its Join button are found inside
 * the "Join the opener wars" region (league-page-view.tsx). That name is also
 * the onboarding step's button and the card's title, so on the dashboard it
 * is matched as a BUTTON, never as bare text.
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

  const step = page.getByRole('button', { name: /Join the opener wars/ })
  await expect(step).toBeVisible(DASHBOARD_READY)
  await step.click()
  await expect(page).toHaveURL(/\/leagues\/starting-words$/, TIMEOUT)

  // BY WORD, NOT THE QUICK PICK: typing exercises the open-word path (the lazy
  // answer list, then joinWord). Join stays disabled until that list arrives,
  // so toBeEnabled is the wait for it. CRANE is seeded, so it is always valid.
  const join = page.getByRole('region', { name: 'Join the opener wars' })
  await join.getByLabel('Any Wordle answer word').fill('crane')
  const joinButton = join.getByRole('button', { name: 'Join', exact: true })
  await expect(joinButton).toBeEnabled(TIMEOUT)
  await joinButton.click()
  await expect(page.getByTestId('league-membership')).toContainText('You play for CRANE', TIMEOUT)
  await expect(page.getByTestId('standing-CRANE').getByText('you', { exact: true })).toBeVisible(TIMEOUT)

  // BACK ON THE DASHBOARD, STILL TEAMLESS. The leagues card's member row must
  // render on the teamless branch, and the onboarding step must be gone: the
  // absence is asserted AFTER the row is on screen, so it means "the page
  // rendered and stopped offering it", not "nothing rendered yet".
  //
  // BY THE IN-APP LINK, NOT page.goto('/app'). A hard load of /app by a
  // teamless player hangs server-side rendering (wordle-teams-vrtk; predates
  // leagues). When that is fixed, a goto here would cover it too.
  await page.getByRole('link', { name: 'Back to dashboard' }).click()
  await expect(page).toHaveURL(/\/app(\?|$)/, TIMEOUT)
  const memberRow = page.getByRole('link', { name: /CRANE/ })
  await expect(memberRow).toBeVisible(DASHBOARD_READY)
  await expect(memberRow).toHaveAttribute('href', '/leagues/starting-words')
  await expect(page.getByRole('button', { name: /Join the opener wars/ })).toBeHidden()
})
