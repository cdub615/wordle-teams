import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { toPuzzleDay } from '../convex/lib/puzzleDay.ts'
import { signIn } from './sign-in'

/**
 * THE CLUE LADDER, END TO END (wordle-teams-9j7o.2.3): an opted-in player opens
 * today's card, places the five shapes, locks in on clue 1, reads the result,
 * and finds the card saying so back on the dashboard.
 *
 * THE DEPLOYMENT MUST HAVE CLUE_LADDER_ENABLED AND CLUE_LADDER_SEED SET
 * (deploy-v2.yml does). Without them the card never appears and this fails at
 * its first assertion rather than passing vacuously.
 *
 * The answer comes from e2eSeed.seedClueLadderFor: lock-in is one try.
 */
const TIMEOUT = { timeout: 15_000 }

/** The first assertion after a navigation pays for it — see onboarding.spec.ts's DASHBOARD_READY. */
const DASHBOARD_READY = { timeout: 20_000 }

test('an opted-in player solves today’s clue ladder on clue 1', async ({ page }) => {
  const email = `e2e+clue-${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  const { answer } = await convex.mutation(api.e2eSeed.seedClueLadderFor, { email, today: toPuzzleDay(new Date()) })
  await signIn(page, email)

  const card = page.getByRole('region', { name: "Today's clue ladder", exact: true })
  await expect(card).toBeVisible(DASHBOARD_READY)
  await card.getByRole('link', { name: 'Play', exact: true }).click()
  await expect(page).toHaveURL(/\/play\/clue-ladder/, TIMEOUT)
  // Opening the page starts the game (departure 5), which reveals clue 1.
  await expect(page.getByRole('list', { name: 'Clues', exact: true }).getByRole('listitem')).toHaveCount(1, TIMEOUT)

  const tray = page.getByRole('group', { name: 'Shapes to place', exact: true })
  for (const [i, shape] of answer.entries()) {
    await tray.getByRole('button', { name: shape, exact: true }).click()
    await page.getByRole('button', { name: `Slot ${i + 1}, empty`, exact: true }).click()
  }
  await page.getByRole('button', { name: 'Lock in', exact: true }).click()
  await page.getByRole('button', { name: 'Yes, lock in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Solved on clue 1', exact: true })).toBeVisible(TIMEOUT)

  // TWO LINKS ARE NAMED "Back to dashboard" here: the route header's icon link
  // (aria-label, no text) and the finished screen's button (text). The page has
  // no <main>, so the text is what tells them apart.
  await page.getByRole('link', { name: 'Back to dashboard', exact: true }).filter({ hasText: 'Back to dashboard' }).click()
  await expect(page.getByRole('region', { name: "Today's clue ladder", exact: true })).toContainText(
    'Solved on clue 1',
    DASHBOARD_READY,
  )
})
