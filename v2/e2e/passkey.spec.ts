import { expect, test } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { openAppMenu } from './app-menu.ts'
import { signIn } from './sign-in.ts'
import type { CDPSession, Page } from '@playwright/test'

/**
 * THE WHOLE PASSKEY JOURNEY, DRIVEN BY A VIRTUAL AUTHENTICATOR
 * (wordle-teams-wty4.1.7.5).
 *
 * Register from the post-sign-in offer, sign out, sign back in with the
 * credential, then remove it in Settings. Four features built in Tasks 1-4 and,
 * until this file, FOUR FEATURES NOTHING EXECUTED END TO END: every unit test in
 * src/lib/*passkey*.test.ts drives `authClient` against a stub, so not one of
 * them proves a real ceremony reaches a real relying party, or that the rpID
 * `convex/lib/relyingParty.ts` derives is one a browser will accept.
 *
 * WHY A VIRTUAL AUTHENTICATOR AND NOT A MOCK. The interesting failures in this
 * feature all live BELOW the auth client — a wrong rpID, an origin the plugin
 * refuses, a credential that registers and then is not offered back at sign-in —
 * and a stubbed `authClient` cannot see any of them. Chromium's
 * `WebAuthn` CDP domain plants a real software authenticator in the browser, so
 * `navigator.credentials.create()` and `.get()` run for real and the only thing
 * faked is the finger on the sensor.
 *
 * CHROMIUM ONLY, AND SKIPPED RATHER THAN FAILED ELSEWHERE. `newCDPSession`
 * throws outright on Firefox and WebKit. playwright.config.ts declares no
 * `projects` today, so everything runs on Chromium and the guard is dormant —
 * it exists so that adding a second browser later does not turn this spec red
 * for a reason that is about the harness rather than the product.
 */

/**
 * The relying-party id every credential here is scoped to.
 *
 * `localhost`, BECAUSE THAT IS WHAT THE BACKEND DERIVES. `rpIdFor` takes the
 * last two labels of SITE_URL's hostname, and a single-label host is its own
 * last-two — so `http://localhost:3000` yields `localhost`. It is written down
 * here rather than left implicit because it is the one value in this file that
 * a browser silently refuses: a mismatch does not surface as "wrong rpID", it
 * surfaces as a ceremony that never returns a credential.
 *
 * SET SITE_URL BEFORE RUNNING THIS, which .github/workflows/deploy-v2.yml does
 * (`convex env set SITE_URL http://localhost:3000`) and a workstation backend
 * needs too. Without it `createAuth` throws on the auth routes and the ceremony
 * fails at the options request, well before the authenticator is consulted.
 */
const RP_ID = 'localhost'

/**
 * Plant a software authenticator in this page's browser and hand back the
 * session driving it.
 *
 * `internal` + `hasResidentKey`, AND BOTH HALVES ARE LOAD-BEARING.
 * `authClient.signIn.passkey()` sends NO `allowCredentials` — it asks the
 * platform for whatever discoverable credential it holds for this relying party
 * — so an authenticator without resident-key support registers happily and then
 * offers nothing back at sign-in, which reads as "the passkey vanished" rather
 * than as a misconfigured fixture. `internal` is the platform-authenticator
 * transport, which is what `addPasskey` asks for by default.
 *
 * `hasUserVerification` + `isUserVerified` ARE ALSO A PAIR. The first says the
 * authenticator CAN verify a user; the second says the verification SUCCEEDS.
 * With only the first, `userVerification: 'preferred'` ceremonies come back
 * without the UV flag and the plugin's verification rejects them.
 *
 * `automaticPresenceSimulation` defaults to true and is passed explicitly: it
 * is the thing standing in for a fingerprint, and a future reader turning it
 * off would get a ceremony that hangs forever rather than fails — and
 * playwright.config.ts sets no `actionTimeout`, so a hang is a burnt test
 * timeout reporting whatever ran last (wordle-teams-zzo7).
 */
async function plantAuthenticator(
  page: Page,
): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { cdp, authenticatorId }
}

/**
 * Seeds a player row so the sign-in lands on `/app?signin=otp` DIRECTLY.
 *
 * THAT IS A REQUIREMENT OF THIS SPEC RATHER THAN A CONVENIENCE, and it is the
 * subtlest thing in the file. routes/app.tsx only offers a passkey from the
 * arrival effect, which is guarded on the `?signin=` marker. A bare `signIn()`
 * makes an account with no `players` row, so app.tsx redirects to
 * `/complete-profile`, and complete-profile.tsx then navigates to a plain
 * `/app` with no marker at all — the offer would never fire, and the failure
 * would look like a broken dialog rather than a route that was never asked.
 *
 * Same shape settings.spec.ts uses, for the same reason it gives.
 */
async function signInWithPlayer(page: Page): Promise<string> {
  const email = `e2e+${Date.now()}-${Math.floor(Math.random() * 1e6)}@wordleteams.com`
  const convex = new ConvexHttpClient(process.env.VITE_CONVEX_URL!)
  await convex.mutation(api.e2eSeed.ensureTeamFor, { email })
  /**
   * `offerPasskey: true` IS THE ONE OPT-OUT IN THE SUITE, AND WITHOUT IT THIS
   * SPEC WOULD PASS FOR THE WRONG REASON OR NOT AT ALL.
   *
   * sign-in.ts seeds `wt.passkey.declined` into the context before navigating,
   * because the offer is a modal whose overlay made fifteen other specs
   * unclickable (wordle-teams-wty4.1.7.12). That default is right everywhere
   * except here: this file's whole subject is the offer, and the first
   * assertion below is that it appears. Seeded, the dialog never opens and this
   * test fails at `expect(offer).toBeVisible()` — loudly, which is the point of
   * making the opt-out explicit rather than letting the helper guess.
   *
   * SO THE OFFER STAYS COVERED. Read this line as the reason the suppression in
   * sign-in.ts is safe: it is a test-harness default with exactly one
   * exception, not a hole in the feature's coverage.
   */
  await signIn(page, email, { offerPasskey: true })
  return email
}

test('a passkey is offered after signing in, then signs the player back in, then is removable', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'The WebAuthn CDP domain is Chromium-only.')

  /**
   * TWO FULL SIGN-INS, TWO FULL DOCUMENT LOADS AND TWO WEBAUTHN CEREMONIES in
   * one test, against a dev server. sign-in.ts alone measures 0.76-3.96s per
   * hop, and this test takes that hop twice on top of a settings dialog and a
   * Convex write. 90s is the same order as the multi-sign-in journeys in
   * invites.spec.ts and is a ceiling rather than a budget — nothing waits on it
   * when the run is healthy.
   */
  test.setTimeout(90_000)

  const { cdp, authenticatorId } = await plantAuthenticator(page)

  // ---------------------------------------------------------------------
  // 1. Sign in by OTP, and be offered a passkey.
  // ---------------------------------------------------------------------

  await signInWithPlayer(page)

  /**
   * THE OFFER APPEARS BECAUSE A PLAYWRIGHT CONTEXT IS A FRESH DEVICE. Neither
   * `wt.passkey.registered` nor `wt.passkey.declined` exists in a new context's
   * localStorage, and `PublicKeyCredential` IS defined on `http://localhost`
   * (a potentially-trustworthy origin is a secure context), so
   * `shouldOfferPasskey()` answers true — with or without the authenticator
   * planted above, which is a feature probe rather than a device inventory.
   *
   * BY TEST ID RATHER THAN BY TITLE, and passkey-offer.tsx's own comment says
   * this is the anchor's only consumer. The dialog's heading is marketing copy
   * ("Sign in faster next time") that will be reworded; what this spec cares
   * about is that the offer was made at all.
   */
  const offer = page.getByTestId('passkey-offer')
  await expect(offer).toBeVisible()

  /**
   * "Set up a passkey" IS THE OFFER'S LABEL AND IS DELIBERATELY NOT THE
   * SETTINGS TAB'S "Add a passkey" NOR /login's "Sign in with a passkey".
   * passkey-offer.tsx argues the distinction; scoping to `offer` anyway means
   * this assertion does not quietly start depending on that.
   */
  await offer.getByRole('button', { name: 'Set up a passkey' }).click()

  // The registration ceremony, the verify round trip and the toast. The
  // ceremony itself is instant against a virtual authenticator; what this waits
  // on is `/passkey/verify-registration`.
  await expect(page.getByText('Passkey added')).toBeVisible({ timeout: 15_000 })
  // A successful registration closes the dialog through `onClose()`, which
  // passkey-offer.tsx is explicit must NOT be routed through the decline path.
  // If that ever regresses into a dismissal the dialog still closes, so this
  // assertion does not catch it — the `declined` marker would be set too, and
  // nothing observable would change. Stated so nobody reads this line as
  // covering more than "the offer got out of the way".
  await expect(offer).toBeHidden()

  /**
   * THE ONE ASSERTION NOTHING ELSE IN THIS REPO CAN MAKE, and the reason this
   * spec holds the CDP session rather than discarding it after planting the
   * authenticator: the rpID is read back OUT OF THE AUTHENTICATOR, where the
   * browser baked it at registration.
   *
   * `convex/lib/relyingParty.ts`'s header is emphatic that an rpID is chosen
   * once, per credential, and can never be changed or repaired — a credential
   * scoped to the wrong id is simply orphaned, with nothing saying so until
   * someone tries to sign in. relyingParty.test.ts pins what `rpIdFor` RETURNS;
   * this pins what the BROWSER ACCEPTED from the running backend, which is the
   * half that a wrong SITE_URL, a stray hardcoded hostname or a plugin default
   * would break.
   *
   * `isResidentCredential` IS ASSERTED BESIDE IT because the sign-in below
   * depends on it: `signIn.passkey()` sends no `allowCredentials`, so a
   * non-discoverable credential is one the platform will never offer back.
   * Asserting it here means that failure is reported as "the credential is not
   * discoverable" rather than as a button that did nothing three steps later.
   */
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId })
  expect(credentials).toHaveLength(1)
  expect(credentials[0]?.rpId).toBe(RP_ID)
  expect(credentials[0]?.isResidentCredential).toBe(true)

  // ---------------------------------------------------------------------
  // 2. Sign out.
  // ---------------------------------------------------------------------

  await openAppMenu(page)
  // The menu is held open across the round trip on purpose (app-menu.tsx calls
  // `event.preventDefault()` in this item's `onSelect` so the spinner survives),
  // so the wait below is on the navigation rather than on the menu closing.
  await page.getByRole('menu').getByRole('menuitem', { name: 'Log out' }).click()
  // `/`, NOT `/login` — signing out lands on the marketing page, which
  // app-menu.tsx's signOut comment argues for at length.
  await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 })

  // ---------------------------------------------------------------------
  // 3. Sign back in with the passkey.
  // ---------------------------------------------------------------------

  await page.goto('/login')

  /**
   * THE BUTTON EXISTS ONLY BECAUSE THE REGISTRATION WROTE A PER-DEVICE MARKER,
   * AND THAT IS THE POINT OF ASSERTING IT HERE. `login.tsx` mounts it from an
   * effect gated on `passkeySupported() && passkeyRegisteredHere()`, so a
   * registration that forgot to call `rememberPasskeyRegistered()` leaves a
   * perfectly good credential with no way to use it — and every unit test still
   * passes, because they stub the storage module's caller rather than the
   * browser's. Signing out does not clear it: app-menu.tsx's signOut removes
   * only `selectedTeam`.
   *
   * A REGEX RATHER THAN AN EXACT NAME. The button's accessible name absorbs the
   * "Last used" badge when the previous sign-in was a passkey, so pinning the
   * exact string would pass on the first visit here and fail on any later one.
   */
  const passkeyButton = page.getByRole('button', { name: /sign in with a passkey/i })
  await expect(passkeyButton).toBeVisible()

  await passkeyButton.click()

  /**
   * `?signin=passkey` IS ASSERTED, NOT JUST "we are on /app". login.tsx
   * hard-navigates with that marker and routes/app.tsx's arrival effect returns
   * early for any value it does not recognise — so dropping it costs the funnel
   * event, the last-used promotion AND the passkey offer, silently, on a green
   * build (the comment at that guard says so). Waiting for the URL to CONTAIN
   * it catches the drop; the effect then strips it via replaceState, which is
   * why this is a `waitForURL` on arrival rather than a `toHaveURL` afterwards.
   */
  await page.waitForURL((url) => url.pathname === '/app' && url.search.includes('signin=passkey'), {
    timeout: 20_000,
  })

  /**
   * SIGNED IN, NOT MERELY NAVIGATED. `/app` is behind a `beforeLoad` redirect
   * to /login, so reaching it at all is the session check; the seeded row's
   * name is what proves the session belongs to the right account rather than to
   * a leftover one. Scoped to the menu for the ambiguity settings.spec.ts
   * documents — 'E2E Tester' also names this account on the Current Team card.
   */
  await openAppMenu(page)
  await expect(page.getByRole('menu').getByText('E2E Tester')).toBeVisible()

  // ---------------------------------------------------------------------
  // 4. Remove it in Settings.
  // ---------------------------------------------------------------------

  /**
   * VIA THE TAB STRIP, BECAUSE NO MENU ITEM OPENS Security DIRECTLY — AND NOW
   * NO MENU ITEM OPENS ANY TAB DIRECTLY (wordle-teams-mwu0). The menu used to
   * offer Profile, Install and Notifications as three deep links into this one
   * dialog; they are a single "Settings" item now, which opens on Profile
   * because settings-dialog.tsx makes that its own default. The tab click below
   * is therefore part of the journey rather than a shortcut around it, exactly
   * as it was before.
   */
  await page.getByRole('menu').getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.getByRole('tab', { name: 'Security' }).click()

  /**
   * ONE ROW, AND IT IS THE ACCOUNT'S LIST RATHER THAN THE DEVICE'S. The row is
   * named after the DEVICE now (wordle-teams-wty4.1.7.9) — lib/register-
   * passkey.ts sends `deviceName()` at registration — so its remove control is
   * announced as "Remove <browser> on <platform>, added <date>". Under
   * Playwright that is literally "Remove HeadlessChrome on Linux, added …",
   * measured; before the change it was the bare "Remove Passkey, added …" once
   * per credential, with nothing telling a screen-reader user which one they
   * were about to destroy.
   *
   * MATCHED ON THE SHAPE, NOT ON THE LITERAL, AND THE `on` IS THE ASSERTION.
   * Pinning "HeadlessChrome on Linux" would couple this spec to the runner's
   * browser build and OS, and pinning the date would couple it to a locale. The
   * " on " is what no fallback label can ever contain, so this fails on exactly
   * the regression worth catching — the argument going missing from that
   * `addPasskey` call — while surviving a CI image bump. The unit suite
   * (src/lib/device-name.test.ts) is where the exact strings live.
   */
  const remove = page.getByRole('button', { name: /^Remove \S.* on \S.*, added / })
  await expect(remove).toHaveCount(1)
  // AND THE GENERIC LABEL IS GONE FROM THE TAB — the VISIBLE half, which the
  // sr-only name above cannot speak to. `exact` keeps this off the "Passkeys"
  // heading and the "Add a passkey" button; scoping to the dialog keeps it off
  // the dashboard underneath.
  await expect(
    page.getByRole('dialog', { name: 'Settings' }).getByText('Passkey', { exact: true }),
  ).toHaveCount(0)
  await remove.click()

  await expect(page.getByText('Passkey removed')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('You have no passkeys on this account yet.')).toBeVisible()

  // ---------------------------------------------------------------------
  // 5. And the device forgot it too.
  // ---------------------------------------------------------------------

  /**
   * THE OTHER HALF OF THE REMOVAL, AND THE HALF NO UNIT TEST CAN REACH.
   * Emptying the account is the only thing the Settings list can prove about
   * THIS device, so security-tab.tsx clears `wt.passkey.registered` there — and
   * if it did not, /login would keep offering a button whose ceremony finds a
   * credential the server no longer has.
   *
   * THE ABSENCE IS ONLY MEANINGFUL AFTER HYDRATION, which is why the enabled
   * "Send code" button is waited on first. That button is disabled until
   * hydrated (sign-in.ts's comment explains why, and it is the regression test
   * for wt-ksh.2.2), whereas the passkey button is mounted BY an effect — so a
   * bare `toHaveCount(0)` here would pass on an un-hydrated page whatever the
   * marker said, and would go on passing if the clear were deleted.
   *
   * THE SIGN-OUT IS NOT DECORATION, AND SKIPPING IT IS HOW THIS STEP FAILED
   * FIRST TIME ROUND. `/login`'s `beforeLoad` redirects an authenticated
   * context straight to `/app`, so a `goto('/login')` on a live session never
   * renders the form at all — and the failure it produces is "Send code not
   * found", which reads as a broken login page rather than as a redirect.
   */
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
  await openAppMenu(page)
  await page.getByRole('menu').getByRole('menuitem', { name: 'Log out' }).click()
  await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 })

  await page.goto('/login')
  await expect(page.getByRole('button', { name: /send code/i })).toBeEnabled()
  await expect(page.getByRole('button', { name: /sign in with a passkey/i })).toHaveCount(0)
})
