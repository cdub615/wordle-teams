import { authClient } from '#/lib/auth-client.ts'
import { forgetPasskeyRegistered } from '#/lib/passkey.ts'

/**
 * ONE WEBAUTHN *AUTHENTICATION*, CLASSIFIED, WITH THE PER-DEVICE MARKER
 * CORRECTED WHERE — AND ONLY WHERE — THE FAILURE IS PROOF IT WAS WRONG
 * (wordle-teams-wty4.1.7.4).
 *
 * THE SIBLING OF lib/register-passkey.ts, and every trap that module's header
 * lists applies here — one of them in a WEAKER form that is worth stating
 * exactly. `signIn.passkey` DOES NOT REJECT FOR THE CEREMONY OR FOR
 * VERIFICATION: both sit inside catches that RETURN the failure (measured in
 * `@better-auth/passkey/dist/client.mjs`), so a bare `await` in a `try` reads
 * them as successes. IT CAN STILL REJECT ON THE OPTIONS FETCH, which sits
 * outside any try — and `@better-fetch/fetch` awaits `fetch()` bare, so a
 * network failure there rejects whatever `throw: false` says. Both halves are
 * handled below, and both are tested; the `try` around the call is load-bearing
 * rather than defensive.
 *
 * AND THE ERROR IS A UNION ONE OF WHOSE ARMS HAS NO `code` — the one returned
 * untouched when `/passkey/generate-authenticate-options` answers with an
 * error rather than failing outright. `'code' in …` is what makes reading it
 * legal, and typecheck is the only thing that catches the other spelling.
 *
 * IT IS A MODULE RATHER THAN A HANDLER IN routes/login.tsx FOR THE ONE REASON
 * THAT MATTERS ON THIS PROJECT: a route module cannot be imported under vitest,
 * so anything living there is pinned by reading its source text. The decision
 * below — which failure clears `wt.passkey.registered` — is the whole of
 * wordle-teams-wty4.1.7.8's residual case, and it is worth executing rather
 * than describing. lib/signin-passkey.test.ts drives all nine endings.
 *
 * ------------------------------------------------------------------------
 * THE DECISION: EXACTLY ONE FAILURE CLEARS THE MARKER.
 *
 * `PASSKEY_NOT_FOUND` DOES. It is the SERVER's answer, not the browser's: the
 * ceremony succeeded, this device produced an assertion, and
 * `/passkey/verify-authentication` looked the credentialID up across the
 * passkey table and found no row (`APIError.from("UNAUTHORIZED",
 * PASSKEY_ERROR_CODES.PASSKEY_NOT_FOUND)`). So this device holds a credential
 * the account does not — which is precisely what the marker denies, arriving as
 * a rejection.
 *
 * THAT IS THE RESIDUAL CASE wordle-teams-wty4.1.7.8 LEFT OPEN, and the only
 * moment it is answerable. Register on a phone, remove that credential from a
 * laptop: the account still has other passkeys, so the Settings tab's "a
 * removal emptied the account" clear never fires, and nothing on the phone can
 * know — no field on a passkey row says which authenticator it belongs to. The
 * phone learns it the first time it tries, from the server, unambiguously. It
 * does not depend on credentialID being unique (wordle-teams-047w records that
 * it is not enforced): "no row matched" is "no row matched" however many rows
 * could have.
 *
 * THE CEREMONY'S OWN FAILURE DOES NOT, AND MUST NOT. WebAuthn raises
 * `NotAllowedError` both when the player dismisses the system sheet and when
 * the authenticator holds no matching credential — the spec conflates them
 * deliberately, so a page cannot probe a device for which credentials it has —
 * and `identifyAuthenticationError` passes it straight through as
 * `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY`. There is no information there to act
 * on. Clearing would take /login's button away from everyone who taps it and
 * changes their mind, on a device holding a perfectly good credential, and the
 * only way back is a Settings tab they have not signed in to reach. Pressing
 * Cancel must cost nothing.
 *
 * WHAT THAT LEAVES UNFIXABLE, STATED RATHER THAN HIDDEN: a device whose
 * AUTHENTICATOR no longer holds the credential — deleted from the OS password
 * manager while site data survived — still shows a button, and tapping it opens
 * the platform's own "no passkeys found" sheet. That is not a gap in this
 * module; it is the privacy property above, and no code running in the page can
 * see past it. The sheet explains itself and every other sign-in method is
 * still on the form.
 * ------------------------------------------------------------------------
 */
export type PasskeySignIn =
  | { outcome: 'signed-in' }
  | { outcome: 'cancelled' }
  | { outcome: 'no-credential'; message: string }
  | { outcome: 'failed'; message: string }

/**
 * THE SIGNPOST, AND THE REASON `no-credential` IS AN OUTCOME OF ITS OWN RATHER
 * THAN A FAILURE WITH A NICER SENTENCE.
 *
 * The server says "Passkey not found", which names the dead end and not the way
 * out of it. The way out is two steps and both of them are on the page the
 * player is already looking at: every other method still works, and Settings is
 * where a new passkey is added once they are in. MODULE-PRIVATE, reaching
 * /login as `result.message`, for the reason register-passkey.ts gives about
 * its own: what diverges between callers is severity, not the sentence.
 */
const NO_CREDENTIAL_MESSAGE =
  'This device’s passkey is no longer on your account. Sign in another way below, then add a new passkey from Settings.'

/**
 * The generic failure, for an error that arrived with nothing usable of its
 * own. EXPORTED ONLY FOR THE TEST'S VACUITY GUARD — /login reads
 * `result.message`.
 */
export const SIGN_IN_FAILED_MESSAGE = 'Could not sign in with a passkey.'

/**
 * The TWO codes that mean "the ceremony ended without an assertion, and that is
 * not news". `AUTH_CANCELLED` IS NOT ONE OF THEM, despite its name, and the
 * name is the whole trap.
 *
 * `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY` is the ambiguous one argued in the
 * header, and IT is what a real cancel produces. Traced end to end:
 * `startAuthentication` catches `navigator.credentials.get()` and rethrows
 * `identifyAuthenticationError(...)`, which turns a `NotAllowedError` — the one
 * the platform raises both for "the player dismissed the sheet" and for "no
 * credential matched" — into a `WebAuthnError` carrying this code. The plugin
 * then reads `err instanceof WebAuthnError ? err.code : 'AUTH_CANCELLED'`
 * (`@better-auth/passkey/dist/client.mjs`), so the instanceof arm is the one
 * that fires and the code is this one.
 *
 * `ERROR_CEREMONY_ABORTED` is the abort signal — a second ceremony starting
 * cancels the first — which is a race rather than a fault.
 *
 * SO `AUTH_CANCELLED` IS REACHED ONLY WHEN WHAT WAS THROWN IS NOT A
 * `WebAuthnError` AT ALL, and every way to get there is a real failure:
 * `identifyAuthenticationError` returns the raw DOMException untouched for
 * every name it does not recognise (`InvalidStateError`, `NotSupportedError`,
 * `NotReadableError`, `ConstraintError`, `TypeError`, and a `SecurityError` on
 * a valid domain whose rpId matches), `startAuthentication` throws a plain
 * `Error` for an unsupported browser and for a credential that came back empty,
 * and malformed options fail base64url parsing before the ceremony starts.
 *
 * AND THERE IS A SECOND SOURCE OF THIS CODE, WHICH IS THE STRONGEST REASON OF
 * ALL AND THE ONE A READER WILL MISS. `client.mjs` has a SECOND catch — around
 * `/passkey/verify-authentication` — that returns a BYTE-IDENTICAL
 * `{ code: 'AUTH_CANCELLED', message: 'Auth cancelled', status: 400,
 * statusText: 'BAD_REQUEST' }`. The two sources cannot be told apart from out
 * here. And `@better-fetch/fetch` awaits `fetch()` bare, with no try/catch, so
 * a network-level failure rejects whatever `throw: false` says — which is
 * precisely what that catch is there to absorb.
 *
 * So the common way to reach `AUTH_CANCELLED` is A CONNECTION DROPPING AFTER
 * THE CEREMONY SUCCEEDED: the player presented a face or a finger, the
 * assertion exists, and the verification round trip never landed. Classifying
 * that as "the player said no" means /login returns silently and the page does
 * nothing at all in response to a successful Face ID — on mobile, which is
 * where both the passkeys and the flaky networks are. That is far likelier than
 * any non-`WebAuthnError` throw out of `startAuthentication`, so 'failed' is the
 * better default on frequency as well as on principle. Do not stop reading at
 * the first catch.
 *
 * Reporting that set as "the player said no" is the mistake this module's own
 * codeless-arm test argues against in the next breath: /login answers
 * 'cancelled' with a bare `return`, so a tap would do nothing, show nothing and
 * log nothing. lib/register-passkey.ts already takes the other line on the same
 * class of throw — its non-`WebAuthnError` fallback is `UNKNOWN_ERROR`, which it
 * reports as a failure.
 */
const CANCELLED_CODES = new Set(['ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', 'ERROR_CEREMONY_ABORTED'])

/**
 * Whether the plugin OVERWROTE this error's message with its canned sentence,
 * so that what it carries says nothing about what went wrong.
 *
 * BOTH SHAPES, AND `AUTH_CANCELLED` IS WHY THIS IS NOT AN `ERROR_` PREFIX TEST.
 * The ceremony catch sets `message: PASSKEY_ERROR_CODES.AUTH_CANCELLED.message`
 * — the literal "Auth cancelled" — beside whatever code it produced, and that
 * code is `err.code` (always `ERROR_`-prefixed) OR the bare string
 * 'AUTH_CANCELLED'. The verify catch produces the same pair. A prefix test
 * alone would let the bare one through and tell someone whose browser cannot do
 * WebAuthn at all that they cancelled something.
 */
const messageIsCanned = (code: string) => code.startsWith('ERROR_') || code === 'AUTH_CANCELLED'

/**
 * Run the ceremony and report what happened. Never rejects, never throws.
 *
 * ON SUCCESS IT SAYS NOTHING ABOUT NAVIGATION. The session cookie is set by
 * `/passkey/verify-authentication`, and what /login does next — record the
 * attempt, then hard-navigate so the Convex client re-reads auth — is the
 * route's business, exactly as `registerPasskey` leaves the toasting to its two
 * callers.
 */
export async function signInWithPasskey(): Promise<PasskeySignIn> {
  try {
    const result = await authClient.signIn.passkey()
    if (result?.error) {
      const code = 'code' in result.error ? result.error.code : undefined
      if (code === 'PASSKEY_NOT_FOUND') {
        // THE ONE CLEAR. See the header; this is not a tidy-up, it is the fix
        // for wordle-teams-wty4.1.7.8's residual case, and the button that
        // brought the player here disappears with it.
        forgetPasskeyRegistered()
        return { outcome: 'no-credential', message: NO_CREDENTIAL_MESSAGE }
      }
      if (code !== undefined && CANCELLED_CODES.has(code)) return { outcome: 'cancelled' }
      // THE MESSAGE IS A LIE AND IS DISCARDED, BUT THE FAILURE IS REPORTED.
      // Everything reaching here failed for a reason the player cannot see and
      // the plugin will not name — a misconfigured rpID, an authenticator that
      // would not read, a browser that cannot do WebAuthn, a verification round
      // trip that threw — and all of them arrive wearing "Auth cancelled".
      // Passing that through would tell someone they cancelled something they
      // never saw; saying nothing at all would leave a button that does nothing
      // when pressed.
      if (code !== undefined && messageIsCanned(code))
        return { outcome: 'failed', message: SIGN_IN_FAILED_MESSAGE }
      // Everything else is our server's, or the options request's, and those
      // messages say something true.
      return { outcome: 'failed', message: result.error.message || SIGN_IN_FAILED_MESSAGE }
    }
    return { outcome: 'signed-in' }
  } catch (cause) {
    // REACHED BY THE OPTIONS FETCH, which is the one `$fetch` in `signIn.passkey`
    // that sits outside a catch of its own (see the header). Not dead code.
    return {
      outcome: 'failed',
      // `&& cause.message`, NOT A BARE `instanceof`: `new Error('')` is an
      // Error whose message is the empty string, and /login would render an
      // empty `role="alert"` — a wall with nothing written on it.
      message: cause instanceof Error && cause.message ? cause.message : SIGN_IN_FAILED_MESSAGE,
    }
  }
}
