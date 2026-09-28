import { expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { PASSKEY_DECLINED_KEY } from '../src/lib/passkey.ts'
import type { Page } from '@playwright/test'

/**
 * @see signIn
 */
export type SignInOptions = {
  /**
   * Let the post-sign-in passkey offer appear. ONE SPEC PASSES THIS —
   * e2e/passkey.spec.ts — and it is the spec whose entire subject is the offer.
   * Everything else takes the default and never sees the dialog. See
   * `suppressPasskeyOffer` below for why the default is the way round it is.
   */
  offerPasskey?: boolean
}

/**
 * SEED THE APP'S OWN "already declined" MARKER SO THE PASSKEY OFFER NEVER OPENS
 * (wordle-teams-wty4.1.7.12).
 *
 * WHAT BREAKS WITHOUT THIS. src/components/passkey-offer.tsx is a MODAL Radix
 * dialog, opened by routes/app.tsx's arrival effect on a confirmed sign-in. A
 * modal's overlay covers the app bar, so `openAppMenu` — and every other
 * control on the page — becomes unclickable, and Playwright's actionTimeout is
 * 0, so the click RETRIES FOREVER and the spec burns its whole test timeout
 * reporting something else. Fifteen specs failed this way the first time the
 * suite was ever run against the passkey branch.
 *
 * THE SPLIT THAT IDENTIFIED IT, worth keeping because it is counter-intuitive:
 * specs that sign in against a SEEDED player row land on `/app?signin=otp`,
 * trip the arrival effect and fail, while specs that sign up FRESH are
 * redirected to /complete-profile, arrive at a plain `/app` with no `?signin=`
 * marker, and pass. onboarding.spec.ts:86 passed and :113 failed in the same
 * file for that reason alone.
 *
 * WHY A MARKER BEFORE NAVIGATION RATHER THAN A DISMISSAL AFTER THE FACT. The
 * obvious fix is to close the dialog if it turns up. That is a RACE in every
 * signing-in spec: the offer opens from an effect after hydration, so "is it
 * there yet" has no answer that is both fast and correct, and the version that
 * is correct adds a wait to all forty-odd sign-ins. Seeding runs before the
 * first byte of the document and cannot lose.
 *
 * WHY THE APP'S OWN KEY RATHER THAN A TEST-ONLY BRANCH. `wt.passkey.declined`
 * is the suppression mechanism the feature ALREADY SHIPS — it is what a real
 * player writes by pressing Escape — so this changes NO product behaviour and
 * adds no `import.meta.env.VITE_E2E` path to production code. Real players
 * still meet the real offer. The constant is imported rather than retyped
 * because src/lib/passkey.ts's header is explicit that a key spelled in two
 * modules fails silently when one of them drifts.
 *
 * ON THE CONTEXT, NOT THE PAGE, because localStorage is per-origin and a
 * context is the unit that models "a device" — which is exactly what both
 * passkey markers are scoped to. A spec that opens a second page in the same
 * context gets the same answer, as a second tab on a real device would.
 *
 * WRAPPED IN try/catch BECAUSE THE INIT SCRIPT ALSO RUNS ON `about:blank`,
 * whose opaque origin makes a bare `localStorage` access THROW rather than
 * answer. src/lib/passkey.ts wraps every one of its own accesses for the
 * neighbouring reason (Safari private mode), and its `shouldOfferPasskey`
 * treats a blocked store as "do not offer" — so even in the browser where this
 * throws, the offer stays shut.
 *
 * AND e2e/passkey.spec.ts DELIBERATELY OPTS OUT, with `{ offerPasskey: true }`.
 * That spec drives the whole passkey journey through a virtual authenticator
 * and its first assertion is that the offer appears; seeding the marker there
 * would leave it asserting on a dialog that this helper had quietly suppressed,
 * which is the exact shape of a test that passes for the wrong reason. If you
 * ever change the default here, that opt-out is the call site to check first.
 */
async function suppressPasskeyOffer(page: Page): Promise<void> {
  await page.context().addInitScript((key: string) => {
    try {
      window.localStorage.setItem(key, '1')
    } catch {
      // Opaque origin (about:blank) or a blocked store. Nothing to do: a store
      // that cannot be written cannot be read either, and shouldOfferPasskey()
      // answers false when its reads throw.
    }
  }, PASSKEY_DECLINED_KEY)
}

/**
 * Signs a page in through the emailed-OTP path.
 *
 * RETURNS ONLY ONCE THE SIGN-IN HAS LANDED — the post-verify document load has
 * finished and the page is off /login. It used to return on the click instead,
 * which is what made wordle-teams-1cd flake; see the wait at the bottom.
 *
 * Extracted from login.spec.ts (wt-ksh.3.11) so board-entry.spec.ts does not
 * carry a second, drifting copy of the same mechanics. Reads the code back
 * through testOtps.takeFor rather than an inbox — see that mutation's
 * comment for the E2E_TEST_MODE / e2e+* guards that make this safe.
 *
 * Returns the email used so a caller that needs data seeded for this exact
 * account (board-entry.spec.ts giving it a team) can do so before or after
 * calling this.
 *
 * THE DEFAULT ADDRESS CARRIES A RANDOM SUFFIX, not just a timestamp. Playwright
 * runs specs in parallel and playwright.config.ts pins no `workers`, so two
 * workers calling this in the same millisecond would otherwise share an
 * account — and since Phase 4 that account owns a `players` row, so the second
 * caller would find a profile already completed and land on the dashboard
 * instead of /complete-profile, for a reason nobody would guess from the
 * failure. Same shape the spec-local helpers in board-entry.spec.ts and
 * teams.spec.ts already use.
 *
 * IT ALSO SUPPRESSES THE POST-SIGN-IN PASSKEY OFFER, which is not a detail of
 * signing in but is unavoidably a consequence of it — see `suppressPasskeyOffer`
 * above for the whole argument, including why exactly one spec passes
 * `{ offerPasskey: true }` to switch it back on.
 */
export async function signIn(
  page: Page,
  email: string = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`,
  { offerPasskey = false }: SignInOptions = {},
): Promise<string> {
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)

  if (!offerPasskey) await suppressPasskeyOffer(page)

  await page.goto('/login')

  // No retry-until-hydrated loop any more, and its absence is the regression
  // test for wt-ksh.2.2. This used to need one: the SSR form rendered
  // interactive before hydration, so a click submitted natively and the
  // controlled input wiped what had been typed. The submit button is now
  // disabled until hydrated and the inputs are uncontrolled, so waiting for the
  // button to be enabled is sufficient — and if either regresses, this fails.
  await expect(page.getByRole('button', { name: /send code/i })).toBeEnabled()

  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: /send code/i }).click()
  await expect(page.getByLabel('Code')).toBeVisible({ timeout: 8000 })

  // takeFor is a mutation, not a query: it deletes the row as it returns it, so
  // a captured code cannot outlive this read (wt-ksh.1.14). Once it yields a
  // value the poll must stop asking, hence the ??= — a second call would return
  // null and fail the assertion.
  let otp: string | null = null
  await expect
    .poll(async () => (otp ??= await convex.mutation(api.testOtps.takeFor, { email })), {
      timeout: 15_000,
    })
    .not.toBeNull()

  await page.getByLabel('Code').fill(otp!)
  await page.getByRole('button', { name: /verify/i }).click()

  // THIS WAIT IS THE FIX FOR wordle-teams-1cd, AND IT IS NOT PADDING. Without
  // it this helper returned the instant the click was dispatched, so everything
  // the click sets in motion was billed to whatever the caller asserted next —
  // and that assertion carries Playwright's 5s default. login.tsx's verifyCode
  // finishes with `window.location.href = '/app?signin=otp'`, a FULL DOCUMENT
  // LOAD, so the caller's first assertion had to absorb: the Better Auth verify
  // round-trip, a fresh SSR of '/app' (its loader awaits players.needsProfile,
  // getMyTeams, amIPro, getMyPlayerId and onboarding.getStatus TOGETHER in one
  // Promise.all — five queries, one Convex round trip), several hundred module
  // requests from the dev server, and hydration.
  //
  // The measurement below PREDATES that shape and was taken when the three were
  // awaited one after another with needsProfile serial in front of them, so it
  // is a ceiling rather than a current reading. wordle-teams-dpi collapsed the
  // three and wordle-teams-16e3 removed the serial needsProfile (~110 ms on
  // beta). Not re-taken; the timeout it justifies only got safer.
  //
  // MEASURED, 54 sign-ins over three full-suite runs: 0.76s to 3.96s, median
  // ~2.2s. Against a 5s ceiling that also had to cover the assertion itself,
  // which is why the failure was intermittent and why it landed on whichever
  // spec happened to be signing in while the others were — never on a faulty
  // spec. The call log said it plainly every time: "waiting for
  // /app?signin=otp navigation to finish".
  //
  // NOT A CONVEX CONTENTION BUG, which was the other candidate. Six concurrent
  // sign-ins driven straight through /api/auth (no browser) took 1.2-1.5s each
  // against 0.58s for one alone — 2.2x wall-clock for 6x concurrency, so
  // nothing on the auth path serialises. The seconds are browser-side document
  // load, which is dev-server cost the product does not pay.
  //
  // 20s is ~5x the measured worst case and still inside Playwright's 30s
  // default test timeout, so a sign-in that genuinely never lands fails HERE,
  // naming the sign-in, instead of being reported as a missing team card.
  //
  // The predicate is "left /login" rather than the exact destination because
  // both are correct outcomes: an account with a players row lands on
  // '/app?signin=otp', one without is redirected to /complete-profile by
  // app.tsx's beforeLoad. Callers still assert the destination they expect — see
  // login.spec.ts's toHaveURL('/complete-profile') — so this weakens nothing.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })

  return email
}
