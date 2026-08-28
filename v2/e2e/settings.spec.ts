import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import type { Page } from '@playwright/test'

/**
 * Phase 6, Task 6 — the settings menu, its dialog, and the Notifications tab's
 * two persisted controls. Read teams.spec.ts and sign-in.ts before touching
 * this file; the setup below follows both exactly, including the strict 5s
 * default on every assertion after sign-in has landed.
 *
 * Seeds through e2eSeed.ensureTeamFor rather than a bare signIn(), the same
 * choice teams.spec.ts makes: a bare signIn() leaves the account with no
 * `players` row at all, and api.settings.mySettings (requirePlayer) throws
 * NO_PLAYER without one — the Notifications tab would show its error state
 * instead of ever offering a control to interact with. The seeded row starts
 * with reminderDeliveryMethods: [] and reminderDeliveryTime: '18:00:00',
 * which is what the persistence assertions below change away from.
 */
async function signInWithPlayer(page: Page, timeZone?: string): Promise<void> {
  const email = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email, timeZone })
  await signIn(page, email)
}

test('the hamburger opens the menu, and each item opens the dialog on its own tab', async ({
  page,
}) => {
  await signInWithPlayer(page)

  // The trigger's only content is an icon, so `aria-label="Account menu"` is
  // the whole of its accessible name — this locator fails outright if that
  // attribute regresses to something decorative-only.
  await page.getByRole('button', { name: 'Account menu' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Notifications' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Install Guide' })).toBeVisible()

  // Seeded name is 'E2E Tester' (e2eSeed.ts), so the label reads that back —
  // proof the menu is reading the PLAYERS row, not Better Auth's own `name`
  // (which the OTP sign-in path never sets at all). Scoped to the menu itself
  // — 'E2E Tester' also names this account's row on the Current Team card
  // rendered behind it, same ambiguity teams.spec.ts scopes around.
  await expect(menu.getByText('E2E Tester')).toBeVisible()
  await expect(menu.getByText('Free')).toBeVisible()

  // THE HEADLINE PROPERTY OF THIS WHOLE REDESIGN, and otherwise uncovered:
  // v1 wrapped its avatar in `role="button"` (user-dropdown.tsx:117), and
  // every other assertion in this file would stay green even if that
  // regressed back in, since none of them click the avatar to open anything.
  // initialsFor('E2E', 'Tester') is 'ET' (initials.ts) — asserting there is
  // no `[role="button"]` carrying that text, scoped to the header, is a
  // direct check that the fallback letters are identity, not a control.
  // Scoped to `banner` (the `<header>`'s implicit role) rather than the whole
  // page: TanStack's dev-only router devtools panel renders a real
  // `role="button"` elsewhere on the page whose text — "complete-profile" —
  // contains "et" too, and an unscoped locator matches that instead.
  // Scoped to the <header> tag rather than a role locator: this app's
  // `<header>` measures as having NO computed `banner` landmark role in
  // Chromium's accessibility tree (verified directly — `getByRole('banner')`
  // finds nothing here even though `header` and `nav` both resolve to
  // exactly one element each), so a role-based scope would silently search
  // the whole page instead of narrowing anything.
  const header = page.locator('header')
  await expect(header.locator('[role="button"]', { hasText: 'ET' })).toHaveCount(0)
  // Scoped to <header>, not the whole page: scores-table.tsx also renders an
  // (unrelated) exact 'ET' text node off-screen for narrow viewports.
  await expect(header.getByText('ET', { exact: true })).toBeVisible()

  await menu.getByRole('menuitem', { name: 'Notifications' }).click()

  // The dialog's OWN accessible name — settings-dialog.tsx's VisuallyHidden
  // `<DialogTitle>Settings</DialogTitle>`. Without it Radix omits
  // `aria-labelledby` entirely and a screen reader announces an unnamed
  // "dialog"; the visible tab heading below does not substitute for this,
  // since it is a plain `<h3>`, not a `DialogPrimitive.Title`.
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Notifications' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByRole('heading', { name: 'Notification Settings' })).toBeVisible()

  // Close, then reopen through the OTHER item — proves `defaultTab` actually
  // decides which tab a fresh open lands on, not just that both tabs exist.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Notification Settings' })).toBeHidden()

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Install Guide' }).click()
  await expect(page.getByRole('tab', { name: 'Install Guide' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible()
  await expect(page.getByText('Add to Home Screen')).toBeVisible()
})

test('changing the reminder time and toggling Email each report success and persist', async ({
  page,
}) => {
  await signInWithPlayer(page)

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Notifications' }).click()

  // Seeded reminderDeliveryTime is '18:00:00' -> '6 PM' (notifications-tab.tsx
  // label()), so this locator also pins the display format is what the tab
  // actually loaded, not a placeholder.
  await expect(page.getByRole('combobox', { name: 'Board Entry Reminder' })).toHaveText('6 PM')
  await page.getByRole('combobox', { name: 'Board Entry Reminder' }).click()
  await page.getByRole('option', { name: '9 AM' }).click()
  await expect(page.getByText('Delivery time updated')).toBeVisible()

  // Seeded reminderDeliveryMethods is [] -> the switch starts unchecked.
  const emailSwitch = page.getByRole('switch', { name: 'Email' })
  await expect(emailSwitch).not.toBeChecked()
  await emailSwitch.click()
  await expect(page.getByText('Delivery methods updated')).toBeVisible()
  await expect(emailSwitch).toBeChecked()

  await page.reload()
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Notifications' }).click()

  await expect(page.getByRole('combobox', { name: 'Board Entry Reminder' })).toHaveText('9 AM')
  await expect(page.getByRole('switch', { name: 'Email' })).toBeChecked()
})

test('a time zone copied in its Postgres spelling displays correctly, and changing it persists', async ({
  page,
}) => {
  // 'Asia/Calcutta' is exactly what a row COPIED from v1 carries for anyone
  // whose browser reports 'Asia/Kolkata' — v1's app-bar-base.tsx wrote that
  // spelling before every save (time-zones.ts's timeZoneMapping; identically
  // paired in convex/lib/reminders.test.ts). ensureTeamFor's optional
  // `timeZone` writes it directly, bypassing updateTimeZoneFor's own Intl
  // validation entirely on purpose — that validation is settings.test.ts's
  // job; what this test is for is the PICKER's display of an already-stored
  // alias, which the picker itself can never produce (it only ever writes
  // the IANA spellings in TIME_ZONE_GROUPS).
  await signInWithPlayer(page, 'Asia/Calcutta')

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Notifications' }).click()

  // canonicalTimeZone (time-zones.ts) maps the stored Postgres spelling back
  // to the IANA one TIME_ZONE_GROUPS lists, so this must show India Standard
  // Time rather than the "Select a time zone" placeholder Calcutta fell back
  // to before that mapping was inverted to run this direction.
  const timeZoneSelect = page.getByRole('combobox', { name: 'Time Zone' })
  await expect(timeZoneSelect).toHaveText('India Standard Time (IST)')

  await timeZoneSelect.click()
  await page.getByRole('option', { name: 'Eastern Standard Time (EST)' }).click()
  await expect(page.getByText('Time zone updated')).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Notifications' }).click()
  await expect(page.getByRole('combobox', { name: 'Time Zone' })).toHaveText('Eastern Standard Time (EST)')
})
