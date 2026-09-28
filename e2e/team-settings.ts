import { expect, type Page } from '@playwright/test'

/**
 * Gets to the team settings page (routes/team.tsx), the "Team settings"
 * button's destination.
 *
 * REWRITTEN FOR wordle-teams-5jcn.29. Team admin used to live behind
 * TeamSettingsDialog, a Dialog+Tabs component opened from routes/app.tsx — the
 * dashboard-cards plan (wordle-teams-5jcn) Task 8/9 moved CurrentTeamCard,
 * MyTeamsCard and ScoringSystemCard there (wordle-teams-4srj), and every test
 * that needed any of the three had to "open Team settings, switch to tab X"
 * first, which is what this helper used to do. The owner called the result
 * "a dialog on top of a dialog" once CurrentTeamCard's own Settings and Invite
 * buttons opened a SECOND dialog on top of that one — 5jcn.29 replaced the
 * whole surface with a page, and there is no tab strip left to switch: the
 * three cards are always-mounted, stacked content on one URL.
 *
 * THE TRIGGER IS STILL FOUND BY ROLE, NOT TEXT, for the reason the previous
 * version of this file gave: routes/app.tsx renders its "Team settings" button
 * icon-only below the `sm` breakpoint, with the label carried by `aria-label`
 * rather than visible text (the same collapse Header.tsx's Upgrade button
 * uses) — a text locator would miss it at narrow viewports.
 *
 * `role: 'link'`, NOT `'button'`, EVEN THOUGH IT IS STILL A `<Button>`
 * VISUALLY. It navigates now (`asChild` wrapping a `<Link>`, the same pattern
 * login-error.tsx's "Head to Sign In" uses — see e2e/routes.spec.ts's own
 * `getByRole('link', ...)` for that one), so the DOM element Playwright sees
 * is a real `<a href>`, whose accessible role is "link" regardless of the
 * button classes painted on it. Querying `'button'` here found nothing and
 * every caller timed out — caught by actually running this suite rather than
 * only reading the diff.
 *
 * IDEMPOTENT ON WHETHER THE PAGE IS ALREADY OPEN, BUT NOT FOR THE REASON THIS
 * FILE USED TO GIVE. The old comment was about Radix marking the rest of the
 * page `aria-hidden` while TeamSettingsDialog was open, which made a second
 * click on the OUTER trigger invisible to Playwright — that no longer applies,
 * because there is no modal Dialog here and nothing else on the page is ever
 * hidden. The reason to skip the click now is simpler and different: the
 * "Team settings" button only exists on /app's own controls row, not on
 * /team itself, so a caller that is already on this page has nothing to click
 * — re-finding that button would time out rather than no-op.
 */
export async function openTeamSettings(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Team settings' })
  if (!(await heading.isVisible())) {
    await page.getByRole('link', { name: 'Team settings' }).click()
  }
  await expect(heading).toBeVisible()
  await expect(page).toHaveURL(/\/team(?:\?|$)/)
}
