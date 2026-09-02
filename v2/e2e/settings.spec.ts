import { expect, test } from '@playwright/test'
import { openAppMenu } from './app-menu.ts'
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

  // The trigger's only content is an icon, so `aria-label="Main menu"` is
  // the whole of its accessible name — this locator fails outright if that
  // attribute regresses to something decorative-only.
  await openAppMenu(page)
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

  await openAppMenu(page)
  await page.getByRole('menu').getByRole('menuitem', { name: 'Install Guide' }).click()
  await expect(page.getByRole('tab', { name: 'Install Guide' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible()
  await expect(page.getByText('Add to Home Screen')).toBeVisible()
})

test('changing the reminder time and toggling Email each report success and persist', async ({
  page,
}) => {
  await signInWithPlayer(page)

  await openAppMenu(page)
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
  await openAppMenu(page)
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

  await openAppMenu(page)
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
  await openAppMenu(page)
  await page.getByRole('menu').getByRole('menuitem', { name: 'Notifications' }).click()
  await expect(page.getByRole('combobox', { name: 'Time Zone' })).toHaveText('Eastern Standard Time (EST)')
})

test.describe('a brand-new signup with no stored zone', () => {
  // Pins the browser's reported zone to one TIME_ZONE_GROUPS actually lists
  // (time-zones.ts:21), so the assertion below can check a real display
  // string instead of a mere absence.
  test.use({ timezoneId: 'America/Denver' })

  // THE ONLY THING STANDING BETWEEN THIS FEATURE AND SILENT INERTNESS. No
  // gate (lint/typecheck/test/build) exercises useLocalCapture.ts's own
  // wiring into Header.tsx — src/lib/use-local-capture.test.ts and
  // use-local-capture.hook.test.ts pin the decision logic and the hook's
  // internal behaviour, but nothing there fails if useLocalCapture() is ever
  // deleted from Header.tsx, or Header stops being mounted where it can
  // reach ConvexBetterAuthProvider. Delete that one call and every gate stays
  // green while convex/reminders.ts:146 silently skips every new signup
  // forever, because nothing ever wrote their timeZone. This spec is what
  // actually notices.
  test('signing in with no seeded zone captures the browser one, silently', async ({ page }) => {
    // signInWithPlayer(page) with NO timeZone argument — e2eSeed.ensureTeamFor
    // omits the field entirely (convex/e2eSeed.ts), so this player's row
    // starts with no timeZone at all, exactly like a real v2 signup.
    await signInWithPlayer(page)

    await openAppMenu(page)
    await page.getByRole('menu').getByRole('menuitem', { name: 'Notifications' }).click()

    // 'Mountain Standard Time (MST)' is TIME_ZONE_GROUPS's label for
    // 'America/Denver' (time-zones.ts:21) — what Intl resolves to under the
    // timezoneId set above. If useLocalCapture never ran (or never landed),
    // this reads notifications-tab.tsx's placeholder, "Select a time zone",
    // instead — the same failure mode a deleted `useLocalCapture()` call
    // produces for every real signup.
    await expect(page.getByRole('combobox', { name: 'Time Zone' })).toHaveText('Mountain Standard Time (MST)')
  })
})

/**
 * Phase 6, Task 12 — rule 1 of the Push switch: hidden entirely where the
 * deployment has no VAPID key.
 *
 * WHAT THIS SPEC DOES NOT COVER, AND WHY IT CANNOT. The subscribe path — a
 * granted permission, `pushManager.subscribe`, and the subscription reaching
 * `savePushSubscription` — is NOT exercised anywhere in e2e, and the plan's
 * acceptance criterion asking for it is unreachable here. Three separate
 * blockers, each measured rather than assumed:
 *
 *   1. `VAPID_PUBLIC_KEY` is not set on the local anonymous Convex deployment
 *      (`convex env get` reports it not found), so `api.push.publicKey`
 *      returns null and the switch this file looks for is correctly absent.
 *   2. There is no service worker in dev at all. Registration is gated on
 *      `import.meta.env.PROD` (register-sw.ts) and `/sw.js` is a build
 *      artifact scripts/build-sw.mjs writes after `vite build`, which
 *      `pnpm dev` never runs — and playwright.config.ts's `webServer` is
 *      `pnpm dev`. `pushManager.subscribe` needs an active registration.
 *   3. Headless Chromium cannot reach a real push service.
 *
 * A mocked subscribe would only prove the mock was called. The real coverage
 * lives in src/lib/push-subscribe.test.ts, which drives every branch of the
 * flow through injected browser surfaces, and in a human watching a
 * notification arrive on a real device (Task 11).
 *
 * So this asserts the one rule a real deployment CAN check, and it is the rule
 * that protects players: a control that cannot work is not shown at all.
 */
test('the Push switch is absent where no VAPID key is configured, and Email still works', async ({
  page,
}) => {
  await signInWithPlayer(page)

  await openAppMenu(page)
  await page.getByRole('menu').getByRole('menuitem', { name: 'Notifications' }).click()

  // The tab really rendered its controls — without this the absence assertion
  // below would pass just as happily on a crashed tab, a loading spinner, or
  // the NO_PLAYER error state.
  await expect(page.getByRole('heading', { name: 'Notification Settings' })).toBeVisible()
  const emailSwitch = page.getByRole('switch', { name: 'Email' })
  await expect(emailSwitch).toBeVisible()

  // THE ASSERTION. `toHaveCount(0)` rather than `toBeHidden()`: the switch is
  // not rendered at all, and `toBeHidden` also passes for an element that does
  // not exist — which would keep this green if the locator name ever drifted.
  // Counting pins that the Push control is genuinely absent from the tree.
  await expect(page.getByRole('switch', { name: 'Push' })).toHaveCount(0)
  await expect(page.getByText('Push', { exact: true })).toHaveCount(0)

  // And Email is unaffected by the switch's absence — the shared
  // reminderDeliveryMethods array and the shared `disabled` flags mean a
  // mistake in the push branch is entirely capable of breaking this one.
  await emailSwitch.click()
  await expect(page.getByText('Delivery methods updated')).toBeVisible()
  await expect(emailSwitch).toBeChecked()
})
