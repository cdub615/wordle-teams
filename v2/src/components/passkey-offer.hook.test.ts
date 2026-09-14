// @vitest-environment jsdom
//
// jsdom rather than the suite's default edge-runtime (vitest.config.ts),
// because this renders the real component through @testing-library/react.
// `.hook.test.ts` matches the house convention (security-tab, notifications-tab,
// profile-tab) — and `.test.ts` rather than `.test.tsx` because
// vitest.config.ts's glob is `src/**/*.test.ts`, so every element goes through
// `createElement` by hand.
//
// WHAT THIS FILE IS REALLY FOR. The WebAuthn ceremony in the middle of this
// dialog cannot run in any test runner, and `registerPasskey` — everything
// immediately around it — has its own suite in lib/register-passkey.test.ts. So
// it is MOCKED here, and what is left is the part only this component decides:
// which of the four outcomes closes the dialog, which one leaves it open, and
// above all WHICH WAYS OUT COUNT AS A DECLINE. That last one is the whole
// once-per-device guarantee: a dismissal that writes no marker is an offer that
// comes back at every single sign-in, forever, which is the nagging loop
// lib/passkey.ts's header sets out to rule out.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { PasskeyOffer } from './passkey-offer.tsx'
import { ALREADY_REGISTERED_MESSAGE } from '#/lib/register-passkey.ts'

const { registerPasskeyMock, rememberDeclinedMock, toastSuccess, toastError, toastInfo } = vi.hoisted(
  () => ({
    registerPasskeyMock: vi.fn(),
    rememberDeclinedMock: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    toastInfo: vi.fn(),
  }),
)

// PARTIAL, so ALREADY_REGISTERED_MESSAGE above is the REAL constant. Asserting
// against a mocked copy of the string the component renders would prove only
// that this file can repeat itself.
vi.mock('#/lib/register-passkey.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/lib/register-passkey.ts')>()),
  registerPasskey: registerPasskeyMock,
}))

// PARTIAL for the same reason, and narrower: only the decline write is replaced,
// so it can be observed. Nothing else in that module is this component's.
vi.mock('#/lib/passkey.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/lib/passkey.ts')>()),
  rememberPasskeyDeclined: rememberDeclinedMock,
}))

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo },
}))

// TYPED AS THE PROP, not as `ReturnType<typeof vi.fn>`: the untyped mock's
// signature is `Procedure | Constructable`, which does not satisfy `() => void`
// and fails typecheck at the `createElement` below. `expect` takes `any`, so
// nothing is lost on the assertion side.
let onClose: () => void

const mount = (open = true) => render(createElement(PasskeyOffer, { open, onClose }))

/** The offer's two controls, by their accessible names. */
const acceptButton = () => screen.getByRole('button', { name: /Set up a passkey/i })
const declineButton = () => screen.getByRole('button', { name: /Not now/i })

beforeEach(() => {
  vi.clearAllMocks()
  onClose = vi.fn()
  registerPasskeyMock.mockResolvedValue({ outcome: 'registered' })
})

afterEach(cleanup)

describe('what the offer shows', () => {
  test('a closed offer renders nothing at all', () => {
    /**
     * A CLOSED RADIX DIALOG IS NOT A DOM NODE, and that is what makes this
     * component safe to mount unconditionally on every branch of /app. The
     * assertion is on the DIALOG rather than on the copy: text can be absent
     * because the component rendered an empty shell, which is a different and
     * much less interesting fact.
     */
    mount(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('an open offer names the thing it is offering, with both ways out', () => {
    mount()
    // STRUCTURAL FIRST. Without this, each `getByRole('button')` below could be
    // matching inside a tree that rendered no dialog at all — the vacuity trap
    // this repo has been bitten by four times.
    const dialog = screen.getByRole('dialog')
    expect(dialog).not.toBeNull()
    // THE HEADING LEADS WITH THE BENEFIT, NOT THE WORD "passkey", which is
    // jargon to most of this app's players. Asserted as the real string rather
    // than a loose /passkey/i, because a heading matching that pattern is
    // exactly the copy this one was written to avoid.
    expect(screen.getByRole('heading', { name: 'Sign in faster next time' })).not.toBeNull()
    expect(acceptButton()).not.toBeNull()
    expect(declineButton()).not.toBeNull()
    // AND IT NAMES BOTH THINGS THAT STILL WORK. The hard constraint on this
    // whole feature is that nothing was taken away, and this sentence is the
    // only place a player is told so.
    expect(dialog.textContent).toMatch(/email code and social sign-ins keep working/i)
    // It has not decided anything on the player's behalf just by appearing.
    expect(rememberDeclinedMock).not.toHaveBeenCalled()
    expect(registerPasskeyMock).not.toHaveBeenCalled()
  })
})

describe('declining', () => {
  test('"Not now" records the decline AND closes', async () => {
    /**
     * THE MUTATION THIS KILLS: closing without writing. The offer then reappears
     * at every sign-in on this device with no way for the player to stop it.
     * BOTH halves are asserted because either alone passes over the other's
     * absence — a write with no close leaves a dialog nobody can dismiss.
     */
    mount()
    fireEvent.click(declineButton())
    await waitFor(() => expect(rememberDeclinedMock).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
    // AND IT DOES NOT START A CEREMONY. "Not now" wired to the wrong handler is
    // a system sheet in the face of someone who just said no.
    expect(registerPasskeyMock).not.toHaveBeenCalled()
  })

  test('ESCAPE counts as declining too, not as "ask me again next time"', async () => {
    /**
     * THE MUTATION THIS KILLS, and it is the likely shape of the bug: writing
     * the marker in the "Not now" handler ONLY. Radix closes on Escape, on an
     * overlay click and on the X in the corner, and every one of those routes
     * past a handler attached to the button — so a player who presses Escape is
     * offered a passkey again after every sign-in for the rest of time.
     *
     * DRIVEN THROUGH THE REAL KEY EVENT rather than by calling the prop, so it
     * is Radix's own dismissal path being measured and not this file's idea of
     * one.
     */
    mount()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(rememberDeclinedMock).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('accepting', () => {
  test('a registered passkey closes the offer, and is NOT recorded as a decline', async () => {
    /**
     * THE SECOND HALF IS THE POINT. `declined` and `registered` are not
     * interchangeable — lib/passkey.ts's header says so at length — and the
     * lazy way to close this dialog is to route every exit through the decline
     * handler. That records a player who ADDED a passkey as having refused one,
     * which is a lie the /login button (Task 4) has no way to see past.
     */
    mount()
    fireEvent.click(acceptButton())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(registerPasskeyMock).toHaveBeenCalledTimes(1)
    expect(rememberDeclinedMock).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalled()
  })

  test('a cancelled system sheet leaves the offer standing, and says nothing', async () => {
    /**
     * THE MUTATION THIS KILLS: treating 'aborted' like a decline, or like a
     * failure. Dismissing the OS sheet is not dismissing the offer — the dialog
     * that asked is still on screen and the player may well press it again — and
     * an error toast there scolds someone for using the cancel button the
     * browser itself drew.
     */
    registerPasskeyMock.mockResolvedValue({ outcome: 'aborted' })
    mount()
    fireEvent.click(acceptButton())
    await waitFor(() => expect(registerPasskeyMock).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(rememberDeclinedMock).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  test('a failed registration is reported and the offer stays put', async () => {
    // Closing on a failure throws away the only control that can retry it, and
    // — if the close were routed through the decline handler — would record the
    // failure as a refusal.
    registerPasskeyMock.mockResolvedValue({ outcome: 'failed', message: 'Failed to verify' })
    mount()
    fireEvent.click(acceptButton())
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to verify'))
    expect(onClose).not.toHaveBeenCalled()
    expect(rememberDeclinedMock).not.toHaveBeenCalled()
  })

  test('an authenticator that ALREADY holds one closes the offer and says so', async () => {
    /**
     * `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` reaches here as its own
     * outcome, with `registerPasskey` having already written the registered
     * marker (its own suite pins that). What is left for this component is that
     * it stops asking — the premise of the offer has just been disproved — and
     * that it does not report it as a failure, because there is nothing wrong
     * and nothing to do.
     */
    registerPasskeyMock.mockResolvedValue({ outcome: 'already-registered' })
    mount()
    fireEvent.click(acceptButton())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(toastInfo).toHaveBeenCalledWith(ALREADY_REGISTERED_MESSAGE)
    expect(toastError).not.toHaveBeenCalled()
    expect(rememberDeclinedMock).not.toHaveBeenCalled()
  })

  test('both buttons are dead while the system sheet is open', async () => {
    /**
     * THE MUTATION THIS KILLS: leaving the controls live during the ceremony. A
     * WebAuthn prompt is a MODAL system sheet that can sit open for as long as
     * the player takes to find a finger, and nothing in any cache knows it is
     * up — so a second press starts a second ceremony behind the first.
     *
     * "NOT NOW" IS DISABLED TOO, which the Settings tab has no equivalent of:
     * pressing it mid-ceremony would write the declined marker for a
     * registration that is about to succeed, and then the success would write
     * the registered one. Both markers set is not a state this app has any
     * reason to produce.
     *
     * A DEFERRED PROMISE, not a resolved one: the in-flight window is the only
     * thing under test, and a mock that has settled by the time the click
     * returns has no in-flight window at all.
     */
    let release: (value: unknown) => void = () => {}
    registerPasskeyMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    mount()
    const accept = acceptButton() as HTMLButtonElement
    const decline = declineButton() as HTMLButtonElement
    expect(accept.disabled).toBe(false)
    expect(decline.disabled).toBe(false)
    fireEvent.click(accept)
    await waitFor(() => expect(accept.disabled).toBe(true))
    expect(decline.disabled).toBe(true)
    // AND THEY COME BACK. A `finally` that never runs leaves an offer that can
    // be accepted exactly once and then neither completed nor dismissed.
    release({ outcome: 'aborted' })
    await waitFor(() => expect(accept.disabled).toBe(false))
    expect(decline.disabled).toBe(false)
  })

  test('ESCAPE mid-ceremony records nothing, because a button cannot be disabled', async () => {
    /**
     * THE HOLE `disabled` DOES NOT COVER. Radix routes Escape, an overlay click
     * and the X through `onOpenChange` without consulting either button — so a
     * decline written straight out of that callback lands for a registration
     * that is still in flight and about to succeed and write its OWN marker.
     * Both markers set for one sign-in is a state lib/passkey.ts is explicit
     * should not exist, and nothing downstream would ever report it: the offer
     * is correctly suppressed either way, so the only symptom is a device
     * recorded as having refused a passkey it owns.
     *
     * ASSERTED AS "STILL OPEN" TOO, because the dialog has no business
     * disappearing while the operating system has a prompt up that the page
     * cannot cancel.
     */
    let release: (value: unknown) => void = () => {}
    registerPasskeyMock.mockReturnValue(new Promise((resolve) => (release = resolve)))
    mount()
    fireEvent.click(acceptButton())
    await waitFor(() => expect((acceptButton() as HTMLButtonElement).disabled).toBe(true))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(rememberDeclinedMock).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeNull()

    // AND THE OFFER IS STILL USABLE AFTERWARDS. A guard that latched would
    // leave a dialog nothing can dismiss.
    release({ outcome: 'aborted' })
    await waitFor(() => expect((declineButton() as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(declineButton())
    expect(rememberDeclinedMock).toHaveBeenCalledTimes(1)
  })
})
