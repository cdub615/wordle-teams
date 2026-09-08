import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { toPuzzleDay } from '../convex/lib/puzzleDay.ts'
import type { Page } from '@playwright/test'

/**
 * LAYER 3 ACROSS THE PAYWALL.
 *
 * The free team fact is the most shareable thing in the product and the ONE Layer
 * 3 surface an unpaid player ever sees, so it sits exactly on the boundary the
 * four gates do not cross. Playwright blocks a deploy (wordle-teams-z6v4), so
 * what is asserted here is a gate.
 *
 * TODAY IS THE REAL TODAY, resolved in the browser's zone the same way the route
 * does. A literal date would drift out of the aggregate's current month and the
 * spec would quietly assert an empty state forever — the failure this file exists
 * to catch, arriving as a pass.
 */

const today = toPuzzleDay(new Date())

async function seedTeamOfTwo(page: Page, options: { mine: number; theirs?: number; pro: boolean }) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const mine = `e2e+${stamp}a@wordleteams.com`
  const theirs = `e2e+${stamp}b@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  await convex.mutation(api.e2eSeed.ensureSharedTeamFor, { emailA: mine, emailB: theirs })
  await convex.mutation(api.e2eSeed.seedInsightsFor, {
    email: mine,
    boards: 0,
    lastDay: today,
    pro: options.pro,
  })
  await convex.mutation(api.e2eSeed.seedTeamDayFor, {
    email: mine,
    puzzleDay: today,
    attempts: options.mine,
  })
  if (options.theirs !== undefined) {
    await convex.mutation(api.e2eSeed.seedTeamDayFor, {
      email: theirs,
      puzzleDay: today,
      attempts: options.theirs,
    })
  }

  await signIn(page, mine)
  await page.goto('/insights')
  return { mine, theirs }
}

test.describe('a free member of a team', () => {
  test('sees the daily fact and the "see the full month" hook', async ({ page }) => {
    // They scored 3, their teammate 5, so they beat one of one.
    await seedTeamOfTwo(page, { mine: 3, theirs: 5, pro: false })

    const fact = page.getByTestId('insights-daily-fact-text')
    await expect(fact).toBeVisible()
    await expect(fact).toContainText('You beat one of one teammate')
    await expect(page.getByTestId('insights-see-full-month')).toBeVisible()

    // And NOT the paid surface.
    await expect(page.getByTestId('insights-team')).toHaveCount(0)
  })

  /**
   * THE STATE MOST LIKELY TO LOOK BROKEN, and the one a unit test is least likely
   * to be written for: on a small team early in the day this is the common case,
   * and "you beat 0 of 0 teammates" reads as a loss and a bug at once.
   */
  test('and when nobody else has entered yet, says so rather than comparing to zero', async ({
    page,
  }) => {
    await seedTeamOfTwo(page, { mine: 3, pro: false })

    const fact = page.getByTestId('insights-daily-fact-text')
    await expect(fact).toBeVisible()
    await expect(fact).toContainText('none of your 1 teammates have played yet')
    await expect(fact).not.toContainText('beat')
    // No hook off an empty comparison — that would advertise the paid surface
    // from a surface with nothing on it.
    await expect(page.getByTestId('insights-see-full-month')).toHaveCount(0)
  })
})

test.describe('a pro member of a team', () => {
  test('sees the full team surface instead of the single fact', async ({ page }) => {
    await seedTeamOfTwo(page, { mine: 3, theirs: 5, pro: true })

    await expect(page.getByTestId('insights-team')).toBeVisible()
    await expect(page.getByTestId('insights-head-to-head')).toBeVisible()
    await expect(page.getByTestId('insights-team-averages')).toBeVisible()
    await expect(page.getByTestId('insights-team-days')).toBeVisible()
    await expect(page.getByTestId('insights-team-consistency')).toBeVisible()

    // The free slice is a DIFFERENT component, not a cut-down panel, so it is
    // absent rather than expanded.
    await expect(page.getByTestId('insights-daily-fact')).toHaveCount(0)
  })

  test('and the head-to-head names the teammate and its shared-day denominator', async ({
    page,
  }) => {
    await seedTeamOfTwo(page, { mine: 3, theirs: 5, pro: true })

    const record = page.getByTestId('insights-head-to-head')
    await expect(record).toContainText('1-0')
    await expect(record).toContainText('1 shared day')
  })
})
