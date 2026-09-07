import { expect, test } from '@playwright/test'
import { signIn } from './sign-in'
import { completeProfile } from './complete-profile'

/**
 * FOLLOWING A SHARED INVITE LINK, IN A REAL BROWSER — the three arrival states
 * of `/join/$token`, none of which has coverage at any other layer.
 *
 * WHY THIS EXISTS RATHER THAN A UNIT TEST. Everything this file asserts is a
 * property of a DOCUMENT LOAD, and the two defects it was written against were
 * both invisible to lint, typecheck, `vitest run` and build:
 *
 *   1. The route stashed its token in `beforeLoad`, guarded on
 *      `typeof window !== 'undefined'`. On a fresh document load — which is
 *      what a link in a chat message is — TanStack Start turns a beforeLoad
 *      redirect into a 307 with `content-length: 0`, so no document is
 *      delivered and no client code runs. The stash executed on nobody.
 *   2. Once fixed, the signed-in path consumed the token TWICE. Dashboard
 *      remounts, React re-runs effects on a remount whatever the deps say, and
 *      `navigate()` is asynchronous — so the router still held `?join=` and
 *      handed it over again. Two toasts, and two mutations.
 *
 * Neither is reachable from `vitest run`: a route module registers against a
 * router that does not exist there, `Dashboard` is not exported, and the suite
 * runs on edge-runtime with no DOM at all. src/routes.test.ts pins the SHAPE
 * that ships and says so; this drives the thing.
 *
 * PLAYWRIGHT IS NOT A CI GATE (wt-ksh.8.49) — .github/workflows/deploy-v2.yml
 * runs lint, typecheck, `vitest run` and build. So this is a thing somebody
 * runs, not a thing that guards a deploy, and the unit-testable half of this
 * feature deliberately lives in src/lib/pending-invite.test.ts instead.
 *
 * THE TOKEN HERE IS SYNTHETIC, AND THAT BOUNDS WHAT THE TOASTS PROVE. Minting
 * a real one needs `inviteLinks.createLink` on the deployment under test, and
 * a local backend that predates it answers "Could not find public function".
 * So the toast assertions prove the mutation was REACHED with the token and
 * answered — the wiring — not that a valid token joins a team. That half is
 * covered by convex/inviteLinks.test.ts, and the copy matches either refusal.
 */

const PENDING_KEY = 'wt.pendingInviteToken'
const TOKEN = 'deadbeefcafe0123deadbeefcafe0123'

test('an authenticated account with NO player row keeps the token through /complete-profile', async ({
  page,
}) => {
  // Signs in and stops at /complete-profile: authenticated, no players row.
  await signIn(page)
  await expect(page).toHaveURL('/complete-profile')

  // Follow an invite link from exactly that state.
  const response = await page.goto(`/join/${TOKEN}`)
  expect(response?.status()).toBe(200)
  // /join -> /app?join= -> (no player row) -> /complete-profile, and that last
  // redirect drops the search param.
  await page.waitForURL((url) => url.pathname === '/complete-profile', { timeout: 20_000 })
  expect(new URL(page.url()).search).toBe('')

  // THE ASSERTION THE FIX IS ABOUT: the URL carrier is gone, and the stash is
  // the only one left.
  expect(await page.evaluate((k) => window.sessionStorage.getItem(k), PENDING_KEY)).toBe(TOKEN)

  await completeProfile(page, { lastName: 'Joiner' })
  await expect(page).toHaveURL(/\/app/)

  // The dashboard picked it up: storage cleared, and consumeLink was called
  // with it — this deployment answers that call with a failure, so the toast is
  // the refusal copy, but the call is what is being proved here.
  await expect(page.getByText(/invite link/i)).toBeVisible({ timeout: 15_000 })
  expect(await page.evaluate((k) => window.sessionStorage.getItem(k), PENDING_KEY)).toBeNull()
})

test('a signed-OUT holder keeps the token through /login', async ({ page }) => {
  const response = await page.goto(`/join/${TOKEN}`)
  // Renders rather than 307ing, which is what makes the stash reachable at all.
  expect(response?.status()).toBe(200)
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 20_000 })
  expect(await page.evaluate((k) => window.sessionStorage.getItem(k), PENDING_KEY)).toBe(TOKEN)
  expect(await page.evaluate((k) => window.localStorage.getItem(k), PENDING_KEY)).toBeNull()
})

test('and a signed-IN, profile-complete holder gets it in the URL as well', async ({ page }) => {
  await signIn(page)
  await completeProfile(page)
  await expect(page).toHaveURL(/\/app/)

  await page.goto(`/join/${TOKEN}`)
  // The toast FIRST, because sonner dismisses it on a timer and everything
  // below waits. Its presence is the proof consumeLink was reached with the
  // token; this deployment answers that call with a failure, which is what the
  // copy reflects.
  await expect(page.getByText(/invite link/i)).toBeVisible({ timeout: 15_000 })
  // Spent and stripped: no ?join= left on a URL anyone may share or refresh.
  // Waited for rather than sampled — the pathname matches the instant the
  // navigation lands, which is BEFORE the effect that strips the param runs.
  await page.waitForURL((url) => url.pathname === '/app' && !url.searchParams.has('join'), {
    timeout: 20_000,
  })
  expect(await page.evaluate((k) => window.sessionStorage.getItem(k), PENDING_KEY)).toBeNull()
})
