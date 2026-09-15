import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { toPuzzleDay } from '../convex/lib/puzzleDay.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CDPSession, Locator, Page } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * WHAT RUNS THIS. Playwright is NOT one of the four quality gates (`lint`,
 * `typecheck`, `test:once`, `build`), so `pnpm test:once` passing says nothing
 * about this file. But CI DOES run it: `.github/workflows/deploy-v2.yml`, step
 * "End-to-end against a local Convex backend", on every push to dev, main and
 * feat/v2-replatform — before the deploy steps, so a failure here blocks the
 * deploy rather than following it.
 *
 * CORRECTED 2026-09-15. This comment previously said no CI workflow ran this
 * file and that nothing here protected anything automatically. That was true
 * when wt-ksh.8.49 was filed and has not been true since it was fixed; the
 * claim was carried forward from a stale instruction rather than checked. It
 * mattered: the IME test below was written believing it would never run, and it
 * ran green in CI on its first push (34987176915).
 *
 * IT ALSO NEEDS A LOCAL CONVEX BACKEND ON PORT 3210 — every test here seeds
 * through `ConvexHttpClient` before the browser opens, so with nothing
 * listening the whole file dies on `Network connection lost.` before a single
 * assertion runs.
 *
 * CHROMIUM ONLY, AND THAT IS A REAL LIMIT RATHER THAN A DETAIL.
 * playwright.config.ts declares no `projects`, so every test below is a fact
 * about ONE engine. It has already hidden a defect exactly once: the insertion
 * guards this file used to assert were per-browser — Chromium fires the legacy
 * `textInput` event React's `onBeforeInput` is synthesized from and Firefox does
 * not — so a guard looked proven here while being inert for half the web, and the
 * hole that mattered (an uncancelable IME commit, wordle-teams-5n6n) was in every
 * browser at once. THOSE GUARDS ARE GONE; what replaced them is structural rather
 * than per-engine — there is no editing host for an insertion to land in — which
 * is the kind of claim one browser CAN stand for. The IME test below still needs
 * `newCDPSession`, which is Chromium-only. Read every assertion as "in Chromium".
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

  // Choosing to type focuses the ONE entry input; type the answer, and the
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

/**
 * DRIVES A REAL IME COMPOSITION THROUGH CHROMIUM'S OWN CHANNEL.
 *
 * `Input.imeSetComposition` is the CDP command Blink's InputMethodController
 * sits behind — the same path a Gboard, a Pinyin IME or macOS Kotoeri takes —
 * and `Input.insertText` is how a composition is COMMITTED. Nothing else in this
 * repo can produce one: jsdom has no composition at all, and
 * `page.keyboard.insertText` fires a beforeinput that is `cancelable: true`,
 * which is the easy half.
 *
 * Both are needed, and `newCDPSession` is Chromium-only, which is one more
 * reason every assertion in this file reads "in Chromium".
 */
async function composeAndCommit(
  cdp: CDPSession,
  word: string,
): Promise<void> {
  // One update per character, the way an IME reports its in-progress reading.
  for (let index = 1; index <= word.length; index++) {
    await cdp.send('Input.imeSetComposition', {
      text: word.slice(0, index),
      selectionStart: index,
      selectionEnd: index,
    })
  }
  // The commit. This is the event whose `beforeinput` is `cancelable: FALSE`.
  await cdp.send('Input.insertText', { text: word })
}

test('no native input path can reach the board — paste, drop, insertText or an IME', async ({
  page,
  context,
}) => {
  /**
   * WHAT THIS REPLACES, AND WHY THE OLD VERSION COULD NOT BE EXTENDED.
   *
   * This test used to assert that the entry region CANCELLED every insertion:
   * `onPaste`, React's synthesized `onBeforeInput`, and a native `beforeinput`
   * listener, all on one `contentEditable` wrapped around the answer slots and
   * the board. It then said in prose that it did NOT cover an IME commit, because
   * `beforeinput` for `inputType: insertCompositionText` is dispatched
   * `cancelable: FALSE` and no handler can refuse it — so composed text landed in
   * the DOM under React and, in a tile the player never retyped, stayed there
   * (wordle-teams-5n6n).
   *
   * THE FIX WAS TO DELETE THE EDITING HOST, NOT TO ADD A FOURTH GUARD. The slots
   * and the board are plain presentation now; focus, the software keyboard and any
   * composition live on a visually-hidden `<input>` beside them that nothing reads
   * and that is wiped on `compositionend`. So there is no longer anything to
   * cancel, and the assertion changes shape with it: not "the insertion is
   * refused" but "the insertion lands somewhere that cannot be seen".
   *
   * THAT IS WHY THE IME CASE IS FINALLY IN HERE RATHER THAN DISCLAIMED IN A
   * COMMENT. It is the one place in the repo where this fix is provable
   * end to end.
   */
  await signInWithTeam(page)
  await page.getByRole('button', { name: 'Board Entry' }).click()
  await page.getByRole('button', { name: 'Enter manually' }).click()

  /**
   * STILL `getByRole('group', ...)`, AND THAT IS NOT AN ACCIDENT OF THE REWRITE.
   * form.tsx puts `role="group"` on the input deliberately — an ARIA override over
   * the implicit `textbox`, which would be a lie about a field with no text in it
   * and would break this selector and its two siblings below. The element behind
   * it is an `<input>`, not the region it used to be.
   */
  const region = page.getByRole('group', { name: 'Wordle board entry' })
  const answer = page.getByRole('group', { name: /Today's Wordle answer/ })
  const board = page.getByRole('region', { name: 'Wordle Board' })
  // Attribute selector, not `#1-1`: wordle-board.tsx's tile ids start with a
  // digit, which a CSS id selector cannot start with (form.tsx's own comment
  // makes the same point about querySelector).
  const firstTile = page.locator('[id="1-1"]')
  await board.waitFor()

  /**
   * THE STRUCTURAL ASSERTION, AND IT IS THE ONE THAT MAKES THE REST TRUE.
   *
   * Everything below is a consequence of this: a subtree that is not an editing
   * host has no insertion path into it. Asserted here as well as in
   * form.hook.test.ts because this is the built page, with the real stylesheet and
   * the real Radix surface — a `contentEditable` reintroduced by any of the
   * components in between would show up here and nowhere else.
   */
  expect(
    await page.locator('[role="dialog"] [contenteditable]').count(),
    'nothing in the entry surface may be an editing host — that is the whole fix',
  ).toBe(0)

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('ZZZZZ'))

  // Choosing to type focuses the input, so every insertion below lands on it with
  // no click at all.
  await expect(region).toBeFocused()

  // Paste — a real OS-level Ctrl/Cmd+V through the clipboard, the same path a
  // user's paste takes. Nothing in either half changes.
  await page.keyboard.press('ControlOrMeta+V')
  await expect(answer).toHaveText('')
  await expect(firstTile).toHaveText('')

  // insertText dispatches beforeinput/input WITHOUT keydown — the same event
  // shape predictive text, swipe-typing and dictation use.
  await page.keyboard.insertText('ZZZZZ')
  await expect(answer).toHaveText('')
  await expect(firstTile).toHaveText('')

  // A text/plain DROP aimed at a tile, which used to be a live insertion path
  // into the React-owned board because the tile was inside the editing host.
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', 'QQQQQ')
    document
      .getElementById('1-1')!
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    document.execCommand('insertText', false, 'QQQQQ')
  })
  await expect(answer).toHaveText('')
  await expect(firstTile).toHaveText('')

  // ─── THE IME, WHICH IS THE CASE THIS FILE USED TO DISCLAIM ─────────────────
  const cdp = await context.newCDPSession(page)
  // Capture phase on `document`, so nothing in the app can hide an event from
  // this by stopping propagation.
  await page.evaluate(() => {
    const counts = { start: 0, end: 0 }
    ;(window as unknown as { __wtComposition: typeof counts }).__wtComposition = counts
    document.addEventListener('compositionstart', () => (counts.start += 1), true)
    document.addEventListener('compositionend', () => (counts.end += 1), true)
  })

  // A composition while the caret is in the ANSWER zone.
  await composeAndCommit(cdp, 'こんにちは')
  await expect(answer).toHaveText('')
  await expect(firstTile).toHaveText('')

  /**
   * THE LIFECYCLE IS THE SECOND ASSERTION AND IT IS NOT PADDING.
   *
   * form.tsx drains the input on `compositionend` and on a NON-COMPOSING `input`,
   * never on every `input`. Draining on every one was measured to restart the
   * composition — `compositionstart ×10` for a single ten-update word — which in a
   * real CJK keyboard tears the candidate window down mid-choice. A player would
   * see that; this suite would not, unless it counts.
   */
  expect(
    await page.evaluate(
      () => (window as unknown as { __wtComposition: { start: number; end: number } }).__wtComposition,
    ),
    'one composition must produce exactly one start and one end — draining on every input restarts it',
  ).toEqual({ start: 1, end: 1 })

  // Real key events still work — proves the input is SELECTIVE rather than the
  // surface simply being inert, which a broken one would also pass. And the fifth
  // answer letter hands the caret to the board, so the guesses follow with NO
  // click in between: that is the feature Task 8 shipped and this must not cost.
  await page.keyboard.type('SPEED')
  await expect(answer).toHaveText('SPEED')
  await page.keyboard.type('CRANE')
  await expect(firstTile).toHaveText('C')

  /**
   * AND NOW THE CASE THAT WAS UNREPAIRABLE: A COMPOSITION AIMED AT A FILLED TILE.
   *
   * Clicking a tile used to move the caret INTO it, so composed text could land in
   * any tile — and React only rewrites a tile's text node when that tile's LETTER
   * changes, so text dropped into a tile the player does not retype survived every
   * re-render. The click below is that gesture, and the forced DOM Range is
   * stronger than the click: it puts the selection inside the tile explicitly,
   * which is the state the old bug needed.
   */
  await firstTile.click()
  await page.evaluate(() => {
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('1-1')!)
    const selection = getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  for (const word of ['にほんご', 'かんじ', 'テスト']) {
    await composeAndCommit(cdp, word)
  }

  // The board is byte-for-byte what was typed, and the hidden input is empty.
  await expect(answer).toHaveText('SPEED')
  await expect(firstTile).toHaveText('C')
  await expect(page.locator('[id="1-5"]')).toHaveText('E')
  expect(
    await region.inputValue(),
    'the throwaway input must be drained, or a stale composition sits in the accessibility tree',
  ).toBe('')
  // The tap on the tile did not take focus away either — form.tsx preventDefaults
  // mousedown over the presentation precisely so a phone does not drop its
  // keyboard when the player corrects a letter.
  await expect(region).toBeFocused()
})

/**
 * THE SCROLLING KEYS, WHERE `clientHeight` IS A REAL NUMBER.
 *
 * The board sits in an `overflow-y-auto` container and a keyboard-only player has
 * to reach the rows below the fold. That used to be the BROWSER's job — focus sat
 * on a contentEditable INSIDE that container, so Chromium scrolled the nearest
 * scrollable ancestor of the focused node. Moving focus onto an input OUTSIDE the
 * container (which it has to be — see form.tsx) took that away: measured at
 * 390x380 with the scroller's max scrollTop at 317, the old shape moved 0 -> 317
 * and the new shape moved 0 -> 0. form.tsx therefore scrolls the container itself.
 *
 * WHY THIS IS HERE AND NOT IN form.hook.test.ts. That file presses all six keys
 * and asserts they are prevented, but jsdom reports every box as 0x0 — so
 * `Home`, `End`, `PageUp` and `PageDown` ALL resolve to 0 there and only the fixed
 * +/-40 arrow step is observable. MEASURED: mutating `End` to `() => 0`, `Home` to
 * `() => node.scrollHeight` or `PageDown` to `node.scrollTop` leaves the whole unit
 * suite green. Four of the six keys are unprovable under vitest, which makes this
 * the only place the fix for that regression can be defended at all.
 *
 * THE VIEWPORT IS PART OF THE TEST. At a desktop size the board fits and the
 * scroller has nothing to scroll, so every assertion below would pass against a
 * completely broken implementation. The `max > 0` guard is what stops that being
 * silent.
 */
test('the scrolling keys scroll the board, not the dialog', async ({ page }) => {
  // Short enough that the entry scroller genuinely overflows.
  await page.setViewportSize({ width: 390, height: 380 })
  await signInWithTeam(page)

  await page.getByRole('button', { name: 'Board Entry' }).click()
  await page.getByRole('button', { name: 'Enter manually' }).click()
  await page.getByRole('region', { name: 'Wordle Board' }).waitFor()

  const scroller = page.getByTestId('entry-scroller')
  const top = () => scroller.evaluate((element) => element.scrollTop)
  const max = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight)
  expect(max, 'the board must actually overflow here, or nothing below proves anything').toBeGreaterThan(0)

  // Focus is on the hidden input, outside this container — the whole reason the
  // form has to do the scrolling itself.
  await expect(page.getByRole('group', { name: 'Wordle board entry' })).toBeFocused()

  await scroller.evaluate((element) => (element.scrollTop = 0))
  await page.keyboard.press('End')
  expect(await top(), 'End must reach the bottom of the board').toBe(max)

  await page.keyboard.press('Home')
  expect(await top(), 'Home must return to the top').toBe(0)

  await page.keyboard.press('PageDown')
  const afterPageDown = await top()
  expect(afterPageDown, 'PageDown must move down the board').toBeGreaterThan(0)

  await page.keyboard.press('PageUp')
  expect(await top(), 'PageUp must undo it').toBeLessThan(afterPageDown)

  await scroller.evaluate((element) => (element.scrollTop = 0))
  await page.keyboard.press('ArrowDown')
  // One tile row — the unit this content has, and the only one jsdom can see.
  expect(await top(), 'ArrowDown must move the board by one row').toBe(40)

  // AND THE KEYS THAT SCROLL MUST NOT TYPE. The board is still empty, so the
  // scrolling above cost no keystroke.
  await expect(page.getByRole('group', { name: /Today's Wordle answer/ })).toHaveText('')
  await expect(page.locator('[id="1-1"]')).toHaveText('')
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
 * hands focus to the entry input — and it is the last gesture there is.
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
  // Choosing to type focused the input. If this ever stops being true the
  // keystrokes below go to <body> and every assertion after it fails for a
  // reason that reads like a product bug, so it is asserted here by name. It
  // still answers to `getByRole('group', ...)` because form.tsx sets that role on
  // the input deliberately — see the IME test above.
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
