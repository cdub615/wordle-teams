// The mirror of lib/register-passkey.test.ts, for the other ceremony, and the
// default edge-runtime is right for the same reason: this module is the
// CLASSIFICATION around `signIn.passkey()` and touches no DOM and no storage of
// its own. `forgetPasskeyRegistered` is the boundary, and it is mocked so the
// per-device CLEAR can be OBSERVED rather than inferred from a fake Storage —
// lib/passkey.test.ts is what proves that function actually removes the key.
//
// WHAT THIS FILE IS REALLY ABOUT is one decision: WHICH failure is evidence
// that the per-device `registered` marker is wrong. Exactly one is
// (`PASSKEY_NOT_FOUND`, the server saying the credential this device just
// presented is on no account at all) and the rest are not — decisively so for
// the ceremony's own failure, which WebAuthn deliberately makes
// indistinguishable from the player pressing Cancel. Clearing there would take
// the /login button away from someone who merely changed their mind, and the
// only way back is Settings. See the module header.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SIGN_IN_FAILED_MESSAGE, signInWithPasskey } from './signin-passkey.ts'

const { signInPasskeyMock, forgetRegisteredMock } = vi.hoisted(() => ({
  signInPasskeyMock: vi.fn(),
  forgetRegisteredMock: vi.fn(),
}))

vi.mock('#/lib/auth-client.ts', () => ({
  authClient: { signIn: { passkey: signInPasskeyMock } },
}))

vi.mock('#/lib/passkey.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/lib/passkey.ts')>()),
  forgetPasskeyRegistered: forgetRegisteredMock,
}))

beforeEach(() => {
  vi.clearAllMocks()
  signInPasskeyMock.mockResolvedValue({ data: { session: {}, user: {} }, error: null })
})

describe('signInWithPasskey', () => {
  test('a verified assertion is a sign-in, and clears nothing', async () => {
    await expect(signInWithPasskey()).resolves.toEqual({ outcome: 'signed-in' })
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('PASSKEY_NOT_FOUND clears the marker, because it is proof the marker lied', async () => {
    /**
     * THE RESIDUAL CASE OF wordle-teams-wty4.1.7.8, AND THE ONLY PLACE IT IS
     * SOLVABLE. Register on a phone, remove that credential from a laptop: the
     * account still has other passkeys, so the Settings tab's "removal emptied
     * the account" clear never fires, and the phone goes on showing a sign-in
     * button. The phone's ceremony then SUCCEEDS — the credential is still in
     * its keychain — and the SERVER refuses, because
     * `/passkey/verify-authentication` looks the credentialID up across the
     * passkey table and finds nothing (`@better-auth/passkey/dist/index.mjs`,
     * `APIError.from("UNAUTHORIZED", PASSKEY_ERROR_CODES.PASSKEY_NOT_FOUND)`).
     *
     * That is unambiguous: this device holds a credential the account does not.
     * Nothing about it depends on credentialID being unique (wordle-teams-047w
     * says it is not enforced) — "no row matched" is "no row matched" however
     * many rows could have.
     */
    signInPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found', status: 401 },
    })
    const result = await signInWithPasskey()
    expect(result.outcome).toBe('no-credential')
    expect(forgetRegisteredMock).toHaveBeenCalledTimes(1)

    // AND IT DOES NOT PASS THE SERVER'S OWN SENTENCE THROUGH. "Passkey not
    // found" names the failure and not the way out of it; the whole point of
    // this outcome is that it is a SIGNPOST — sign in another way, then add one
    // in Settings — rather than a wall.
    expect(result).toEqual({ outcome: 'no-credential', message: expect.any(String) })
    expect(result.outcome === 'no-credential' && result.message).not.toBe('Passkey not found')
    expect(result.outcome === 'no-credential' && result.message).toMatch(/Settings/)
  })

  test('a ceremony that fails is CANCELLED, and clears nothing at all', async () => {
    /**
     * THE MUTATION THIS KILLS, AND IT IS THE WORST ONE AVAILABLE HERE: clearing
     * the marker on the ceremony's own failure.
     *
     * `navigator.credentials.get()` raises `NotAllowedError` BOTH when the
     * player dismisses the system sheet AND when the authenticator holds no
     * matching credential — the spec conflates them deliberately, so that a
     * page cannot probe for which credentials a device has.
     * `identifyAuthenticationError` passes it straight through as
     * `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY`, so the code carries no more
     * information than the DOMException did.
     *
     * Clearing here therefore takes /login's passkey button away from everyone
     * who taps it and changes their mind, on a device that holds a perfectly
     * good credential — and the only way back is the Settings tab they have not
     * signed in to reach yet. Pressing Cancel must cost nothing.
     */
    signInPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', message: 'Auth cancelled' },
    })
    await expect(signInWithPasskey()).resolves.toEqual({ outcome: 'cancelled' })
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('an aborted ceremony is a cancellation too, and the set is exactly those two', async () => {
    // ERROR_CEREMONY_ABORTED is the abort signal — a second ceremony starting
    // cancels the first, which is a race rather than a fault. It and the
    // passthrough above are the WHOLE cancelled set; the assertion that nothing
    // else joins them is the test below.
    signInPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'ERROR_CEREMONY_ABORTED', message: 'Auth cancelled' },
    })
    await expect(signInWithPasskey()).resolves.toEqual({ outcome: 'cancelled' })
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('AUTH_CANCELLED is a FAILURE despite its name, and this is not a quibble', async () => {
    /**
     * THE CODE'S NAME IS THE TRAP, AND IT COST A ROUND OF REVIEW TO SEE IT.
     * Traced end to end: a real cancel raises `NotAllowedError`,
     * `identifyAuthenticationError` turns it into a `WebAuthnError` carrying
     * `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY`, and the plugin's
     * `err instanceof WebAuthnError ? err.code : 'AUTH_CANCELLED'` therefore
     * takes the instanceof arm. A PLAYER PRESSING CANCEL NEVER PRODUCES THIS
     * CODE.
     *
     * What does produce it is every throw that is not a `WebAuthnError` —
     * `InvalidStateError`, `NotSupportedError`, `NotReadableError`, an
     * unsupported browser — AND, byte-identically, the plugin's second catch
     * around `/passkey/verify-authentication`. `@better-fetch/fetch` awaits
     * `fetch()` bare, so a dropped connection rejects whatever `throw: false`
     * says, and that catch absorbs it.
     *
     * SO THE COMMON CASE HERE IS A NETWORK DROP AFTER A SUCCESSFUL CEREMONY:
     * the player presented a face or a finger and the verification never
     * landed. /login answers 'cancelled' with a bare `return` — no message, no
     * log — so classifying it that way makes the page do NOTHING in response to
     * a successful Face ID, on mobile, which is where both the passkeys and the
     * flaky networks are.
     */
    signInPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'AUTH_CANCELLED', message: 'Auth cancelled', status: 400 },
    })
    const result = await signInWithPasskey()
    expect(result.outcome).toBe('failed')

    // AND IT DOES NOT WEAR THE CANNED SENTENCE EITHER. "Auth cancelled" is what
    // BOTH catches hard-code beside this code, so passing it through would tell
    // someone whose connection dropped that they cancelled something. That is
    // why `messageIsCanned` is not a bare `ERROR_` prefix test — this code has
    // no prefix and would slip past one.
    expect(result).toEqual({ outcome: 'failed', message: SIGN_IN_FAILED_MESSAGE })
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('any OTHER ceremony error is a failure, and never wears the plugin\'s sentence', async () => {
    /**
     * MEASURED IN `@better-auth/passkey/dist/client.mjs`: the catch around
     * `startAuthentication` returns `message: PASSKEY_ERROR_CODES.AUTH_CANCELLED
     * .message` — the literal string "Auth cancelled" — for EVERY ceremony
     * failure, whatever the code beside it says. So passing the message through
     * would tell a player whose rpID is misconfigured that they cancelled
     * something they never saw, which is the one mistake the design doc calls
     * unrecoverable for credentials already issued.
     */
    signInPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'ERROR_INVALID_RP_ID', message: 'Auth cancelled' },
    })
    await expect(signInWithPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: SIGN_IN_FAILED_MESSAGE,
    })
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('a SERVER refusal keeps its own message, and still clears nothing', async () => {
    // AUTHENTICATION_FAILED is the signature not verifying against a row that
    // DOES exist — so it is the opposite of PASSKEY_NOT_FOUND as evidence, and
    // folding the two together would clear the marker for a device that holds
    // exactly what it claims to.
    signInPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'AUTHENTICATION_FAILED', message: 'Authentication failed', status: 401 },
    })
    await expect(signInWithPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: 'Authentication failed',
    })
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('an error with NO code is still read, and still a failure', async () => {
    /**
     * THE SHAPE `'code' in …` EXISTS FOR, exactly as in register-passkey.ts.
     * `signIn.passkey` returns the options request's error UNTOUCHED when
     * `/passkey/generate-authenticate-options` fails, and that arm carries only
     * a status and an optional message. Reading `.code` off it is what
     * typecheck refuses — and folding it into the cancelled branch would
     * swallow a server outage as "the player said no", leaving a dead button
     * and no message at all.
     */
    signInPasskeyMock.mockResolvedValue({
      data: null,
      error: { message: 'Internal Server Error', status: 500, statusText: 'Internal Server Error' },
    })
    await expect(signInWithPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: 'Internal Server Error',
    })
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('an error with no message of its own still gets one', async () => {
    signInPasskeyMock.mockResolvedValue({ data: null, error: { status: 500, statusText: 'nope' } })
    await expect(signInWithPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: SIGN_IN_FAILED_MESSAGE,
    })
  })

  test('a rejection from the layer underneath is reported, not thrown', async () => {
    // `signIn.passkey` itself does not reject — every failure above arrives as
    // a resolved `{ data: null, error }` — but the fetch under it can.
    signInPasskeyMock.mockRejectedValue(new Error('offline'))
    await expect(signInWithPasskey()).resolves.toEqual({ outcome: 'failed', message: 'offline' })
    expect(forgetRegisteredMock).not.toHaveBeenCalled()
  })

  test('an Error with an EMPTY message still gets a sentence', async () => {
    // `new Error('')` is an Error, so an `instanceof`-only check hands `''` to
    // the caller and /login renders an empty `role="alert"` — a wall with
    // nothing written on it.
    signInPasskeyMock.mockRejectedValue(new Error(''))
    await expect(signInWithPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: SIGN_IN_FAILED_MESSAGE,
    })
  })

  test('a non-Error rejection still produces a sentence', async () => {
    signInPasskeyMock.mockRejectedValue('something')
    await expect(signInWithPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: SIGN_IN_FAILED_MESSAGE,
    })
  })

  test('the two sentences it can produce are distinct, and neither is empty', async () => {
    /**
     * THE VACUITY GUARD FOR EVERY MESSAGE ASSERTION ABOVE, written against what
     * the module PRODUCES rather than against exported constants — the same
     * stance register-passkey.test.ts takes. The signpost is module-private
     * because /login reads `result.message`, so a constant that had drifted to
     * `''`, or collapsed into the generic failure, is only observable out here
     * through the outcomes themselves.
     */
    signInPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' },
    })
    const missing = await signInWithPasskey()
    signInPasskeyMock.mockResolvedValue({ data: null, error: { status: 500, statusText: 'nope' } })
    const failed = await signInWithPasskey()

    const missingMessage = missing.outcome === 'no-credential' ? missing.message : ''
    const failedMessage = failed.outcome === 'failed' ? failed.message : ''
    expect(missingMessage.length).toBeGreaterThan(0)
    expect(failedMessage.length).toBeGreaterThan(0)
    expect(missingMessage).not.toBe(failedMessage)
  })
})
