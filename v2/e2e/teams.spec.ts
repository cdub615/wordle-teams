import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { toPuzzleDay } from '../convex/lib/puzzleDay.ts'
import type { Page } from '@playwright/test'

/**
 * Phase 3 team management, plus wt-ksh.4.1 — the Phase 2 acceptance criterion
 * ("a board entered in one browser updates another viewer's table without a
 * refresh") that Phase 2 could not verify because it had no way to seed two
 * different signed-in players on one team. Phase 3 does.
 *
 * Kept to a smoke test, not a suite, per the parent design — Phase 3 has a lot
 * of surface (create/switch/rename/settings/delete, member removal, the
 * scoring editor) and none of it is re-covered here beyond what proves the
 * dropdown creation path and the scoring card's row shape.
 */

/**
 * Gives a freshly-created e2e account a team before signing in, exactly like
 * board-entry.spec.ts's identically-named helper — see convex/e2eSeed.ts's
 * ensureTeamFor for the E2E_TEST_MODE / e2e+* guards that make this safe. Not
 * shared with board-entry.spec.ts on purpose: the two files each own their
 * seeding needs rather than reaching across specs for a few lines.
 */
async function signInWithTeam(page: Page): Promise<string> {
  const email = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await signIn(page, email)
  return email
}

test('creating a team through the dropdown makes it the selected one', async ({ page }) => {
  // Starts with one team already, not zero: with no teams the picker renders
  // nothing at all (team-picker.tsx returns null below one team) and "New
  // Team" is only reachable from the zero-teams empty state's own card
  // instead — a different, already-sanctioned path (V2-ADDENDUM 7a, amendment
  // A7). The DROPDOWN's create path, which is what this test is named for,
  // needs an existing team to hang the dropdown off.
  await signInWithTeam(page)

  const name = `E2E Team ${Date.now()}`

  // The trigger's accessible name is `Team: ${full name}` (team-picker.tsx) —
  // deliberately the untruncated name, not the label painted on the button —
  // so a starting name of exactly 'E2E Team' matches this exactly.
  await page.getByRole('button', { name: 'Team: E2E Team' }).click()
  await page.getByRole('menuitem', { name: 'New Team' }).click()
  await page.getByLabel('Team Name').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()

  // Toast confirms the write landed; the dialog closing on success (not
  // before) is create-team-dialog.tsx's own guarantee against losing a failed
  // submit's input, exercised implicitly by the dialog being gone next.
  await expect(page.getByText('Successfully created team')).toBeVisible()
  await expect(page.getByRole('button', { name: `Team: ${name}` })).toBeVisible()
  await expect(page).toHaveURL(/team=/)
  // The new team is on the MyTeams card too, not just the picker.
  await expect(page.getByRole('heading', { name: 'My Teams' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible()

  // wt-ksh regression: creating a team through the dropdown makes THIS
  // account its owner (createTeam sets owner to the caller), and a solo
  // team's only member is that same account. current-team-card.tsx used to
  // filter the owner out of `members` at the call site instead of gating
  // just the remove control, so an owner on a solo team saw an EMPTY
  // Current Team card while their own name still showed up in My Teams and
  // the scores table above — three views of the same team disagreeing on one
  // screen. Scoped to the card's own `role="region"` landmark (not just
  // `getByText`) because the same "E2E Tester" text also appears in
  // MyTeamsCard's row for this team, and a plain text locator would be
  // ambiguous between the two cards.
  const currentTeamCard = page.getByRole('region', { name: 'Current Team' })
  await expect(currentTeamCard.getByRole('heading', { name })).toBeVisible()
  await expect(currentTeamCard.getByText('E2E Tester')).toBeVisible()
  // The owner cannot remove themselves — removeMember refuses it
  // server-side, and the card must not offer the control against its own
  // row. `Remove E2E` is the exact aria-label current-team-card.tsx builds
  // from this account's own firstName.
  await expect(currentTeamCard.getByRole('button', { name: 'Remove E2E' })).toHaveCount(0)
})

test('the scoring system card shows the eight rows for the selected month', async ({ page }) => {
  await signInWithTeam(page)

  await expect(page.getByRole('heading', { name: 'Scoring System' })).toBeVisible()
  const rows = page.getByRole('table').filter({ has: page.getByText('Attempts') }).locator('tbody tr')
  await expect(rows).toHaveCount(8)
  await expect(page.getByRole('cell', { name: 'Missed day' })).toBeVisible()
})

test('a board entered by one player updates a teammate’s table with no reload', async ({
  browser,
}) => {
  // wt-ksh.4.1. This is the one thing in the whole suite that genuinely needs
  // two authenticated sessions against a real deployment — separate browser
  // CONTEXTS, not just separate pages, so neither shares the other's cookies
  // or localStorage. A single-context version of this test would prove
  // nothing: both "sessions" would be the same signed-in user.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const emailA = `e2e+live-a-${stamp}@wordleteams.com`
  const emailB = `e2e+live-b-${stamp}@wordleteams.com`

  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  // ensureSharedTeamFor (convex/e2eSeed.ts), not two ensureTeamFor calls: each
  // of those seeds its OWN team for its OWN caller, so two calls would produce
  // two disjoint teams rather than one shared one. Both players come back
  // profile-complete (firstName AND lastName). As of Phase 4 the schema requires
  // both fields to be PRESENT, but v.string() accepts '', so it is still the
  // seed writing real names that makes these rows render — not the schema. A
  // blank-named player would appear in the table and could even win the month.
  await convex.mutation(api.e2eSeed.ensureSharedTeamFor, { emailA, emailB })

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()

  try {
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    await signIn(pageA, emailA)
    await signIn(pageB, emailB)

    // Both accounts have exactly one team — the shared one just seeded — so
    // resolveDashboardSearch (lib/dashboard-search.ts) lands each of them on
    // it with no stored preference and no click: `teams[0]?.id` is the only
    // candidate. This is app-driven navigation, not test interaction, and it
    // is the only thing that touches page B before the assertions below.
    // It's PLAYER A's row we watch on page B — A is the one entering the
    // board, and B never interacts, so what B must see change is a
    // TEAMMATE'S cell, not its own. (An earlier version of this test watched
    // player B's own row instead, which stayed empty for the entirely
    // unrelated reason that B never enters a board at all — a bug in the
    // test, not in the app; caught because the assertion below timed out.)
    const day = toPuzzleDay(new Date())
    const rowAOnPageB = pageB.getByRole('table').locator('tr').filter({ hasText: 'PlayerA' })
    const cellAOnPageB = rowAOnPageB.locator(`[data-day="${day}"]`)

    // Confirms the row/cell locator actually resolves to something, and
    // that today's cell starts genuinely EMPTY (scoreCell's '' for "no score,
    // not yet due") rather than some other placeholder this test would
    // otherwise mistake for "no update happened yet".
    await expect(cellAOnPageB).toBeVisible()
    await expect(cellAOnPageB).toHaveText('')

    // Player A enters a board. Same two guesses as board-entry.spec.ts
    // ('SPEED' answer, CRANE then SPEED), so the cell reads '2' — a value the
    // page could not have painted from nothing, and a value the seeded team
    // gives no player any other way to reach.
    await pageA.getByRole('button', { name: 'Board Entry' }).click()
    const board = pageA.getByRole('region', { name: 'Wordle Board' })
    await board.waitFor()
    await pageA.keyboard.type('SPEED')
    await board.click()
    await pageA.keyboard.type('CRANESPEED')
    await pageA.getByRole('button', { name: 'Submit' }).click()
    await expect(board).toBeHidden()

    // THE ASSERTION THIS WHOLE TEST EXISTS FOR. No page.reload() anywhere in
    // page B's path above or below this line, and nothing calls page B at
    // all between signIn and here. `expect(...).toHaveText` polls (web-first
    // assertion, default timeout) rather than reading once, which is exactly
    // what lets an async Convex push land after the assertion starts and
    // still be caught — a plain one-shot read taken immediately after
    // Submit would very plausibly race the subscription and fail even with
    // reactivity fully intact, which is not the failure mode this test is
    // for.
    await expect(cellAOnPageB).toHaveText('2')
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
