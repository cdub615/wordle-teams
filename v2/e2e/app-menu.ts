import { expect, type Page } from '@playwright/test'

/**
 * Opens the app bar's menu and waits until it is actually open.
 *
 * WHY THIS IS NOT `trigger.click()`. The header server-renders, so the trigger
 * button exists in the HTML long before React attaches a handler to it — the
 * same pre-hydration hazard `use-hydrated.ts` exists for, and which
 * complete-profile.ts gates on by waiting for its Submit button to be enabled.
 * A menu trigger has no equivalent disabled state to wait on: it looks
 * identical before and after hydration, so a click can land on a dead button,
 * do nothing, and leave the caller asserting against a menu that never opened.
 * MEASURED, not reasoned — this is exactly how the signed-out menu test in
 * routes.spec.ts failed first time round, on `/about` with no session, where
 * nothing else on the page forces a wait.
 *
 * THE RETRY IS GUARDED ON `data-state` RATHER THAN JUST CLICKING AGAIN, and
 * that is the whole reason this is a helper instead of a `toPass` block copied
 * into three specs. Radix menus TOGGLE: a blind second click on an open menu
 * shuts it, so the naive retry alternates open/closed and can fail on the exact
 * attempt that would otherwise have passed. Checking first makes the call
 * idempotent, which also means a caller may use it without tracking whether the
 * menu is already open.
 *
 * IT MATTERS SEPARATELY THAT THE MENU STAYS OPEN ACROSS AN ACTION. app-menu.tsx
 * calls `event.preventDefault()` in the Billing and Log out `onSelect`
 * handlers, so the menu deliberately survives the round trip — that is what
 * keeps the pending spinner on screen and what stops a second click minting a
 * second portal session. Calling this again afterwards is therefore a no-op
 * rather than a close.
 */
export async function openAppMenu(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Main menu' })

  await expect(async () => {
    if ((await trigger.getAttribute('data-state')) !== 'open') {
      await trigger.click()
    }
    /**
     * THE MENU ITSELF, NOT AN ITEM IN IT. This waited on the "Home" item until
     * wordle-teams-wty4.1.3 removed it, and three specs in two files went red
     * for a change that had nothing to do with any of them — none of the four
     * local quality gates runs Playwright, so it only surfaced in CI.
     *
     * Radix's DropdownMenuContent carries `role="menu"`, which is true of every
     * state of it and of no particular item, so it proves "open" without
     * assuming a session AND without betting on which entries the menu happens
     * to hold. Do not put an item name back here.
     */
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

/**
 * Closes it again, for the callers that need the bar unobscured afterwards —
 * an open Radix menu lays an overlay over the page and puts `pointer-events:
 * none` on the body, so a click aimed at anything behind it is swallowed.
 */
export async function closeAppMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  // The menu, not an item — same reasoning as openAppMenu's note above.
  await expect(page.getByRole('menu')).toHaveCount(0)
}
