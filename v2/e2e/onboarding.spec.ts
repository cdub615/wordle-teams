import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { signIn } from './sign-in'
import { completeProfile } from './complete-profile'
import { openAppMenu, closeAppMenu } from './app-menu'
import type { Page } from '@playwright/test'

/**
 * The onboarding card at the top of /app, walked end to end.
 *
 * WHY THIS FILE EXISTS AT ALL, given that lib/onboarding-tasks.test.ts pins the
 * predicates, next-step-card.hook.test.ts pins the component and
 * complete-profile.spec.ts already asserts the card on a fresh signup. None of
 * those cover the WIRING, and the wiring is where this feature has actually
 * broken. Seven mutants were planted against routes/app.tsx's two call sites
 * during the review of qt4.9 and FIVE survived `test`, `lint`, `typecheck` and
 * `build` — the entire dashboard-branch render of the card could be deleted and
 * every gate stayed green. The reason is narrow and worth stating: every
 * assertion that touched this feature ran on an account with NO TEAMS, so
 * app.tsx:395 (the no-team branch) and app.tsx:742 (the dashboard grid) were
 * indistinguishable to the suite. Three AST tripwires in
 * dashboard-skeletons.hook.test.ts now cover the shape of those call sites;
 * this file covers the half a tripwire cannot — that the card renders, that its
 * buttons do what they say, and that dismissal is where the code claims it is.
 *
 * THE TEAM-OF-ONE TEST IS THE ONE THAT WAS MISSING. It is the only assertion in
 * the repo that renders this card on the dashboard branch, and therefore the
 * only thing that would notice `onboardingCard('md:col-span-3')` disappearing
 * from app.tsx:742.
 *
 * PLAYWRIGHT RUNS IN NO CI WORKFLOW (`deploy-v2.yml` has lint, typecheck, unit
 * tests and build, and nothing else — `wordle-teams-z6v4`), so this suite is
 * only ever a thing somebody runs by hand. Written to be worth the run rather
 * than to pad a count.
 *
 * ABSENCE ASSERTIONS ARE ORDERED AFTER A PRESENCE ASSERTION, EVERY TIME, and
 * that is not stylistic. `toBeHidden()` passes on an element that does not
 * exist, so an unanchored "Invite someone is hidden" is equally green on a page
 * that never drew the card at all — which is not hypothetical, it is precisely
 * the mutant that deleted app.tsx:742 and survived every gate. Each one below is
 * preceded by an assertion that the card itself is on screen, so the absence
 * means "the card rendered and chose not to offer this" rather than "nothing
 * rendered".
 *
 * NOT because of a mid-load blank, which is the usual reason given and does not
 * apply here: /app is server-rendered, so the card's heading is in the initial
 * document and a bare `toBeHidden()` fails against it immediately. Measured
 * with a throwaway probe rather than assumed — see the note in the reload test.
 */

/**
 * A player who already owns a team, so the dashboard branch renders rather than
 * the no-team one. A four-line copy of the identically-named helpers in
 * board-entry.spec.ts:19 and teams.spec.ts:28 rather than an import: those two
 * are deliberately not shared (see teams.spec.ts's note — each spec owns its
 * seeding needs), and this file follows the house shape rather than inventing a
 * fourth arrangement.
 *
 * The team it seeds has ONE member and no pending invite, which is exactly the
 * state that makes `hasInvited` false and puts the invite task on screen. See
 * convex/e2eSeed.ts's ensureTeamFor for the E2E_TEST_MODE / e2e+* guards.
 *
 * A unique email per call, same as signIn()'s own default: playwright.config.ts
 * runs two workers, so a shared address would mean a shared player row.
 */
async function signInWithTeam(page: Page): Promise<string> {
  const email = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  await signIn(page, email)
  return email
}

/**
 * "Get started", not "One more thing", on every account this file seeds.
 *
 * cardHeading returns 'One more thing' only at EXACTLY ONE remaining task
 * (lib/onboarding-tasks.ts:102). Both accounts here owe two: a fresh signup
 * owes board + team, and a seeded team-of-one who has never played owes board +
 * invite. Asserted `exact` so a card that has silently dropped to one task
 * fails here rather than passing a loose regex.
 */
const CARD_HEADING = 'Get started'

test('a fresh signup owes board and team, and can play with no team at all', async ({ page }) => {
  await signIn(page)
  await completeProfile(page)

  await expect(page.getByRole('heading', { name: CARD_HEADING, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Enter today's board/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Create a team/ })).toBeVisible()
  // THE PREREQUISITE, AND A REGRESSION TEST FOR SOMETHING THAT SHIPPED. The
  // invite task was once gated on `!hasInvited` alone, so a brand-new signup
  // got a live "Invite someone" that navigated to /team with no team id —
  // which routes/team.tsx bounces straight back to /app, having already fired
  // an onboarding_task_click that could never convert. incompleteTasks now
  // carries `hasTeam &&`. Duplicated from complete-profile.spec.ts:56 on
  // purpose: that spec is about the profile guard and could reasonably lose
  // this line, and this feature's only browser-level net should not depend on
  // an assertion living in a file about something else.
  await expect(page.getByRole('button', { name: /Invite someone/ })).toBeHidden()

  // THE POINT OF THE WHOLE DESIGN: board entry works with NO TEAM. Boards are
  // player-owned (upsertBoard takes no teamId), and this is the branch where
  // that matters — app.tsx's boardSurface has its own Suspense boundary
  // precisely because nothing warms getMyMonth for a team-less player, so
  // without it this first tap would blank the page.
  await page.getByRole('button', { name: /Enter today's board/ }).click()
  await expect(page.getByRole('dialog', { name: 'Add or Update Board' })).toBeVisible()
})

test('a player with a team of one owes board and invite, not create', async ({ page }) => {
  await signInWithTeam(page)

  // THE DASHBOARD BRANCH (app.tsx:742), which nothing else in this repo
  // renders this card on. Note the skeleton return above it draws no card at
  // all, so this also proves useDashboardSearchSync filled the params in.
  await expect(page.getByRole('heading', { name: CARD_HEADING, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Enter today's board/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Invite someone/ })).toBeVisible()

  // THE MIRROR OF THE ABSENCE ABOVE. Offering "Create a team" to someone who
  // has one is not a dead end the way the invite was, but it is the other half
  // of the mutual exclusion `incompleteTasks` promises — 'team' needs hasTeam
  // false, 'invite' needs it true — and it is what keeps the card at two tasks
  // rather than three.
  await expect(page.getByRole('button', { name: /Create a team/ })).toBeHidden()
})

test('dismissing survives a reload, and the menu offers it back', async ({ page }) => {
  await signInWithTeam(page)

  const heading = page.getByRole('heading', { name: CARD_HEADING, exact: true })
  const replay = page.getByRole('menuitem', { name: 'Show getting started' })

  await expect(heading).toBeVisible()

  // THE NEGATIVE CONTROL FOR THE MENU ITEM, taken while the menu is provably
  // open (openAppMenu waits on "Home", which every state of the menu carries).
  // app-menu.tsx gates this item on `onboardingStatus?.dismissed` — a player
  // who has never dismissed anything has nothing to replay — so without this
  // the assertion at the bottom would pass just as well against an item that
  // is simply always there.
  await openAppMenu(page)
  await expect(replay).toBeHidden()
  await closeAppMenu(page)

  await page.getByRole('button', { name: 'Dismiss getting started' }).click()
  await expect(heading).toBeHidden()

  await page.reload()

  // THE RELOAD IS THE ASSERTION. The flag is `players.onboardingDismissedAt`, a
  // server-side stamp, precisely so it survives a reload and follows the player
  // to another device; a client-only dismissal would pass a no-reload test.
  //
  // THE BARE `toBeHidden()` AFTER A RELOAD IS NOT VACUOUS HERE, AND THAT WAS
  // MEASURED RATHER THAN ASSUMED — the usual objection to a hidden assertion is
  // that it also passes on a page that has not painted yet. It does not on this
  // one: /app is server-rendered, so the card's heading is in the initial
  // document, and a throwaway probe run against a NON-dismissed account
  // (dismiss nothing, reload, assert hidden) failed with "Received: visible".
  //
  // The positive assertion below is therefore belt-and-braces rather than the
  // load-bearing part, and it is kept for two things the absence cannot say.
  // First, the failure it produces names the flag ("Show getting started" is
  // missing) instead of the card, which is where a reader has to look. Second,
  // the replay item exists ONLY when onboarding.getStatus has come back AND
  // come back with `dismissed` set, so it distinguishes "the stamp survived"
  // from "the card happens not to be on screen" — which the paired negative
  // control above turns into a real two-sided check.
  await openAppMenu(page)
  await expect(replay).toBeVisible()
  await closeAppMenu(page)

  await expect(heading).toBeHidden()

  // And back again — onboarding.replay clears the stamp, and the card returns
  // to the same two tasks it started with, since dismissing completed nothing.
  await openAppMenu(page)
  await replay.click()
  await expect(heading).toBeVisible()
  await expect(page.getByRole('button', { name: /Invite someone/ })).toBeVisible()
})
