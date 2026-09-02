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

/**
 * THE DAY ARROWS CROSS MONTHS (wordle-teams-5nmo).
 *
 * They used to index into the loaded month's `navigableDays` and disable at its
 * edges — at the 1st, "Previous day" was dead while the picker beside it
 * offered the month before. Stepping off the end is a month navigation, exactly
 * as picking an outside day is.
 *
 * team-boards-model.test.ts owns the stepping RULES against a fixed clock —
 * near-end landing, weekend skipping, the window floor, the empty-month skip.
 * What only a browser shows is that the click reaches the router: that
 * `?month=` moves, the route reloads, and the day the arrow promised is the one
 * that survives rather than the new month's default.
 */
test('the previous-day arrow crosses into the month before, and the month follows', async ({
  page,
}) => {
  await signInWithTeam(page)

  const monthPicker = page.getByRole('button', { name: /^\w{3} \d{4}$/ })
  await expect(monthPicker).toBeVisible()
  const startingMonth = (await monthPicker.textContent())!.trim()

  const dayPicker = page.getByRole('button', { name: /^\w+ \d{1,2}, \d{4}$/ })
  const previous = page.getByRole('button', { name: 'Previous day' })

  // Walk back to the 1st of the current month. A month is at most 31 days and
  // the panel opens on today, so this is bounded; the guard is the arrow's own
  // label, which stops changing once the month does.
  const startingDay = (await dayPicker.textContent())!.trim()
  for (let step = 0; step < 40; step++) {
    const label = (await dayPicker.textContent())!.trim()
    if (/\s1, /.test(label)) break
    await previous.click()
  }
  await expect(dayPicker).toHaveText(/\s1, /)
  expect(startingDay).not.toBe('')

  // AT THE 1st IT IS STILL ENABLED. This is the assertion the old behaviour
  // fails: the button was disabled here.
  await expect(previous).toBeEnabled()

  await previous.click()

  // The month moved, and the URL with it.
  await expect(monthPicker).not.toHaveText(startingMonth)
  const month = await expect
    .poll(() => new URL(page.url()).searchParams.get('month'))
    .not.toBe(null)
    .then(() => new URL(page.url()).searchParams.get('month'))

  // AND IT LANDED ON THE NEAR END — the LAST day of that month, not its first.
  // Reading the day out of the label and comparing against the month's length
  // rather than hardcoding a date, since which month this is depends on when
  // the suite runs.
  const label = (await dayPicker.textContent())!.trim()
  const dayOfMonth = Number(label.match(/\s(\d{1,2}), /)![1])
  const [year, monthNum] = month!.split('-').map(Number)
  const lastOfMonth = new Date(year, monthNum, 0).getDate()
  // The last NAVIGABLE day, which is the last of the month for a team that
  // plays weekends — the seed's default — and within two days of it otherwise.
  expect(lastOfMonth - dayOfMonth).toBeLessThanOrEqual(2)
})

/**
 * THE PAGE WIDTH IS ONE NUMBER, AND THE CHROME AGREES WITH THE BODY
 * (wordle-teams-rpql).
 *
 * Only the header, footer and marketing routes carried `page-wrap`, so /app's
 * `<main>` was unbounded. MEASURED at 1920x1080 before the fix: header nav and
 * footer 1080px wide and centred at 420-1500, while the dashboard's content
 * spanned 48-1872 — the chrome in a narrow strip with the page sprawling 744px
 * wider on either side.
 *
 * IT LIVES HERE, NOT IN routes.spec.ts, AND THAT WAS LEARNED THE HARD WAY. The
 * first version sat there and signed in with `signIn` + `completeProfile`, which
 * does not seed a team — so it measured the `<main>` of /complete-profile, whose
 * class is `page-wrap` exactly like the header's. Every assertion agreed
 * trivially and BOTH mutants survived. A dashboard-width test needs a dashboard,
 * which is what `signInWithTeam` above provides.
 */
test('the header, footer and dashboard body all stop at the same width', async ({ page }) => {
  test.setTimeout(120_000)
  await signInWithTeam(page)
  // Proof we are on the dashboard and not still on /complete-profile, which is
  // the failure this test was born from.
  await expect(page.getByRole('button', { name: 'Team: E2E Team' })).toBeVisible({ timeout: 20_000 })

  for (const width of [1920, 2560, 3440]) {
    await page.setViewportSize({ width, height: 1080 })

    const measured = await page.evaluate(() => {
      const box = (el: Element | null) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: Math.round(r.left), right: Math.round(r.right) }
      }
      return {
        header: box(document.querySelector('header nav')),
        footer: box(document.querySelector('footer div')),
        main: box(document.querySelector('main')),
      }
    })

    // The chrome and the body occupy the SAME band. Compared as edges rather
    // than widths: two regions can share a width and still be offset from one
    // another, which is half of what looked wrong.
    expect(measured.header, `header at ${width}`).toEqual(measured.footer)
    expect(measured.main!.left, `main left at ${width}`).toBe(measured.header!.left)
    expect(measured.main!.right, `main right at ${width}`).toBe(measured.header!.right)

    // And actually CAPPED rather than merely consistent — at these widths the
    // band must be narrower than the viewport, or this would pass against a
    // page with no cap at all.
    expect(measured.main!.right - measured.main!.left, `band at ${width}`).toBeLessThan(width)
  }
})

/**
 * THE SCORES TABLE ALIGNS WITH ITS NEIGHBOURS AT EVERY WIDTH
 * (wordle-teams-rpql).
 *
 * The table's frame and the Team Boards card both carried `max-w-[96vw]` — a
 * fraction of the VIEWPORT — while every sibling on the grid is bounded by its
 * CELL. The two agreed until the difference exceeded the grid's own padding.
 * MEASURED before the fix, right edges against the picker row:
 *
 *   1920   1872 vs 1872   aligned
 *   2560   2512 vs 2506   6px short
 *   3440   3392 vs 3350   42px short
 *
 * WHAT THIS TEST DOES AND DOES NOT GUARD, stated because the distinction is
 * easy to lose: it guards the ALIGNMENT, and the thing that delivers that is the
 * page cap asserted in the test above. It does NOT guard the `max-w-full`
 * change — with the dashboard held at 1440 the content band is ~1344px, so 96vw
 * is no longer the binding constraint at any viewport and restoring it here
 * leaves this green. Verified by mutation. The class was removed to take out a
 * latent viewport-versus-parent mismatch, not as the repair, and nothing at this
 * level can tell the difference.
 */
test('the scores table and boards card reach the same right edge as the picker row', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await signInWithTeam(page)
  await expect(page.getByRole('button', { name: 'Team: E2E Team' })).toBeVisible({ timeout: 20_000 })

  for (const width of [1920, 2560, 3440]) {
    await page.setViewportSize({ width, height: 1080 })

    const edges = await page.evaluate(() => {
      const right = (el: Element | null | undefined) =>
        el ? Math.round(el.getBoundingClientRect().right) : null
      const table = document.querySelector('main table')
      const frame = table?.parentElement?.parentElement ?? null
      const boardsCard = [...document.querySelectorAll('main [data-slot="card"], main .rounded-xl')]
        .find((el) => el.textContent?.includes('Team Boards'))
      return {
        pickerRow: right(document.querySelector('main > div')),
        frame: right(frame),
        boardsCard: right(boardsCard),
      }
    })

    expect(edges.frame, `scores frame at ${width}`).toBe(edges.pickerRow)
    if (edges.boardsCard !== null) {
      expect(edges.boardsCard, `boards card at ${width}`).toBe(edges.pickerRow)
    }
  }
})
