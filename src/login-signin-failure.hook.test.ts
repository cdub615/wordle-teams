// @vitest-environment jsdom
//
// WHAT HAPPENS TO /login WHEN AN AUTH CALL REJECTS RATHER THAN ANSWERING
// (wordle-teams-fws8).
//
// jsdom rather than the suite's default edge-runtime (vitest.config.ts),
// because this renders the real page through @testing-library/react, and
// `.hook.test.ts` with elements built by `createElement` to match the siblings
// under src/components — vitest.config.ts's glob is `src/**/*.test.ts`, so
// there is no JSX to be had here.
//
// AT src/ ROOT RATHER THAN BESIDE THE ROUTE, like src/login-error.test.ts: a
// `.test.ts` inside src/routes/ is scanned by the router's generator as a
// route, which is why the only test that does live there is named
// `-funnel-methods.test.ts` with the leading dash that makes it ignore the file.
//
// WHY THIS IS A RENDERED PAGE AND NOT A PARSE OF ITS SOURCE, which is how
// src/routes.test.ts pins everything else about this file: the defect fws8
// records is not visible in any single line. `@better-fetch/fetch` awaits
// `fetch()` bare — better-auth builds its fetcher without `catchAllError`
// (dist/client/config.mjs), the one option that would wrap it — so a transport
// failure REJECTS `authClient.signIn.social()` instead of arriving as `{ error }`.
// The bare `await` then skipped `setPending(false)`, `pending` stayed true, and
// EVERY control on the page is gated on it: the four provider buttons, "Send
// code", "Verify", and the passkey button. One dropped connection left a player
// looking at seven dead controls and no sentence, recoverable only by a reload
// the page never suggests. An assertion that the source contains a `try` would
// have been satisfied by a `try` that swallows and still leaves the page dead.
//
// SO THE CLAIM IS "THE PAGE IS STILL USABLE AND SAYS WHY", driven by making the
// mocked client reject exactly as the browser did in Sentry.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { socialMock, sendOtpMock, verifyOtpMock, trackFunnelMock } = vi.hoisted(() => ({
  socialMock: vi.fn(),
  sendOtpMock: vi.fn(),
  verifyOtpMock: vi.fn(),
  trackFunnelMock: vi.fn(),
}))

// `createFileRoute` is the one thing that cannot run under vitest — it
// registers against a router that does not exist here — mocked exactly as
// src/login-error.test.ts and src/legal-prose.test.ts mock it.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: (options: unknown) => options,
}))

vi.mock('./lib/auth-client.ts', () => ({
  authClient: {
    signIn: { social: socialMock, emailOtp: verifyOtpMock },
    emailOtp: { sendVerificationOtp: sendOtpMock },
  },
}))

// Only `trackFunnel` is replaced; SIGNIN_PARAM stays real so nothing here
// re-states a constant the page reads.
vi.mock('./lib/funnel.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/funnel.ts')>()),
  trackFunnel: trackFunnelMock,
}))

import { LoginPage } from './routes/login'

/**
 * TWO BROWSER APIS `input-otp` USES AND jsdom DOES NOT SUPPLY. Both are
 * measurement, and nothing in this file depends on a measured anything, so
 * no-ops are honest rather than a stub that could hide a real failure.
 *
 * Without ResizeObserver the six-box code field throws on mount ("An error
 * occurred in the <Input> component") and the verification test below fails for
 * a reason that has nothing to do with what it asserts. `elementFromPoint` is
 * worse-behaved: input-otp calls it from a `setTimeout`, so it lands AFTER the
 * test that provoked it has passed, and vitest reports it as an unhandled error
 * that fails the run with every test green.
 */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
document.elementFromPoint ??= () => null

/** What the browser actually threw, per the Sentry event fws8 was filed from. */
const transportFailure = () => new TypeError('Failed to fetch')

const render_ = () => render(createElement(LoginPage))
const alertText = () => screen.getByRole('alert').textContent ?? ''
const button = (name: RegExp) => screen.getByRole('button', { name })
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled

// NO STORAGE IS INSTALLED, UNLIKE src/components/app-menu.hook.test.ts, and
// that is a decision rather than an omission: under jsdom here
// `window.localStorage` is a bare Object (measured and written up in that
// file), and every access in lib/last-login.ts already sits in a `try` for the
// real browsers that refuse it. So the reads no-op, `lastUsed` stays undefined,
// and no "Last used" badge is drawn — which this file asserts nothing about.
beforeEach(() => {
  socialMock.mockReset()
  sendOtpMock.mockReset()
  verifyOtpMock.mockReset()
  trackFunnelMock.mockReset()
})
afterEach(cleanup)

describe('a rejected provider sign-in', () => {
  test('leaves every control usable and says what happened', async () => {
    socialMock.mockRejectedValue(transportFailure())
    render_()

    const google = button(/Google/)
    fireEvent.click(google)

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
    expect(alertText()).toMatch(/could not sign in with google/i)

    // THE HALF THAT MATTERS MOST. A sentence with the form still frozen is the
    // same dead end with better manners: `pending` gates all of these.
    expect(isDisabled(google), 'the provider button is still disabled').toBe(false)
    expect(isDisabled(button(/Microsoft/)), 'the other providers are still disabled').toBe(false)
    expect(isDisabled(button(/Send code/)), 'the email form is still disabled').toBe(false)
  })

  test('still reports an error the server answered with, rather than swallowing it', async () => {
    // The existing path, which the fix must not eat: better-auth returns HTTP
    // failures as `{ error }` and only transport failures reject.
    socialMock.mockResolvedValue({ error: { message: 'Provider is misconfigured' } })
    render_()

    fireEvent.click(button(/Google/))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
    expect(alertText()).toBe('Provider is misconfigured')
    expect(isDisabled(button(/Google/))).toBe(false)
  })
})

describe('a rejected request for an email code', () => {
  test('leaves the form usable, says what happened, and stays on the email step', async () => {
    sendOtpMock.mockRejectedValue(transportFailure())
    render_()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'player@example.com' } })
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!)

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
    expect(alertText()).toMatch(/could not send/i)

    const send = button(/Send code/)
    expect(isDisabled(send), 'the send button is still disabled').toBe(false)
    // Not advanced to the code step: no code was ever sent, and a six-box OTP
    // field is a worse lie than the error sentence.
    expect(send.textContent).toContain('Send code')
    expect(screen.queryByLabelText('Code')).toBeNull()
  })
})

describe('a rejected verification of an email code', () => {
  test('leaves the code form usable and says what happened', async () => {
    sendOtpMock.mockResolvedValue({ error: null })
    verifyOtpMock.mockRejectedValue(transportFailure())
    render_()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'player@example.com' } })
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!)
    await waitFor(() => expect(screen.queryByLabelText('Code')).not.toBeNull())

    const otp = document.getElementById('code') as HTMLInputElement
    fireEvent.change(otp, { target: { value: '123456' } })
    fireEvent.submit(otp.closest('form')!)

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
    expect(alertText()).toMatch(/could not verify/i)
    expect(isDisabled(button(/Verify/)), 'the verify button is still disabled').toBe(false)
  })
})
