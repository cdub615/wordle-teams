import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { toPuzzleDay } from '../convex/lib/puzzleDay.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * Gives the freshly-created e2e account a team before signing in, so the
 * dashboard renders its full grid rather than the no-team branch, and the
 * toolbar's board-entry button exists to click. A fresh signIn() account has no `players` row at
 * all — see convex/e2eSeed.ts for the seeding mutation and why it is
 * committed rather than scratch tooling.
 *
 * A unique email per call, same as signIn()'s own default: each test gets its
 * own player and team, so nothing here can read a stale board or a stale
 * total left over from a previous run.
 */
async function signInWithTeam(page: Page): Promise<string> {
  const email = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await signIn(page, email)
  return email
}

/**
 * The same, but Pro — because screenshot import is gated on it.
 *
 * seedInsightsFor is the only way to make an e2e account genuinely pro on a
 * real deployment; billing.spec.ts records that no other comp-pro seed exists.
 * `boards: 0` so the month stays empty and pickDefaultDay still opens on today,
 * which is what the assertions below depend on.
 */
async function signInAsPro(page: Page): Promise<string> {
  const email = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await convex.mutation(api.e2eSeed.seedInsightsFor, {
    email,
    boards: 0,
    lastDay: toPuzzleDay(new Date()),
    pro: true,
  })
  await signIn(page, email)
  return email
}

test('enter a board and see the score land', async ({ page }) => {
  await signInWithTeam(page)

  // The board opens to "today" by default — pick-default-day.ts's fast path
  // for a playWeekends:true team with nothing entered yet. Derived the same
  // way the app derives it, not hardcoded, so this holds on whatever day the
  // suite happens to run.
  const day = toPuzzleDay(new Date())

  await page.getByRole('button', { name: 'Board Entry' }).click()

  // Board entry opens on a step that asks WHICH DAY AND HOW, with nothing
  // focusable in it — that is what stopped the software keyboard opening with
  // the panel and cropping the board to two rows on a phone. Typing is one of
  // the three ways on, and choosing it is what focuses the answer.
  await page.getByRole('button', { name: 'Enter manually' }).click()

  const board = page.getByRole('region', { name: 'Wordle Board' })
  await board.waitFor()

  // Choosing to type focuses the answer field; type the answer, then the guesses.
  await page.keyboard.type('SPEED')
  await board.click()
  await page.keyboard.type('CRANESPEED')

  await page.getByRole('button', { name: 'Submit' }).click()

  // The dialog closes only on success, so its disappearance is one proof the
  // write landed — the mutation succeeded.
  await expect(board).toBeHidden()

  // ...but that doesn't prove the TABLE shows it, which is the actual point
  // of "see the score land". A bare toContainText('2') on the whole table is
  // NOT that proof: scores-table.tsx renders day headers as e.g. "Sun 2nd"
  // (weekday and ordinal from format-day.ts, joined on the page), so the
  // character '2' sits in the table on every load — the 2nd of every month —
  // whether or not any board was ever submitted. scores-table.tsx's
  // data-day attribute makes the one cell that matters (this player, this
  // puzzleDay) addressable, so the assertion is scoped to exactly the write
  // this test just made rather than to a column header that was always there.
  const row = page.getByRole('table').locator('tr').filter({ hasText: 'E2E' })
  await expect(row.locator(`[data-day="${day}"]`)).toHaveText('2')
})

test('native input paths cannot corrupt the board, but typing still can', async ({
  page,
  context,
}) => {
  // Task 8 fixed a Critical bug: the two contentEditable fields (the answer
  // box and the board) intercepted `keydown` only, so mobile swipe-typing,
  // predictive text, voice dictation and paste — all of which insert via
  // `beforeinput` with NO keydown at all — could reach the DOM without
  // React's state knowing, risking a board that disagrees with what gets
  // submitted or a reconciliation crash (WordleBoard renders INSIDE the
  // board's contentEditable node). The fix is onBeforeInput + onPaste with
  // preventDefault() on both fields (board-input.tsx, form.tsx). It is one
  // deletable line per field and the failure it prevents is silent — this
  // test exists so removing either line fails CI instead of nothing at all.
  await signInWithTeam(page)
  await page.getByRole('button', { name: 'Board Entry' }).click()
  await page.getByRole('button', { name: 'Enter manually' }).click()

  const answer = page.locator('#answer')
  const board = page.getByRole('region', { name: 'Wordle Board' })
  // Attribute selector, not `#1-1`: wordle-board.tsx's tile ids start with a
  // digit, which a CSS id selector cannot start with (form.tsx's own comment
  // makes the same point about querySelector).
  const firstTile = page.locator('[id="1-1"]')
  await board.waitFor()

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('ZZZZZ'))

  // Paste — a real OS-level Ctrl/Cmd+V through the clipboard, the same path a
  // user's paste takes. Neither field's content changes.
  await answer.click()
  await page.keyboard.press('ControlOrMeta+V')
  await expect(answer).toHaveText('')

  await board.click()
  await page.keyboard.press('ControlOrMeta+V')
  await expect(firstTile).toHaveText('')

  // insertText dispatches beforeinput/input WITHOUT keydown — the same event
  // shape predictive text, swipe-typing and dictation use. Neither field's
  // content changes.
  await answer.click()
  await page.keyboard.insertText('ZZZZZ')
  await expect(answer).toHaveText('')

  await board.click()
  await page.keyboard.insertText('ZZZZZ')
  await expect(firstTile).toHaveText('')

  // Real key events still work — proves the guard is SELECTIVE rather than
  // the fields simply being inert, which a broken/removed field could also
  // pass every assertion above.
  await answer.click()
  await page.keyboard.type('SPEED')
  await expect(answer).toHaveText('SPEED')

  await board.click()
  await page.keyboard.type('CRANE')
  await expect(firstTile).toHaveText('C')
})

test('the mobile sheet has an accessible name', async ({ page }) => {
  // Phase-close review: the desktop Dialog branch renders a DialogTitle, but
  // the mobile Sheet branch (button.tsx) had only a SheetDescription — no
  // Title at all. Both are built on @radix-ui/react-dialog, which requires a
  // Title descendant of Content; without one the sheet has NO accessible name
  // for screen-reader users, on the primary mobile entry point for the whole
  // feature this phase exists to deliver. Unlike the rendering bugs earlier
  // in this phase, a screenshot cannot catch this — a missing accessible name
  // looks pixel-identical to a present one. getByRole('dialog', { name }) is
  // the direct assertion; it fails the same way a screen reader user would
  // experience the bug (no name to announce), not just "some Title exists".
  //
  // The fix keeps the title out of the painted layout (radix-ui's
  // VisuallyHidden) rather than showing it like the desktop Dialog does: the
  // mobile sheet is compact and every pixel of vertical space is contested
  // with the keyboard — see use-visual-viewport.ts.
  await page.setViewportSize({ width: 390, height: 844 })
  await signInWithTeam(page)

  await page.getByRole('button', { name: 'Board Entry' }).click()
  await expect(page.getByRole('dialog', { name: 'Add or Update Board' })).toBeVisible()
})

/**
 * STEP ONE, IMPORT, CONFIRM, SUBMIT — the whole path, in a real browser.
 *
 * THE ONE THING NO UNIT TEST CAN REACH. jsdom has no rasteriser at all, so
 * every unit test of the adapter stands in for the canvas; here a real Chromium
 * decodes a real PNG through a real canvas and the parser runs on what comes
 * out. If the decode, the downscale or the ImageData layout were wrong,
 * everything else would still be green and only this would fail.
 *
 * The fixture is SYNTHESISED — scripts/build-e2e-board-fixture.mjs renders it
 * from the Task 1 renderer, with no status bar, no wallpaper and no timestamp,
 * because there was never a phone. The real screenshot corpus stays gitignored
 * in v2/screenshots.local/ and is never reached for from a committed test.
 *
 * It proves the PLUMBING, not the reading: the letters are painted from the
 * same templates that read them back. Glyph accuracy is measured by
 * scripts/validate-board-import.mjs against the real corpus and nowhere else.
 */
test('import a board from a screenshot, confirm it, and see the score land', async ({ page }) => {
  await signInAsPro(page)
  const day = toPuzzleDay(new Date())

  await page.getByRole('button', { name: 'Board Entry' }).click()

  // Step one: the day, and how. Nothing focusable, so no keyboard has opened.
  await expect(page.getByRole('button', { name: 'Enter manually' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Wordle Board' })).toBeHidden()

  // The file input is the picker's, and is the one import path a test can drive
  // without the clipboard permissions the paste button needs.
  await page
    .getByLabel('Wordle screenshot')
    .setInputFiles(path.join(here, 'fixtures', 'board-speed.png'))

  // The confirm step: the board read off the image, and the answer with it.
  const board = page.getByRole('region', { name: 'Wordle Board' })
  await board.waitFor()
  await expect(page.getByTestId('board-import-note')).toContainText('Read 2 guesses')
  await expect(page.locator('#answer')).toHaveText('SPEED')
  await expect(page.locator('[id="1-1"]')).toHaveText('C')
  await expect(page.locator('[id="2-1"]')).toHaveText('S')

  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(board).toBeHidden()

  // Two guesses, so the day scores 2. Scoped to THIS player and THIS puzzle day
  // by scores-table.tsx's data-day attribute, for the reason the test above
  // spells out: a bare '2' sits in the table on the 2nd of every month whether
  // or not anything was ever submitted.
  const row = page.getByRole('table').locator('tr').filter({ hasText: 'E2E' })
  await expect(row.locator(`[data-day="${day}"]`)).toHaveText('2')
})
