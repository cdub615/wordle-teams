import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { addMonths, monthOf, toPuzzleDay } from '../convex/lib/puzzleDay.ts'

/**
 * `?month=` OUTSIDE THE SELECTED TEAM'S WINDOW, ON THE REAL DASHBOARD
 * (wordle-teams-alr7).
 *
 * WHAT NO OTHER GATE CAN SEE, which is why this file exists at all. The defect
 * is a RACE between two things that only both exist in a browser: six
 * `useSuspenseQuery(api.scores.getTeamMonth)` call sites that fire during RENDER
 * (scores-table, scoring-legend, scoring-system-card, today-panel,
 * teams/team-boards and board-entry/form) and the `?month=` correction, which
 * runs from a useEffect AFTER commit. `vitest run` cannot render a route module
 * — src/routes.test.ts's month-window block says so at length — and
 * convex/scores.test.ts proves only that the server refuses the month, which is
 * correct behaviour and exactly what used to reach the error boundary. Only a
 * real load, against a real deployment, can show that the refusal never happens.
 *
 * THE FAILURE IT CATCHES IS THE ERROR BOUNDARY. `getTeamMonthFor` throws
 * MONTH_OUT_OF_WINDOW, convex-error.ts maps it, and DashboardError paints "Ruh
 * roh, something went wrong!" over the whole route. Both tests below therefore
 * assert on that exact sentence rather than on a spinner or a count: it is the
 * one thing that is unambiguously the bug, and it is sticky — once the boundary
 * has caught, nothing on the page recovers on its own.
 *
 * BOTH PATHS ARE DRIVEN, because the issue named only one of them. A team switch
 * preserves `?month=` deliberately, and a FIRST LOAD from a bookmarked or shared
 * URL reaches the same render with no switch involved — `api.scores.monthWindow`
 * has not answered on the first render either. The first test is the wider door
 * and needs no Pro subscription; the second is the reported one and does.
 *
 * NOT A CI GATE. `wt-ksh.8.49` records that CI runs lint, typecheck, `vitest run`
 * and build and no Playwright at all, so this is something somebody runs by hand.
 * The guard itself is pinned inside the gates by src/routes.test.ts (that it is
 * called, and that it returns) and src/lib/dashboard-months.test.ts (what it
 * decides). This proves the two halves actually meet.
 */

const convex = () => new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

/**
 * `e2e+…@wordleteams.com` WITH A RANDOM SUFFIX AS WELL AS A TIMESTAMP, for the
 * reason sign-in.ts gives: the domain is what every seed's `isE2eTraffic` guard
 * checks, and the suffix is what stops two workers in the same millisecond
 * sharing an account.
 */
const address = (tag: string) =>
  `e2e+${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`

/** The viewer's current month, derived exactly as routes/app.tsx derives it. */
const thisMonth = () => monthOf(toPuzzleDay(new Date()))

/**
 * WHERE THE DASHBOARD HAS SETTLED: the month `?month=` finally names, or the
 * string 'DashboardError' if the route's error boundary caught instead.
 *
 * ONE VALUE FOR BOTH OUTCOMES, AND THAT IS THE POINT RATHER THAN A CONVENIENCE.
 * The obvious spelling — assert the boundary is absent, then assert the URL —
 * passed against the BROKEN code, measured: the correction and the six
 * MONTH_OUT_OF_WINDOW rejections are both in flight when the switch is clicked,
 * and Playwright sampled the page in the window before either landed. Both
 * assertions were true of a page that was about to throw. Polling ONE value that
 * can only become the corrected month once nothing is left to reject removes that
 * window, and names the failure — `expected "2026-09", received "DashboardError"`
 * — instead of reporting a URL and leaving the reader to find the boundary.
 */
const settlesOn = (page: Page, boundary: Locator) => async () =>
  (await boundary.count()) > 0 ? 'DashboardError' : new URL(page.url()).searchParams.get('month')

test('a shared `?month=` the team cannot show corrects itself instead of throwing', async ({
  page,
}) => {
  // THE FIRST-LOAD PATH, AND A FREE ACCOUNT IS ENOUGH. The month dropdown never
  // offers a free viewer anything outside the free window — but routes/app.tsx's
  // `validateSearch` admits any well-formed 'YYYY-MM' without consulting a
  // window, so a hand-typed or forwarded URL walks straight past it. Nothing is
  // seeded but a team: this account has no boards, so the team's window IS the
  // free window and 2020-01 is nowhere near it.
  const email = address('month-window')
  const teamId = await convex().mutation(api.e2eSeed.ensureTeamFor, { email })
  await signIn(page, email)

  // A FULL DOCUMENT LOAD, which is what a bookmark or a forwarded link is — not
  // an in-app navigation. That matters: it is the load on which `loadedWindow` is
  // undefined for every reader, so the correction provably cannot have run.
  await page.goto(`/app?team=${teamId}&month=2020-01`)

  const boundary = page.getByText('Ruh roh, something went wrong!')
  const boards = page.getByRole('group', { name: 'Team boards' })

  // THE CORRECTION RAN AND NOTHING THREW, AS ONE ASSERTION — see `settlesOn`.
  // Element 0 of any window is the current month, so that is where
  // `correctedMonth` sends a reader; requiring it also rules out the one way the
  // guard could be wrong without throwing, which is sitting on a skeleton for
  // ever.
  await expect
    .poll(settlesOn(page, boundary), { timeout: 20_000 })
    .toBe(thisMonth())

  // AND THE DASHBOARD IS REALLY THERE, not merely un-thrown: the panel lives
  // inside a Suspense boundary that suspends on `api.scores.getTeamMonth`, so it
  // cannot paint until that query has actually answered for the corrected month.
  await expect(boards).toBeVisible({ timeout: 20_000 })
})

test('switching to a younger team leaves the out-of-window month behind rather than throwing', async ({
  page,
}) => {
  // THE REPORTED PATH. TeamPicker's `onChange` navigates with `{ team, month:
  // monthParam }` — it keeps the month deliberately, so a reader comparing two
  // teams stays on the month they were looking at — and the new team's window has
  // not loaded on the render that follows.
  const viewer = address('month-switch')
  const oldTimer = address('month-switch-old')
  const client = convex()

  // THE YOUNG TEAM: the viewer alone, and nobody on it has ever entered a board,
  // so `earliestMonth` is null and its window is the free three months.
  await client.mutation(api.e2eSeed.ensureTeamFor, { email: viewer })

  // THE OLD TEAM: the viewer plus one other player, named so the picker can tell
  // the two apart — `ensureSharedTeamFor`'s own `name` comment says that is the
  // only thing the menu distinguishes them by.
  const oldTeamId = await client.mutation(api.e2eSeed.ensureSharedTeamFor, {
    emailA: viewer,
    emailB: oldTimer,
    name: 'Old Guard',
  })

  // THE HISTORY BELONGS TO THE OTHER PLAYER, AND THAT IS THE WHOLE FIXTURE.
  // `earliestMonthFor` walks the team's ROSTER, and `seedTeamDayFor` rolls its
  // board up for every team that player is on — so a board entered by the VIEWER
  // would widen both teams' windows and there would be no younger team left to
  // switch to. oldTimer is on the shared team only.
  const oldMonth = addMonths(thisMonth(), -8)
  await client.mutation(api.e2eSeed.seedTeamDayFor, {
    email: oldTimer,
    puzzleDay: `${oldMonth}-15`,
    attempts: 4,
  })

  // PRO, OR THERE IS NOTHING TO REPRODUCE. `spanFor` floors a free window at
  // FREE_MONTHS whatever the team's history, so a free viewer's dropdown could
  // never offer a month eight months back and `getTeamMonthFor`'s free floor
  // would refuse it for the old team too.
  //
  // THROUGH seedInsightsFor BECAUSE IT IS THE ONLY SEED THAT WRITES A MEMBERSHIP
  // ROW, and `boards: 0` is what makes it write nothing else: no boards (which
  // would widen the young team's window and defeat the fixture above) and, with
  // `trialEndsAt` omitted, no trial. billing.spec.ts's header calls the absence
  // of a comp-pro seed a blocker; it is this, used with everything else turned
  // off.
  await client.mutation(api.e2eSeed.seedInsightsFor, {
    email: viewer,
    boards: 0,
    lastDay: toPuzzleDay(new Date()),
    pro: true,
  })

  await signIn(page, viewer)

  const boundary = page.getByText('Ruh roh, something went wrong!')
  const boards = page.getByRole('group', { name: 'Team boards' })

  // ON THE OLD TEAM, ON THE OLD MONTH. This load is itself a check that the guard
  // does not over-reach: the month IS inside this team's Pro window, so the page
  // has to arrive on it rather than being corrected away from it.
  await page.goto(`/app?team=${oldTeamId}&month=${oldMonth}`)
  //
  // THE PANEL PAINTING IS THE PROOF, for the reason above: it suspends on
  // `getTeamMonth`, so it cannot appear unless the server served this month for
  // this team. A guard that over-reached would leave the skeleton here instead,
  // and one that let the month be corrected away would fail the URL check.
  await expect(boards).toBeVisible({ timeout: 20_000 })
  await expect(boundary, "the Pro window did not cover its own team's oldest month").toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`month=${oldMonth}`))

  // THE SWITCH. `Team: <full name>` is the trigger's accessible name and the rows
  // are radio items named by the team — team-insights.spec.ts drives the sibling
  // control the same way.
  await page.getByRole('button', { name: 'Team: Old Guard' }).click()
  await page.getByRole('menuitemradio', { name: 'E2E Team' }).click()

  // THE ASSERTION THE ISSUE ASKED FOR. Before the guard the six queries went out
  // with the NEW team and the OLD month on the very next render and all six took
  // a MONTH_OUT_OF_WINDOW; `settlesOn` reports that as 'DashboardError' rather
  // than as a URL that never changed. MEASURED AGAINST THE BROKEN CODE: this is
  // the assertion that fails, and the two obvious spellings it replaces both
  // passed there.
  await expect
    .poll(settlesOn(page, boundary), { timeout: 20_000 })
    .toBe(thisMonth())

  // AND THE READER LANDS ON THE YOUNGER TEAM'S DASHBOARD rather than on a
  // permanent skeleton.
  await expect(page.getByRole('button', { name: 'Team: E2E Team' })).toBeVisible({ timeout: 20_000 })
  await expect(boards).toBeVisible({ timeout: 20_000 })
})
