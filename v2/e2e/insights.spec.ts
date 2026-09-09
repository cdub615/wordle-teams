import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import type { Page } from '@playwright/test'

/**
 * THE INSIGHTS PAYWALL, ACROSS HTTP.
 *
 * BECAUSE THE FOUR GATES DO NOT CROSS IT. Everything below is proven in unit
 * tests as a rule — lib/insightsAccess.test.ts for the tier, insights-panel and
 * insights-personal for the sentences, insights.hook.test.ts for the render. What
 * none of them can prove is that a real signed-in session, hitting a real
 * deployment over HTTP, is handed the right one. That join is what this file is.
 *
 * IT IS A GATE NOW, WHICH IT WAS NOT WHEN THE SPEC WAS WRITTEN. The spec's
 * testing section says e2e is not a gate, citing wt-ksh.8.49. As of
 * wordle-teams-z6v4 Playwright runs in deploy-v2.yml against a local Convex
 * backend before any deploy step, so an assertion here blocks a deploy rather
 * than waiting for somebody to remember to run it.
 *
 * THE TRIAL IS SEEDED RATHER THAN EARNED, and convex/e2eSeed.ts's
 * seedInsightsFor explains why: LAUNCH_AT is a 2099 placeholder, so no board a
 * test could enter would start a trial, and a spec that tried would assert
 * nothing until the day the owner sets the real date. The clock's own rules are
 * proven against real documents in convex/insightsTrial.test.ts. What crosses
 * HTTP here is the STATE and what the server does with it.
 */

const DAY = 86_400_000

/** A day comfortably inside the corpus, so the difficulty half resolves too. */
const LAST_DAY = '2026-08-20'

async function signInWithInsights(
  page: Page,
  options: { boards: number; pro: boolean; trialEndsAt?: number },
): Promise<string> {
  const email = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await convex.mutation(api.e2eSeed.seedInsightsFor, {
    email,
    boards: options.boards,
    lastDay: LAST_DAY,
    pro: options.pro,
    trialEndsAt: options.trialEndsAt,
  })
  await signIn(page, email)
  return email
}

/** Waits for the lazily-fetched corpus to arrive and the panel to render. */
async function openInsights(page: Page) {
  await page.goto('/insights')
  await expect(page.getByTestId('insights-attribution')).toBeVisible()
}

test.describe('a free player', () => {
  test('sees the benchmark for exactly one board, and no personal history', async ({ page }) => {
    await signInWithInsights(page, { boards: 12, pro: false })
    await openInsights(page)

    // Twelve boards were seeded and the server sent one. This is the paywall
    // itself: a client that received twelve and rendered one would pass a DOM
    // assertion and be wrong in the only way that matters.
    await expect(page.getByTestId('insights-board')).toHaveCount(1)
    await expect(page.getByTestId('insights-personal')).toHaveCount(0)
    await expect(page.getByTestId('insights-personal-thin')).toHaveCount(0)
    await expect(page.getByTestId('insights-upsell')).toBeVisible()
  })

  test('and never sees a fabricated zero', async ({ page }) => {
    await signInWithInsights(page, { boards: 3, pro: false })
    await openInsights(page)

    const board = (await page.getByTestId('insights-board').textContent()) ?? ''

    /*
      MATCHED AGAINST THE SENTENCES, NOT AGAINST LOOSE DIGITS, because a bare
      `not.toContain('0th')` is wrong rather than merely weak: the card's own date
      heading reads "Thu 20th", so it fails on a perfectly correct card. Found by
      running it. The fault this guards is a rank or a percentile of zero, so the
      assertion names those two phrasings.
    */
    expect(board).not.toContain('ranks 0th')
    expect(board).not.toContain('Harder than 0%')

    // And the positive half, which is what proves the corpus really arrived over
    // HTTP rather than the panel degrading quietly to its absent state.
    expect(board).toMatch(/ranks [\d,]+(st|nd|rd|th) of 14,855/)
    expect(board).not.toContain('is not in the benchmark set')
  })
})

test.describe('a trial player', () => {
  test('sees the FULL personal history, but Layer 1 still at one board', async ({ page }) => {
    await signInWithInsights(page, {
      boards: 12,
      pro: false,
      trialEndsAt: Date.now() + 10 * DAY,
    })
    await openInsights(page)

    /*
      THE REGRESSION THIS TEST EXISTS FOR, AND THE ONE IT ORIGINALLY GOT WRONG.

      The trial grants Layer 2 without Layer 1, so a read keyed on Layer 1 alone
      hands a trialist ONE board and a personal history computed from it — every
      number correct, the feature worthless, during the exact month they are
      deciding whether to pay. That is what the payload having full history fixes,
      and it is asserted by the personal history rendering below.

      BUT THE PAYLOAD IS NOT THE PERMISSION. An earlier version of this test
      asserted twelve BENCHMARK cards, which encoded the opposite bug: Layer 1 is
      still 'free' during the trial, so its list must stay at the single most
      recent board. The owner found the symptom — a page buried under hundreds of
      daily cards — and the leak with it.
    */
    await expect(page.getByTestId('insights-board')).toHaveCount(1)
    await expect(page.getByTestId('insights-personal')).toBeVisible()
    await expect(page.getByTestId('insights-headline')).toContainText('You have opened with')
  })

  test('and an EXPIRED trial flips them back to the free view', async ({ page }) => {
    await signInWithInsights(page, {
      boards: 12,
      pro: false,
      trialEndsAt: Date.now() - DAY,
    })
    await openInsights(page)

    await expect(page.getByTestId('insights-board')).toHaveCount(1)
    await expect(page.getByTestId('insights-personal')).toHaveCount(0)
    // The hard constraint: an expired trial takes nothing away from the free
    // tier. They still get a benchmark, not an empty screen.
    await expect(page.getByTestId('insights-board')).toBeVisible()
  })
})

test.describe('a pro player', () => {
  test('sees the benchmark for every board and the personal history', async ({ page }) => {
    await signInWithInsights(page, { boards: 12, pro: true })
    await openInsights(page)

    await expect(page.getByTestId('insights-board')).toHaveCount(12)
    await expect(page.getByTestId('insights-personal')).toBeVisible()
    await expect(page.getByTestId('insights-upsell')).toHaveCount(0)
    // And the list is bounded rather than a wall of cards above everything else.
    await expect(page.getByTestId('insights-daily-scroll')).toBeVisible()
    await expect(page.getByTestId('insights-daily-count')).toContainText('Showing 12 of 12')
  })
})

test.describe('the CC BY 4.0 attribution', () => {
  /**
   * ASSERTED AS A VISIBLE ELEMENT WITH ITS TEXT, NOT AS A SUBSTRING OF
   * page.content(), and that is a deliberate departure from how the task words
   * it. routes.spec.ts argues the case at length for /privacy: a
   * `content().toContain(...)` passes on a page that merely MENTIONS the string,
   * and it passes on markup that is present but not rendered. A visible locator
   * is the stronger assertion, not the weaker one.
   *
   * It cannot be in the SSR document in any case, and that is by design rather
   * than an oversight: the credit is read out of the corpus artifact so it cannot
   * drift from the data it credits, and the corpus is fetched lazily on the
   * client — which is the whole reason a player who never opens insights never
   * pays for it.
   */
  test('is visible to a free player on their very first board', async ({ page }) => {
    // Acceptance criterion 5, end to end: one board, no tier, credit shown.
    await signInWithInsights(page, { boards: 1, pro: false })
    await openInsights(page)

    const credit = page.getByTestId('insights-attribution')
    await expect(credit).toBeVisible()
    await expect(credit).toContainText('FiveLetterWords.io')
    await expect(credit).toContainText('CC BY 4.0')
    await expect(credit.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by/4.0/',
    )
  })

  test('and to a pro player, since it is not a free-tier feature', async ({ page }) => {
    await signInWithInsights(page, { boards: 6, pro: true })
    await openInsights(page)
    await expect(page.getByTestId('insights-attribution')).toContainText('CC BY 4.0')
  })
})

test.describe('the route itself', () => {
  test('redirects a signed-out visitor to /login', async ({ page }) => {
    await page.goto('/insights')
    await expect(page).toHaveURL(/\/login/)
  })
})
