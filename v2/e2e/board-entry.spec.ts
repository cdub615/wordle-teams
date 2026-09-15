import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { toPuzzleDay } from '../convex/lib/puzzleDay.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * WHAT RUNS THIS, AND WHAT DOES NOT. Playwright is NOT one of the four quality
 * gates (`lint`, `typecheck`, `test:once`, `build`) and no CI workflow runs
 * this file, so nothing here protects anything automatically — it is only ever
 * true of the moment somebody ran it by hand. Two consequences worth stating
 * where they will be read: a regression this spec would catch can be merged
 * green, and this file can itself rot for weeks without anyone noticing.
 *
 * IT ALSO NEEDS A LOCAL CONVEX BACKEND ON PORT 3210 — every test here seeds
 * through `ConvexHttpClient` before the browser opens, so with nothing
 * listening the whole file dies on `Network connection lost.` before a single
 * assertion runs.
 *
 * CHROMIUM ONLY, AND THAT IS A REAL LIMIT RATHER THAN A DETAIL.
 * playwright.config.ts declares no `projects`, so every test below is a fact
 * about ONE engine. It has already hidden a defect exactly once — see the
 * insertText comment in the guard test — because Chromium fires the legacy
 * `textInput` event that React's `onBeforeInput` is synthesized from, and
 * Firefox does not. A guard can therefore look proven here while being inert
 * for half the web. Read every assertion below as "in Chromium".
 */

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

  // Choosing to type focuses the ONE entry region; type the answer, and the
  // guesses follow it with no click in between — the fifth answer letter hands
  // the caret to the board itself.
  await page.keyboard.type('SPEED')
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

test('cancelable native input paths cannot corrupt the board, but typing still can', async ({
  page,
  context,
}) => {
  // Task 8 fixed a Critical bug: the two contentEditable fields (the answer
  // box and the board) intercepted `keydown` only, so mobile swipe-typing,
  // predictive text, voice dictation and paste — all of which insert via
  // `beforeinput` with NO keydown at all — could reach the DOM without
  // React's state knowing, risking a board that disagrees with what gets
  // submitted or a reconciliation crash (WordleBoard renders INSIDE the
  // board's contentEditable node). The fix is onPaste plus BOTH beforeinput
  // guards on the one entry region (form.tsx) — React's `onBeforeInput` prop,
  // which is synthesized from `textInput`, and a native `beforeinput` listener.
  // They are three deletable lines and the failure they prevent is silent — this
  // test exists so removing any of them fails CI instead of nothing at all.
  //
  // WHAT THIS TEST DOES *NOT* COVER, STATED SO NOBODY READS IT AS A CLEAN BILL:
  // an IME COMMIT. `insertText` below dispatches a beforeinput with
  // `cancelable: true`, which the guard does stop; an IME composition commits
  // with `inputType: 'insertCompositionText'` and `cancelable: FALSE`, measured
  // through Chromium's own IME channel, so preventDefault() on it does nothing
  // and the composed character lands in the DOM. The submitted payload is still
  // correct — it comes from React state, never read back off these nodes — but
  // the screen can lie, and permanently, since React only rewrites a tile's text
  // node when that tile's letter changes. Tracked as wordle-teams-5n6n. Do not
  // extend this test to claim otherwise without fixing that first.
  await signInWithTeam(page)
  await page.getByRole('button', { name: 'Board Entry' }).click()
  await page.getByRole('button', { name: 'Enter manually' }).click()

  // ONE REGION OVER BOTH HALVES since Task 8 — the answer slots and the board
  // inside a single contentEditable — so there is one node to aim an insertion
  // at, and it is a LARGER React-owned subtree than the board alone ever was.
  const region = page.getByRole('group', { name: 'Wordle board entry' })
  const answer = page.getByRole('group', { name: /Today's Wordle answer/ })
  const board = page.getByRole('region', { name: 'Wordle Board' })
  // Attribute selector, not `#1-1`: wordle-board.tsx's tile ids start with a
  // digit, which a CSS id selector cannot start with (form.tsx's own comment
  // makes the same point about querySelector).
  const firstTile = page.locator('[id="1-1"]')
  await board.waitFor()

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('ZZZZZ'))

  // Choosing to type focuses the region, so every insertion below lands on it
  // with no click at all.
  await expect(region).toBeFocused()

  // Paste — a real OS-level Ctrl/Cmd+V through the clipboard, the same path a
  // user's paste takes. Nothing in either half changes.
  await page.keyboard.press('ControlOrMeta+V')
  await expect(answer).toHaveText('')
  await expect(firstTile).toHaveText('')

  // insertText dispatches beforeinput/input WITHOUT keydown — the same event
  // shape predictive text, swipe-typing and dictation use. This proves that
  // SOMETHING on the node cancels that insertion, which is the behaviour a
  // player depends on.
  //
  // IT DOES *NOT* PROVE **WHICH** OF THE TWO GUARDS DID IT, and the difference
  // is the whole reason both exist. React's `onBeforeInput` prop is not the
  // native `beforeinput` event — it is synthesized from the legacy `textInput`
  // event — and Chromium fires `textInput` for CDP's `Input.insertText` as well
  // as `beforeinput`. So in THIS browser both guards fire on this one line, and
  // deleting the native listener would leave this assertion green. A browser
  // that fires only `beforeinput` (Firefox) is what would tell them apart, and
  // playwright.config.ts declares no `projects`, so this suite never opens one.
  // That is not hypothetical: it is how wordle-teams-5n6n's real defect hid
  // behind a test that looked like it covered this. Read this as "the node
  // refuses native insertions in Chromium", nothing wider.
  await page.keyboard.insertText('ZZZZZ')
  await expect(answer).toHaveText('')
  await expect(firstTile).toHaveText('')

  // Real key events still work — proves the guard is SELECTIVE rather than the
  // region simply being inert, which a broken one would also pass. And the
  // fifth answer letter hands the caret to the board, so the guesses follow
  // with NO click in between: that is the feature Task 8 shipped.
  await page.keyboard.type('SPEED')
  await expect(answer).toHaveText('SPEED')
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
  await expect(page.getByRole('group', { name: /Today's Wordle answer/ })).toHaveText('SPEED')
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

/**
 * THE ACCEPTANCE CRITERION FOR THE WHOLE FEATURE, IN EXECUTABLE FORM: a
 * complete board entered with NO POINTER INTERACTION AT ALL once the entry step
 * is open.
 *
 * `page.keyboard.type` WITH NOTHING BUT READ-ONLY ASSERTIONS BETWEEN THE CALLS
 * **IS** THE ASSERTION. The feature is that the caret hands itself from the
 * answer to the board on the fifth letter, so a `.click()` on the board
 * anywhere below would not FIX this test, it would DELETE THE THING IT TESTS —
 * a clicked board reaches the same end state whether or not the hand-off
 * exists, and the spec would then be green against a broken product.
 *
 * SO THE RULE IS ENFORCED BY THE PAGE RATHER THAN BY WHOEVER READS THE DIFF.
 * The counter installed below increments on any real `pointerdown`, `mousedown`
 * or `touchstart`, and the last assertion is that it never moved. Playwright's
 * `.click()` / `.tap()` / `.hover()` synthesise exactly those events through
 * CDP, so a pointer interaction added later to make something pass turns this
 * RED instead. `HTMLElement.click()` — which is how form.tsx's Enter reaches
 * `#board-submit` — dispatches only a `click`, no pointer sequence, so the
 * keyboard's own submit path stays honestly inside the budget.
 *
 * THE TWO CLICKS ABOVE THE GUARD ARE THE NAVIGATION INTO THE FEATURE, not part
 * of it: opening the panel, and choosing typing over screenshot import. Step
 * one deliberately has nothing focusable in it (that is what stops a phone's
 * keyboard opening with the panel), so "Enter manually" is the gesture that
 * hands focus to the entry region — and it is the last gesture there is.
 */
test('a whole board, typed, with no click after the entry step opens', async ({ page }) => {
  await signInWithTeam(page)
  const day = toPuzzleDay(new Date())

  await page.getByRole('button', { name: 'Board Entry' }).click()
  await page.getByRole('button', { name: 'Enter manually' }).click()

  const board = page.getByRole('region', { name: 'Wordle Board' })
  await board.waitFor()

  // ─── NO POINTER INTERACTION BELOW THIS LINE ────────────────────────────────
  await page.evaluate(() => {
    const store = window as unknown as { __wtPointerEvents?: number }
    store.__wtPointerEvents = 0
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
      // Capture phase, on `window`: nothing in the app can stop propagation
      // early enough to hide an event from this.
      window.addEventListener(
        type,
        () => {
          store.__wtPointerEvents = (store.__wtPointerEvents ?? 0) + 1
        },
        true,
      )
    }
  })

  const region = page.getByRole('group', { name: 'Wordle board entry' })
  // Choosing to type focused the region. If this ever stops being true the
  // keystrokes below go to <body> and every assertion after it fails for a
  // reason that reads like a product bug, so it is asserted here by name.
  await expect(region).toBeFocused()

  // The two zones are addressable independently, which is what lets this test
  // watch the caret CROSS rather than merely watch letters arrive. The answer
  // slots spell data-cursor on every slot (answer-slots.tsx); the board marks
  // only the one tile (wordle-board.tsx), hence the count-based reads.
  const answerCursor = page.locator('[data-testid="answer-slot"][data-cursor="true"]')
  const answerSlots = page.getByTestId('answer-slot')
  const boardCursor = page.getByTestId('board-cursor')

  // The caret starts in the ANSWER, at slot one, and the board has none.
  await expect(answerSlots.nth(0)).toHaveAttribute('data-cursor', 'true')
  await expect(boardCursor).toHaveCount(0)

  // Four letters: still the answer's, now on the fifth slot.
  await page.keyboard.type('SPEE')
  await expect(answerSlots.nth(4)).toHaveAttribute('data-cursor', 'true')
  await expect(boardCursor).toHaveCount(0)

  // THE HAND-OFF, AND IT IS ONE KEYSTROKE. The fifth answer letter, and the
  // caret is in the board — no click, no Tab, no focus() call between these two
  // assertions. This pair is the feature.
  await page.keyboard.type('D')
  await expect(answerCursor).toHaveCount(0)
  await expect(boardCursor).toHaveAttribute('id', '1-1')

  // ...and the stream simply continues. Same keyboard, same focused node, the
  // letters now landing in row one.
  await page.keyboard.type('CRANE')
  await expect(page.locator('[id="1-1"]')).toHaveText('C')
  await expect(boardCursor).toHaveAttribute('id', '2-1')

  // Row two solves it, which takes the caret away entirely — cursorFor returns
  // null on a solved board, so there is no slot left that would accept a letter.
  await page.keyboard.type('SPEED')
  await expect(page.locator('[id="2-5"]')).toHaveText('D')
  await expect(boardCursor).toHaveCount(0)
  await expect(answerCursor).toHaveCount(0)

  // Enter submits, because the keyboard has to be able to finish what it
  // started; the dialog closes only on success, so its disappearance is the
  // mutation landing.
  await page.keyboard.press('Enter')
  await expect(board).toBeHidden()

  // Scoped to THIS player and THIS puzzle day by scores-table.tsx's data-day
  // attribute, for the reason the first test in this file spells out: a bare
  // '2' sits in the table on the 2nd of every month regardless.
  const row = page.getByRole('table').locator('tr').filter({ hasText: 'E2E' })
  await expect(row.locator(`[data-day="${day}"]`)).toHaveText('2')

  // AND THE BUDGET WAS ZERO. Asserted last so a failure above reports itself
  // first, but this is the assertion the test is named after.
  expect(
    await page.evaluate(
      () => (window as unknown as { __wtPointerEvents?: number }).__wtPointerEvents ?? -1,
    ),
    'a whole board was entered, so no pointer event may have reached the page',
  ).toBe(0)
})

/**
 * THE CURSOR RING, AS A RENDERED THING — THE ONE ASSERTION NO UNIT TEST IN THIS
 * REPO CAN MAKE.
 *
 * jsdom has a CSSOM but NO LAYOUT ENGINE AND NO TAILWIND, so a *.hook.test.ts
 * can only ever assert that the element carries the class `ring-2 ring-ring`.
 * That is a fact about a string. It survives the utility being renamed, the
 * stylesheet dropping it, `ring` being shadowed by a later rule, or the ring
 * being painted under an opaque sibling — every one of which leaves the player
 * with no visible caret and every unit test green. A real Chromium has resolved
 * the cascade, and Tailwind's `ring-*` compiles to a `box-shadow`, so
 * `getComputedStyle(el).boxShadow` is the difference between "styled" and
 * "has a className".
 *
 * BOTH HALVES OF THE ENTRY SURFACE, because they are two components drawing the
 * same affordance from two copies of the same utility string — answer-slots.tsx
 * inline, wordle-board.tsx via CURSOR_CLASS — and nothing but this test makes
 * them agree about what a caret looks like.
 *
 * THE NEGATIVE HALF IS NOT PADDING. Without it, a rule that put a box-shadow on
 * EVERY tile would pass: the assertion would then prove only that shadows
 * exist, not that the cursor is distinguishable from its neighbour, which is
 * the entire point of a cursor.
 */
test('the caret ring is painted, not merely classed, in both zones', async ({ page }) => {
  await signInWithTeam(page)

  await page.getByRole('button', { name: 'Board Entry' }).click()
  await page.getByRole('button', { name: 'Enter manually' }).click()

  const board = page.getByRole('region', { name: 'Wordle Board' })
  await board.waitFor()

  const ringOf = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).boxShadow)

  /**
   * BOTH 'none' AND '' ARE FAILURES, and the empty one is the sneakier. A
   * computed `box-shadow` resolves to the string 'none' when the property is
   * simply unset, but a property the engine does not recognise at all answers
   * '' — so asserting only `not.toBe('none')` would go green on a ring that had
   * been renamed out of existence, which is precisely the class of regression
   * this test is here to catch.
   */
  const expectRing = (shadow: string, what: string) => {
    expect(shadow, `${what} must paint a ring, and 'none' is no ring`).not.toBe('none')
    expect(shadow, `${what} must paint a ring, and '' is no box-shadow at all`).not.toBe('')
  }

  const slots = page.getByTestId('answer-slot')
  // Settle on the attribute FIRST — `evaluate` is a one-shot read with no
  // auto-retry, so reading a computed style before React has committed the
  // cursor would be a race that fails in whichever direction the timing fell.
  await expect(slots.nth(0)).toHaveAttribute('data-cursor', 'true')

  expectRing(await ringOf(slots.nth(0)), 'the answer caret slot')
  expect(await ringOf(slots.nth(1)), 'a slot without the caret must paint none').toBe('none')

  // Across the hand-off, so the board's ring is checked on the tile the caret
  // actually reached rather than one this test picked.
  await page.keyboard.type('SPEED')
  const cursorTile = page.getByTestId('board-cursor')
  await expect(cursorTile).toHaveAttribute('id', '1-1')

  expectRing(await ringOf(cursorTile), 'the board caret tile')
  expect(await ringOf(page.locator('[id="1-2"]')), 'its neighbour must paint none').toBe('none')
})
