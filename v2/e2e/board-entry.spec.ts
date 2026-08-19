import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import type { Page } from '@playwright/test'

/**
 * Gives the freshly-created e2e account a team before signing in, so the
 * dashboard clears its "not on a team yet" empty state and the board-entry
 * button exists to click. A fresh signIn() account has no `players` row at
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

test('enter a board and see the score land', async ({ page }) => {
  await signInWithTeam(page)

  await page.getByRole('button', { name: 'Board Entry' }).click()
  const board = page.getByRole('region', { name: 'Wordle Board' })
  await board.waitFor()

  // The answer field takes focus on open; type the answer, then the guesses.
  await page.keyboard.type('SPEED')
  await board.click()
  await page.keyboard.type('CRANESPEED')

  await page.getByRole('button', { name: 'Submit' }).click()

  // The dialog closes only on success, so its disappearance IS the assertion
  // that the write landed.
  await expect(board).toBeHidden()

  // Today's cell shows its attempt count (src/lib/wordle.ts's scoreCell) —
  // this board took 2 guesses, so '2' appearing in the table is proof the
  // write reached the exact score the table reads, not just that the dialog
  // closed. The seeded team plays every day of the week and the board was
  // just entered for "today" (pick-default-day.ts's fast path), so this holds
  // for whatever day the suite happens to run on rather than a fixed date.
  await expect(page.getByRole('table')).toContainText('2')
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
