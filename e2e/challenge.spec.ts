import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test'

/**
 * TEAM-VS-TEAM CHALLENGES, END TO END (zic8.2.14) — the two ways a challenge
 * starts: proposed directly to another team the proposer is on, and claimed
 * through a link by somebody who was signed out when they followed it.
 *
 * WHAT ONLY THIS LAYER CAN SEE. Every verb has convex-test coverage and every
 * component renders under jsdom, but neither reaches the three hops between
 * them: the dashboard nudge leading to the card that answers it, the signed-out
 * link riding sessionStorage through /login and back to /challenge/<token>
 * (app.tsx's usePendingChallenge forward), and the claim page's navigation to
 * the team it accepted for. Each of those is pinned by a mutant that turns this
 * spec red at a named step — see the task's mutant list.
 *
 * THE DEPLOYMENT MUST HAVE CHALLENGES_ENABLED SET. Without it every query
 * answers "dark" and the card renders nothing, so this spec fails at its first
 * card assertion rather than passing vacuously. deploy-v2.yml sets it on CI's
 * local backend beside E2E_TEST_MODE.
 *
 * UNIQUE ADDRESSES PER RUN, NOT ONLY FOR THE USUAL REASON. The backend is shared
 * across runs and a team holds at most five live challenges; a fixed address
 * would re-find its "E2E Team" and fill it within five runs.
 */

const TIMEOUT = { timeout: 15_000 }
const NAV_TIMEOUT = { timeout: 20_000 }

/** challenge-scoreboard.tsx's verdict for an outcome of 'void'. */
const NO_BOARDS = 'Not enough boards yet'
/** typedCodeMessage('CHALLENGE_LINK_INVALID'), src/lib/convex-error.ts. */
const LINK_INVALID = 'That challenge link is no longer valid.'

const SEEDED_TEAM = 'E2E Team'

const convex = (): ConvexHttpClient => new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

const stampOf = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const emailFor = (role: string, stamp: string): string => `e2e+chal-${role}-${stamp}@wordleteams.com`

/** The local calendar day, which is what seedInsightsFor's `lastDay` is read as. */
function today(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** A player on their own "E2E Team", made Pro. Returns that team's id. */
async function seedProWithTeam(email: string): Promise<string> {
  const client = convex()
  const teamId = await client.mutation(api.e2eSeed.ensureTeamFor, { email })
  await client.mutation(api.e2eSeed.seedInsightsFor, { email, boards: 0, lastDay: today(), pro: true })
  return teamId
}

const challengesCard = (page: Page): Locator => page.getByRole('region', { name: 'Challenges' })

/**
 * Opens "Challenge a team" from the card. RETRIED UNTIL THE DIALOG IS UP, the
 * shape app-menu.ts uses: /team is a full document load, so a click can
 * land before hydration and do nothing. Guarded so a retry never clicks a trigger the
 * open (modal) dialog now covers.
 */
async function openProposeDialog(page: Page): Promise<Locator> {
  const card = challengesCard(page)
  // Data first: the card exists only once challengesForTeam has answered.
  await expect(card.getByRole('heading', { name: 'Challenges' })).toBeVisible(TIMEOUT)
  const dialog = page.getByRole('dialog', { name: 'Challenge a team' })
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await card.getByRole('button', { name: 'Challenge a team' }).click({ timeout: 2_000 })
    }
    await expect(dialog).toBeVisible({ timeout: 1_000 })
  }).toPass(TIMEOUT)
  return dialog
}

/**
 * A scoreboard section, named "<viewer's team> vs <the other>", carrying the
 * void verdict and no average anywhere: a just-accepted challenge's window
 * starts tomorrow, so neither side can have a board in it.
 */
async function expectFreshScoreboard(page: Page, mine: string, theirs: string): Promise<void> {
  const board = challengesCard(page).getByRole('region', { name: `${mine} vs ${theirs}` })
  await expect(board).toBeVisible(TIMEOUT)
  await expect(board.getByText(NO_BOARDS)).toBeVisible()
  await expect(board.getByText(mine, { exact: true }).first()).toBeVisible()
  await expect(board.getByText(theirs, { exact: true }).first()).toBeVisible()
  // NOT AVERAGES: formatAverage renders a number as "n.n" and null as "—".
  await expect(board.getByText(/^\d+\.\d$/)).toHaveCount(0)
}

/**
 * A context that takes shareLink's clipboard branch deterministically — the same
 * arrangement, and the same reasons, as invite-links.spec.ts's shareContext:
 * Chromium has Web Share on some hosts and not others, and only the clipboard
 * hands the URL back.
 */
async function shareContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })
  return context
}

test('a direct challenge is proposed, nudged, accepted, and scored on both sides', async ({
  browser,
}) => {
  // Two OTP sign-ins and two cross-context reactive waits; see invites.spec.ts.
  test.setTimeout(180_000)

  const stamp = stampOf()
  const emailA = emailFor('a', stamp)
  const emailB = emailFor('b', stamp)
  const rivals = `Rivals ${stamp}`

  // A (Pro) on X ("E2E Team") and Y; B on Y only. ensureTeamFor FIRST so A's
  // players row is the one ensureSharedTeamFor then finds.
  const teamX = await seedProWithTeam(emailA)
  const teamY = await convex().mutation(api.e2eSeed.ensureSharedTeamFor, {
    emailA,
    emailB,
    name: rivals,
  })

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  try {
    // 1. A proposes X -> Y.
    const pageA = await contextA.newPage()
    await signIn(pageA, emailA)
    await pageA.goto(`/team?team=${teamX}`)
    const dialog = await openProposeDialog(pageA)
    await dialog.getByRole('button', { name: rivals }).click({ timeout: 10_000 })
    await expect(pageA.getByText(`Challenge sent to ${rivals}`)).toBeVisible(TIMEOUT)
    await expect(dialog).toHaveCount(0)
    await expect(challengesCard(pageA).getByText(`Waiting for ${rivals} to answer`)).toBeVisible(
      TIMEOUT,
    )

    // 2. B sees the nudge on Y's dashboard, follows it, and accepts.
    const pageB = await contextB.newPage()
    await signIn(pageB, emailB)
    await pageB.goto(`/app?team=${teamY}`)
    const nudge = pageB.getByRole('link', { name: 'Your team has been challenged' })
    await expect(nudge).toBeVisible(TIMEOUT)
    await nudge.click({ timeout: 10_000 })
    await pageB.waitForURL(
      (url) => url.pathname === '/team' && url.searchParams.get('team') === teamY,
      NAV_TIMEOUT,
    )
    const incoming = challengesCard(pageB).getByText(`${SEEDED_TEAM} challenged your team`)
    await expect(incoming).toBeVisible(TIMEOUT)
    await challengesCard(pageB)
      .getByRole('button', { name: 'Accept', exact: true })
      .click({ timeout: 10_000 })
    await expect(pageB.getByText('Challenge accepted')).toBeVisible(TIMEOUT)

    // 3. Both sides show the scoreboard, with no boards yet. A's page was
    // never reloaded: it reaches the new state through its subscription.
    await expectFreshScoreboard(pageB, rivals, SEEDED_TEAM)
    await expectFreshScoreboard(pageA, SEEDED_TEAM, rivals)
    await expect(challengesCard(pageA).getByText(`Waiting for ${rivals} to answer`)).toHaveCount(0)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('a challenge link followed while signed out resumes after sign-in and is spent once', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const stamp = stampOf()
  const emailA = emailFor('linker', stamp)
  const emailC = emailFor('claimer', stamp)

  const teamX = await seedProWithTeam(emailA)
  // C has a players row and exactly one team, so signing in lands on /app
  // rather than /complete-profile, and the claim page has one choice.
  const teamC = await convex().mutation(api.e2eSeed.ensureTeamFor, { email: emailC })

  const contextA = await shareContext(browser)
  const contextC = await browser.newContext()
  try {
    // 1. A mints a link from X; the clipboard hands it back.
    const pageA = await contextA.newPage()
    await signIn(pageA, emailA)
    await pageA.goto(`/team?team=${teamX}`)
    const dialog = await openProposeDialog(pageA)
    await dialog.getByRole('button', { name: 'Create a challenge link' }).click({ timeout: 10_000 })
    // The lasting confirmation, set only after writeText resolved, so the read
    // below cannot race the write.
    await expect(dialog.getByText('Link copied to your clipboard.')).toBeVisible(TIMEOUT)
    const linkUrl = await pageA.evaluate(() => navigator.clipboard.readText())
    const match = /^http:\/\/localhost:3000\/challenge\/([0-9a-f]{32})$/.exec(linkUrl)
    expect(match, `not a challenge URL: ${linkUrl}`).not.toBeNull()
    const token = match![1]
    const challengePath = `/challenge/${token}`

    // 2. A signed-out context follows it, is sent to /login, and signs in IN
    // THE SAME PAGE — the token rides in sessionStorage, which is per tab.
    const pageC = await contextC.newPage()
    await pageC.goto(linkUrl)
    await pageC.waitForURL((url) => url.pathname === '/login', NAV_TIMEOUT)
    await signIn(pageC, emailC)
    // THE RESUME: back on the challenge page, not left on /app.
    await pageC.waitForURL((url) => url.pathname === challengePath, NAV_TIMEOUT)

    // 3. C's only team is pre-selected; accepting lands on that team's page.
    const onlyTeam = pageC.getByRole('radio', { name: SEEDED_TEAM })
    await expect(onlyTeam).toBeChecked(TIMEOUT)
    await pageC
      .getByRole('button', { name: `Accept for ${SEEDED_TEAM}` })
      .click({ timeout: 10_000 })
    await pageC.waitForURL(
      (url) => url.pathname === '/team' && url.searchParams.get('team') === teamC,
      NAV_TIMEOUT,
    )
    await expectFreshScoreboard(pageC, SEEDED_TEAM, SEEDED_TEAM)

    // 4. The same link again, signed in as C: spent. THE PAGE CANNOT KNOW UNTIL A
    // CLAIM IS ATTEMPTED — there is deliberately no "is this link alive" query,
    // so holding a token reveals nothing about it (convex/challenges.ts). It
    // offers the picker as for any link, and Accept is what turns it dead.
    await pageC.goto(challengePath)
    await expect(pageC.getByText("You've been challenged")).toBeVisible(TIMEOUT)
    await pageC.getByRole('button', { name: /^Accept for / }).click(TIMEOUT)
    await expect(pageC.getByRole('heading', { name: LINK_INVALID })).toBeVisible(TIMEOUT)
    await expect(pageC.getByRole('main').getByRole('button')).toHaveCount(0)
  } finally {
    await contextA.close()
    await contextC.close()
  }
})
