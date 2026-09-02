import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { CONCEALED_MESSAGE } from '../src/components/teams/team-boards-model.ts'

/**
 * The Team Boards panel, on the real dashboard.
 *
 * NOT THE GATE. CI runs lint, typecheck, `vitest run` and build and no
 * Playwright at all (wt-ksh.8.49), so everything this file proves that MATTERS
 * is proved again in src/components/teams/team-boards.hook.test.ts, which is
 * collected by `vitest run`. What this adds is the one thing no unit test can:
 * that the panel survives the real route, the real Convex query and a real
 * hydration in a real browser — and that the browser console stays clean while
 * it does, which is the failure v1 left two comments about.
 */

/** A fresh account with a fresh team, exactly as board-entry.spec.ts does it. */
async function signInWithTeam(page: import('@playwright/test').Page) {
  const email = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await signIn(page, email)
  return email
}

test("today's boards are concealed until you enter your own, and the console stays clean", async ({
  page,
}) => {
  // Collected from the first navigation, so a hydration mismatch on the
  // dashboard — which React reports as a console error and nothing else would
  // fail on — is a test failure here.
  const consoleErrors: Array<string> = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await signInWithTeam(page)

  const panel = page.getByRole('group', { name: 'Team boards' })
  await panel.waitFor()

  // Asserted HERE, on the first paint after hydration, which is where a
  // mismatch would be reported — not only at the end of the test, by which
  // point a failure earlier on would have skipped it.
  expect(consoleErrors).toEqual([])

  // The panel opens on today, resolved in the BROWSER's zone. Derived the same
  // way the app derives it rather than hardcoded, so this holds whenever the
  // suite runs — and it is the assertion that would fail if the day were ever
  // resolved on the server, which runs UTC.
  const todayLabel = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  await expect(page.getByRole('button', { name: todayLabel })).toBeVisible()

  // A one-player team, so exactly one slide, and it is withheld: the account is
  // brand new and has entered nothing today.
  await expect(panel.getByText(CONCEALED_MESSAGE)).toHaveCount(1)
  await expect(panel.locator('[data-slot="wordle-board"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Board Entry' }).click()
  const entry = page.getByRole('region', { name: 'Wordle Board' })
  await entry.waitFor()
  await page.keyboard.type('SPEED')
  await entry.click()
  await page.keyboard.type('CRANESPEED')
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(entry).toBeHidden()

  // The submission unlocks the day — live, through the Convex subscription, with
  // no reload — and the board that appears is the one just entered.
  await expect(panel.locator('[data-slot="wordle-board"]')).toHaveCount(1)
  await expect(panel.getByText(CONCEALED_MESSAGE)).toHaveCount(0)

  // Both day arrows are present. Whether stepping is POSSIBLE is date-dependent
  // — on the 1st of a month there is no previous day inside it, because the
  // panel is bounded to the month it has data for, and this suite really did
  // fail on a 1st the first time it ran — so the stepping itself is pinned in
  // team-boards.hook.test.ts against a fixed clock, which is also the file CI
  // actually runs. What matters here is that the controls reached the page.
  await expect(page.getByRole('button', { name: 'Previous day' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next day' })).toBeVisible()

  expect(consoleErrors).toEqual([])
})

/**
 * THE CAROUSEL SCROLLS THE PAGE, NOT ITSELF, WHEN DRAGGED DOWNWARD
 * (wordle-teams-iv09).
 *
 * Owner-reported from a phone: a mistouch over the boards trapped the page
 * scroll. THIS IS THE ONLY PLACE THE DEFECT IS OBSERVABLE. jsdom has no layout
 * engine — every element measures 0x0 — so team-boards.hook.test.ts can pin the
 * markup that decides the behaviour but can never see a scrollHeight exceed a
 * clientHeight, which is the thing that was actually wrong.
 *
 * MEASURED, NOT SIMULATED. Dispatching synthetic touch events would test
 * Playwright's event emulation rather than the browser's scroll chaining. What
 * decides whether a drag scrolls the track or the page is whether the track has
 * vertical overflow to consume, and that is a number the page can be asked for.
 *
 * BOTH FIGURES BELOW WERE MEASURED AGAINST THE BROKEN MARKUP BEFORE THE FIX,
 * in this browser at this viewport: `slideOverflow: [32]` and
 * `overflowY: "auto"`. Neither was inferred.
 */
test('the boards carousel has no vertical overflow to trap a downward drag', async ({ page }) => {
  await signInWithTeam(page)

  // The phone this was reported on; 390x844 is an iPhone 14.
  await page.setViewportSize({ width: 390, height: 844 })

  const track = page.getByLabel('Team boards, scrollable by player')
  await track.waitFor()

  const metrics = await track.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    overflowX: getComputedStyle(element).overflowX,
    overflowY: getComputedStyle(element).overflowY,
    // Every slide, so one tall board cannot hide behind an average.
    slideOverflow: Array.from(element.children).map(
      (slide) => slide.scrollHeight - slide.clientHeight,
    ),
  }))

  // THE CAUSE, and it measured exactly 32px per slide: the slide is 450px and
  // held 482px — a 24px name row plus its 8px margin, then a board wrapper
  // taking `h-full` of the SLIDE rather than of what was left under the name.
  // On every slide, at every screen size, whatever the board contained.
  expect(metrics.slideOverflow.every((overflow) => overflow <= 0)).toBe(true)

  // THE ENABLER, and the browser confirmed it: with only `overflow-x-auto`
  // declared, the computed `overflow-y` came back "auto", not "visible". That
  // is the CSS overflow spec — when one axis is not `visible` the other
  // computes to `auto` — so the track was a vertical scroll container by
  // accident, ready to consume the drag the overflow above gave it work to do.
  expect(metrics.overflowY).toBe('hidden')
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight)

  // AND THE HORIZONTAL CAROUSEL STILL WORKS, which is the half that must not be
  // traded away for the fix: `overflow-y-hidden` on a flex row is one careless
  // edit from `overflow-hidden`, which would leave the arrows driving a track
  // that cannot move.
  expect(metrics.overflowX).toBe('auto')
})

/**
 * THE GRID STAYS ON SCREEN THROUGH A MONTH SWITCH (wordle-teams-9ahw).
 *
 * Owner-reported: switching team or month blanked most of the dashboard while
 * the new data loaded. Three panels — ScoresTable, TeamBoards and
 * ScoringSystemCard — all `useSuspenseQuery` the same `getTeamMonth` keyed by
 * (teamId, month), so a switch re-keys and suspends all three at once. With no
 * Suspense boundary the suspension bubbled past the route, and the nearest
 * boundary above it hid everything below — the pickers included, though they
 * read no month-keyed query.
 *
 * IT SAMPLES EVERY ANIMATION FRAME, AND TWO SIMPLER FORMS OF THIS TEST WERE
 * TRIED AND DISCARDED FIRST. Both are worth recording, because both LOOK right
 * and both pass against the broken code:
 *
 *   1. Switch, then `expect(picker).toBeVisible()`. Against a local backend the
 *      blank frames are gone long before Playwright's first sample, so it goes
 *      green either way. Verified against app.tsx at the commit before the fix.
 *
 *   2. Hold an element handle across the switch and assert `node.isConnected`.
 *      Also green either way, for a more interesting reason: React does not
 *      UNMOUNT a suspended subtree, it hides it with `display: none` and keeps
 *      the nodes. So the node never leaves the document even while nothing is
 *      on screen, and "is it still in the DOM" is the wrong question entirely.
 *
 * What actually distinguishes the two states is whether the element has a box
 * on any frame DURING the switch, which is not observable by sampling after it.
 * So this installs a requestAnimationFrame recorder before the click and reads
 * it afterwards: one measurement per painted frame, so a blank that lasts two
 * frames is still caught. Verified in both directions.
 */
test('switching month keeps the dashboard on screen instead of blanking it', async ({ page }) => {
  await signInWithTeam(page)

  const monthPicker = page.getByRole('button', { name: /^\w{3} \d{4}$/ })
  await expect(monthPicker).toBeVisible()

  // Record, every frame, whether the team picker is painting anything. It sits
  // OUTSIDE every Suspense boundary and reads no month-keyed query, so a switch
  // should never take it off screen.
  await page.evaluate(() => {
    const state = { blankFrames: 0, frames: 0 }
    ;(window as unknown as { __gridWatch: typeof state }).__gridWatch = state
    const tick = () => {
      const picker = document.querySelector('main button')
      if (picker) {
        state.frames += 1
        const box = picker.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) state.blankFrames += 1
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  await monthPicker.click()
  const previousMonth = page.getByRole('menuitemradio').nth(1)
  const previousLabel = await previousMonth.textContent()
  await previousMonth.click()

  // The real panel arrives, so this is not asserting survival across a no-op.
  await expect(page.getByLabel('Team boards, scrollable by player')).toBeVisible({
    timeout: 15_000,
  })
  await expect(monthPicker).toHaveText(previousLabel!.trim())

  const watch = await page.evaluate(
    () => (window as unknown as { __gridWatch: { blankFrames: number; frames: number } }).__gridWatch,
  )

  // The recorder has to have actually run, or zero blank frames means nothing.
  expect(watch.frames).toBeGreaterThan(5)
  expect(watch.blankFrames).toBe(0)
})

/**
 * THE DAY PICKER REACHES AN EARLIER MONTH, AND OPENS WHERE IT IS LOOKING
 * (wordle-teams-5vv3).
 *
 * Two owner complaints, both about the same control. The picker was clamped to
 * the loaded month, so viewing an earlier day meant going up to the month
 * dropdown first; and it opened on the CLOCK'S month whatever day was selected,
 * because react-day-picker resolves its initial month as
 * `month || defaultMonth || today` and never consults `selected`
 * (wordle-teams-p5mw, open since the Task 10 review and closed by this).
 *
 * ONLY A BROWSER SEES THE ROUND TRIP. team-boards.hook.test.ts pins the panel's
 * side — which days the calendar offers, and that picking an outside one calls
 * back — against a recorded callback. What it cannot see is what happens next:
 * that the callback actually moves `?month=`, that the route reloads against the
 * new month, and that the day the viewer clicked survives that rather than being
 * replaced by the new month's default.
 *
 * WHAT THIS TEST DOES *NOT* COVER, stated because its name reads as though it
 * might: the `defaultMonth` half. This starts on the CURRENT month, where the
 * selected day's month and the clock's month are the same, so deleting
 * `defaultMonth` from date-picker.tsx leaves it green — verified by mutation.
 * The guard for that half is team-boards.hook.test.ts's "it OPENS on the day
 * being viewed", which renders the panel pointed at July from an August clock
 * and is red without it. Reaching the same state here would need a signed-in
 * account with scores in a previous month, which this suite's seed does not
 * create.
 */
test('a day in an earlier month can be picked, and the month follows it', async ({ page }) => {
  await signInWithTeam(page)

  const monthPicker = page.getByRole('button', { name: /^\w{3} \d{4}$/ })
  await expect(monthPicker).toBeVisible()
  const startingMonth = (await monthPicker.textContent())!.trim()

  // The boards picker, which carries the full date as its label.
  const dayPicker = page.getByRole('button', { name: /^\w+ \d{1,2}, \d{4}$/ })
  await dayPicker.click()

  // IT OPENED ON THE SELECTED DAY'S MONTH. Before the fix this grid was the
  // clock's month with every day disabled by the old maxDay bound.
  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()

  // Page back one month and take the 15th, which exists in every month and is
  // never a weekend edge case.
  await page.getByRole('button', { name: 'Go to the Previous Month' }).click()
  const fifteenth = grid.locator('td[data-day$="-15"] button')
  await expect(fifteenth).toBeEnabled()
  const targetDay = await grid.locator('td[data-day$="-15"]').getAttribute('data-day')
  await fifteenth.click()

  // THE MONTH DROPDOWN MOVED WITH IT — the callback reached the router.
  await expect(monthPicker).not.toHaveText(startingMonth)
  await expect
    .poll(() => new URL(page.url()).searchParams.get('month'))
    .toBe(targetDay!.slice(0, 7))

  // AND THE DAY THE VIEWER CLICKED SURVIVED THE NAVIGATION, rather than the new
  // month's default last day. `picked` is set before the callback precisely so
  // resolveDay honours it once the new month's days arrive; setting it after
  // would land on the wrong day and look almost right.
  await expect(dayPicker).toBeVisible()
  const [, monthPart, dayPart] = targetDay!.split('-')
  await expect(dayPicker).toHaveText(new RegExp(`${Number(dayPart)}, `))
  expect(monthPart).toBe(targetDay!.slice(5, 7))
})
