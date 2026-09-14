// The suite's default edge-runtime is right here: this module is the
// classification AROUND the ceremony and touches no DOM and no storage of its
// own — `rememberPasskeyRegistered` is the boundary, and it is mocked so the
// per-device write can be OBSERVED rather than inferred from a fake Storage.
// lib/passkey.test.ts is what proves that function actually writes; this file
// proves it is called on exactly the two outcomes that are evidence of a
// credential, and on neither of the other two.
//
// WHY THIS HAS A SUITE OF ITS OWN. Both callers used to be one caller, and its
// tests reached the classification through a rendered Settings tab. That is
// still true (security-tab.hook.test.ts) and still worth keeping, but the
// classification is now shared by two components and a mistake in it is a
// mistake in both. It is cheaper and more honest to state the contract once,
// here, against the four outcomes.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { REGISTRATION_FAILED_MESSAGE, registerPasskey } from './register-passkey.ts'

const { addPasskeyMock, rememberRegisteredMock } = vi.hoisted(() => ({
  addPasskeyMock: vi.fn(),
  rememberRegisteredMock: vi.fn(),
}))

vi.mock('#/lib/auth-client.ts', () => ({
  authClient: { passkey: { addPasskey: addPasskeyMock } },
}))

vi.mock('#/lib/passkey.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/lib/passkey.ts')>()),
  rememberPasskeyRegistered: rememberRegisteredMock,
}))

beforeEach(() => {
  vi.clearAllMocks()
  addPasskeyMock.mockResolvedValue({ data: { id: 'pk_new' }, error: null })
})

describe('registerPasskey', () => {
  test('a successful ceremony marks THIS DEVICE', async () => {
    await expect(registerPasskey()).resolves.toEqual({ outcome: 'registered' })
    expect(rememberRegisteredMock).toHaveBeenCalledTimes(1)
  })

  test('a returned error is a failure, and the device is NOT marked', async () => {
    /**
     * THE MUTATION THIS KILLS, and the worst one available in this module:
     * writing the marker without consulting `result.error`. `addPasskey` never
     * rejects — every failure arrives as a resolved `{ data: null, error }` —
     * so a bare `await` inside a `try` reads all of them as successes, and the
     * device is then recorded as holding a passkey it does not hold. That
     * suppresses the post-sign-in offer on exactly that device, permanently,
     * with no symptom at all.
     */
    addPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'FAILED_TO_VERIFY_REGISTRATION', message: 'Failed to verify registration' },
    })
    await expect(registerPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: 'Failed to verify registration',
    })
    expect(rememberRegisteredMock).not.toHaveBeenCalled()
  })

  test('an error with NO code is still read, and still a failure', async () => {
    /**
     * THE SHAPE `'code' in …` EXISTS FOR. The declared error is a union: the
     * arm returned when the ceremony fails carries a `code`, the arm returned
     * when the initial options request fails carries only a status and an
     * optional message. Reading `.code` off this one is what typecheck refuses,
     * and folding this arm into the aborted branch would silently swallow a
     * server-side failure as "the player said no".
     */
    addPasskeyMock.mockResolvedValue({
      data: null,
      error: { message: 'Internal Server Error', status: 500, statusText: 'Internal Server Error' },
    })
    await expect(registerPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: 'Internal Server Error',
    })
    expect(rememberRegisteredMock).not.toHaveBeenCalled()
  })

  test('an error with no message of its own still gets one', async () => {
    // `message` is optional on the codeless arm of the union, and `undefined`
    // handed to a toast is an empty toast.
    addPasskeyMock.mockResolvedValue({ data: null, error: { status: 500, statusText: 'nope' } })
    await expect(registerPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: REGISTRATION_FAILED_MESSAGE,
    })
  })

  /**
   * THE MUTATION THESE KILL: narrowing the aborted branch back to
   * `ERROR_CEREMONY_ABORTED` alone, which is what this module shipped until
   * wordle-teams-wty4.1.7.11 and is why a plain cancel was toasted as an error.
   * Dismissing the system sheet is how a player says "not now"; reporting it as
   * a failure scolds them for pressing the cancel button the browser itself
   * drew. It is a distinct outcome rather than a silent success because the two
   * callers do different things with it.
   *
   * THE FIRST ROW IS THE ONE A REAL CANCEL PRODUCES, and it is the row this
   * suite did not have. `NotAllowedError` is passed through unclassified by
   * `identifyRegistrationError` — see the module — so the code is the
   * passthrough one and the message is whatever the platform wrote. The literal
   * below is Chrome's, copied from the spec text that helper declines to
   * replace; the point of carrying it is that a module which reported this as
   * 'failed' would put THAT SENTENCE in a toast.
   *
   * The second row is the abort signal (a second ceremony cancelling the
   * first). It is the code every cancel test in the tree used to feed, and
   * alone it was a green light on data the platform never makes — the same
   * class of vacuity as asserting a passkey `name` the app cannot produce.
   *
   * `toEqual` RATHER THAN A CHECK ON `.outcome`: it is exact, so it also proves
   * no message rides along. An 'aborted' carrying the platform's jargon would
   * satisfy a looser assertion and still be the bug.
   */
  test.each([
    [
      'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
      'The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.',
    ],
    ['ERROR_CEREMONY_ABORTED', 'Registration cancelled'],
  ])('a ceremony ending with no credential is aborted, not failed (%s)', async (code, message) => {
    addPasskeyMock.mockResolvedValue({ data: null, error: { code, message } })
    await expect(registerPasskey()).resolves.toEqual({ outcome: 'aborted' })
    expect(rememberRegisteredMock).not.toHaveBeenCalled()
  })

  test('a PREVIOUSLY REGISTERED rejection marks the device, because it is proof', async () => {
    /**
     * THE MIRROR IMAGE OF THE FAILURE TEST ABOVE.
     * `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` is the authenticator refusing
     * BECAUSE IT ALREADY HOLDS a credential for this relying party — the exact
     * fact the marker records, arriving as a rejection. Treating it as a plain
     * failure leaves a device whose site data was cleared (new browser profile,
     * cleared storage) nagging to register at every sign-in, forever, with no
     * way for the player to stop it.
     */
    addPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', message: 'Previously registered' },
    })
    const result = await registerPasskey()
    expect(result.outcome).toBe('already-registered')
    expect(rememberRegisteredMock).toHaveBeenCalledTimes(1)

    // AND IT DOES NOT PASS THE PLUGIN'S OWN MESSAGE THROUGH. "Previously
    // registered" is what `addPasskey` hands back, and it tells a player
    // nothing they can act on — replacing it is the entire reason this outcome
    // carries a message at all rather than the callers each writing one.
    expect(result).toEqual({ outcome: 'already-registered', message: expect.any(String) })
    expect(result.outcome === 'already-registered' && result.message).not.toBe(
      'Previously registered',
    )
  })

  test('an Error with an EMPTY message still gets a sentence', async () => {
    /**
     * THE HOLE `instanceof` LEAVES. `new Error('')` is an Error, so an
     * `instanceof`-only check hands `''` to the caller and the caller hands it
     * to a toast — an empty toast, which is exactly what the
     * `|| REGISTRATION_FAILED_MESSAGE` on the returned-error path exists to
     * prevent. The two paths had different answers to the same question.
     */
    addPasskeyMock.mockRejectedValue(new Error(''))
    await expect(registerPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: REGISTRATION_FAILED_MESSAGE,
    })
    expect(rememberRegisteredMock).not.toHaveBeenCalled()
  })

  test('a rejection from the layer underneath is reported, not thrown', async () => {
    // `addPasskey` itself does not reject; the fetch under it can.
    addPasskeyMock.mockRejectedValue(new Error('offline'))
    await expect(registerPasskey()).resolves.toEqual({ outcome: 'failed', message: 'offline' })
    expect(rememberRegisteredMock).not.toHaveBeenCalled()
  })

  test('a non-Error rejection still produces a sentence', async () => {
    addPasskeyMock.mockRejectedValue('something')
    await expect(registerPasskey()).resolves.toEqual({
      outcome: 'failed',
      message: REGISTRATION_FAILED_MESSAGE,
    })
  })

  test('the two sentences it can produce are distinct, and neither is empty', async () => {
    /**
     * THE VACUITY GUARD FOR EVERY MESSAGE ASSERTION ABOVE, and it is written
     * against what the module PRODUCES rather than against exported constants.
     * That is the stronger form: `ALREADY_REGISTERED_MESSAGE` is module-private
     * now precisely because both callers read `result.message`, so a constant
     * that had drifted to `''` — or collapsed into the other one, reporting a
     * hard failure as "nothing to do" — is only observable out here through the
     * outcomes themselves.
     */
    addPasskeyMock.mockResolvedValue({
      data: null,
      error: { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', message: 'Previously registered' },
    })
    const already = await registerPasskey()
    addPasskeyMock.mockResolvedValue({ data: null, error: { status: 500, statusText: 'nope' } })
    const failed = await registerPasskey()

    const alreadyMessage = already.outcome === 'already-registered' ? already.message : ''
    const failedMessage = failed.outcome === 'failed' ? failed.message : ''
    expect(alreadyMessage.length).toBeGreaterThan(0)
    expect(failedMessage.length).toBeGreaterThan(0)
    expect(alreadyMessage).not.toBe(failedMessage)
  })
})
