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

/**
 * THE CEILING FOR THE FIRST ASSERTION AFTER `goto`, AND FOR NOTHING ELSE
 * (wordle-teams-usgy).
 *
 * TeamSection renders `null` — not a skeleton, not an empty card — until BOTH
 * of its queries have come back: getMyTeams, then teamMonth keyed on the team
 * it returns (routes/insights.tsx `if (!teamId || !data) return null`). So
 * between arriving on /insights and that pair resolving, a locator for the fact
 * or the panel matches nothing, and it is indistinguishable from the page being
 * wrong. There is no loading marker to wait on instead: `insights-loading`
 * belongs to the benchmark query, which is a different read entirely.
 *
 * Every seed above is AWAITED over HTTP before sign-in, so the data is
 * demonstrably in the database by the time the browser is pointed at the page.
 * What is being waited on here is therefore page load, auth handshake and two
 * chained reactive queries — the genuinely unbounded part — which is exactly
 * where wordle-teams-h1rg says the generosity belongs.
 *
 * IT DOES NOT SOFTEN WHAT THESE TESTS CHECK. Only the "is it here at all"
 * assertion carries it; every claim about WHAT IT SAYS keeps the suite's strict
 * 5s default, so a fact that renders the wrong sentence still fails fast.
 */
const FIRST_PAINT = { timeout: 20_000 }

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
    await expect(fact).toBeVisible(FIRST_PAINT)
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
    await expect(fact).toBeVisible(FIRST_PAINT)
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

    await expect(page.getByTestId('insights-team')).toBeVisible(FIRST_PAINT)
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

    /*
      THE TWO FIGURES SEPARATELY, NOT THE OLD "1-0" STRING. A two-person team
      renders the versus block rather than the list, so wins and losses are two
      elements and the dash-joined form no longer exists in the DOM — the same
      change team-panel.hook.test.ts made for the same reason.

      THIS IS NOT A WEAKENED ASSERTION. It pins an exact element count, which
      the substring never did, and it still checks both halves of what this
      test's name promises: the teammate is named, and the shared-day
      denominator is stated. A record of 1-0 over one shared day is what the
      seed produces.
    */
    await expect(record).toContainText('PlayerB', FIRST_PAINT)
    const figures = record.getByTestId('insights-versus-figure')
    await expect(figures).toHaveCount(2)
    await expect(figures.nth(0)).toHaveText('1')
    await expect(figures.nth(1)).toHaveText('0')
    await expect(record).toContainText('1 shared day')
  })
})
