import { expect, type Page } from '@playwright/test'
import type { TeamSettingsTab } from '../src/components/teams/team-settings-dialog.tsx'

/**
 * Opens TeamSettingsDialog (if it is not already open) and switches it to the
 * given tab, waiting for that tab to report itself active.
 *
 * WHY THIS EXISTS. The dashboard-cards plan (wordle-teams-5jcn) Task 8/9 moved
 * CurrentTeamCard, MyTeamsCard and ScoringSystemCard off the dashboard grid and
 * behind this dialog (wordle-teams-4srj). Every test that needs any of the
 * three now needs "open Team settings, land on tab X" first — five of them,
 * across teams.spec.ts and invites.spec.ts — so this is factored out once
 * rather than five times, the same call this file's other helpers already
 * made for openAppMenu.
 *
 * THE TRIGGER IS FOUND BY ROLE, NOT TEXT, deliberately: routes/app.tsx renders
 * its "Team settings" button icon-only below the `sm` breakpoint, with the
 * label carried by `aria-label` rather than visible text (the same collapse
 * Header.tsx's Upgrade button uses) — a text locator would miss it at narrow
 * viewports.
 *
 * IDEMPOTENT ON WHETHER THE DIALOG IS ALREADY OPEN, same reasoning as
 * app-menu.ts's openAppMenu: a caller that needs Members then My teams in the
 * same test (teams.spec.ts's create-team test does, since My Teams and
 * Current Team ended up on different tabs) can call this twice without
 * tracking state itself. This matters beyond convenience here — once the
 * dialog is open, current-team-card.tsx renders ITS OWN icon button whose
 * accessible name is also "Team settings" (the in-card edit-team-details
 * control), but only while the Members tab is mounted; re-clicking the
 * OUTER trigger while a Radix Dialog is already open would also fail
 * differently, since Radix marks the rest of the page `aria-hidden` while a
 * modal Dialog is open, so Playwright cannot see it at all. Skipping the
 * click when the dialog is already visible sidesteps both.
 *
 * Tab switching just clicks the target TabsTrigger unconditionally — cheap,
 * and a click on an already-active tab is a harmless no-op — rather than
 * special-casing 'members' as the dialog's own default.
 */
export async function openTeamSettings(page: Page, tab: TeamSettingsTab = 'members'): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Team settings' })
  if (!(await dialog.isVisible())) {
    await page.getByRole('button', { name: 'Team settings' }).click()
    await expect(dialog).toBeVisible()
  }

  const tabLabel = { members: 'Members', teams: 'My teams', scoring: 'Scoring' }[tab]
  await page.getByRole('tab', { name: tabLabel }).click()
  await expect(page.getByRole('tab', { name: tabLabel })).toHaveAttribute('data-state', 'active')
}
