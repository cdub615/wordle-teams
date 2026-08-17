import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { authClient } from '#/lib/auth-client'
import { pageTitle } from '#/lib/seo'
import { useHydrated } from '#/lib/use-hydrated'

export const Route = createFileRoute('/login')({
  // v1: src/app/login/layout.tsx metadata.title
  head: () => ({ meta: [{ title: pageTitle('Login / Signup') }] }),
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

/**
 * The inputs here are UNCONTROLLED, and the submit buttons are disabled until
 * hydration. Both are deliberate, and together they fix wt-ksh.2.2.
 *
 * This form is server-rendered, so it exists and looks interactive before any
 * JavaScript has run. Previously that meant two failures on a slow connection:
 * a click submitted natively (a GET navigation carrying nothing, which reads as
 * "the button does nothing"), and because the inputs were controlled with a
 * value bound to empty state, hydration wiped whatever had been typed.
 *
 * Uncontrolled inputs keep what the user typed, because React does not own the
 * value. Disabling the submit button until hydrated removes the dead click, and
 * also blocks Enter-to-submit — the HTML spec skips implicit submission when the
 * form's default button is disabled.
 *
 * The e2e suite used to work around this with a retry-until-hydrated loop; that
 * workaround is gone, and its absence is now part of the regression test.
 */
/**
 * Provider id (Better Auth's, and the callback URL's last segment) to button
 * label. `microsoft` is Entra ID — v1 and Supabase called the same thing
 * 'azure', so the ids do not match across the two codebases.
 *
 * Rendered unconditionally rather than from server state: the credentials live
 * on the Convex deployment and the browser cannot see them, and a button that
 * errors is more useful than one that quietly never appears while a callback is
 * still misconfigured.
 */
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'github', label: 'GitHub' },
  { id: 'discord', label: 'Discord' },
] as const

function LoginPage() {
  const hydrated = useHydrated()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function signInWith(provider: (typeof SOCIAL_PROVIDERS)[number]['id']) {
    setPending(true)
    setError(null)
    // No full-page reload afterwards, unlike the OTP path: this hands off to the
    // provider and comes back through /api/auth/callback/<provider>, which lands
    // as a fresh document load anyway.
    const { error } = await authClient.signIn.social({ provider, callbackURL: '/' })
    // Only reached if the redirect never happened.
    setPending(false)
    if (error) setError(error.message ?? `Could not sign in with ${provider}`)
  }

  async function sendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Read from the DOM rather than state: the inputs are uncontrolled precisely
    // so that pre-hydration typing survives, which means the DOM is the source
    // of truth for what the user entered.
    const entered = String(new FormData(e.currentTarget).get('email') ?? '').trim()
    if (!entered) return

    setPending(true)
    setError(null)
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email: entered,
      type: 'sign-in',
    })
    setPending(false)
    if (error) return setError(error.message ?? 'Failed to send code')
    setEmail(entered)
    setStep('code')
  }

  async function verifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const otp = String(new FormData(e.currentTarget).get('code') ?? '').trim()
    if (!otp) return

    setPending(true)
    setError(null)
    const { error } = await authClient.signIn.emailOtp({ email, otp })
    setPending(false)
    if (error) return setError(error.message ?? 'Invalid code')
    window.location.href = '/' // full reload — required with expectAuth
  }

  return (
    <main style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 360 }}>
      <h1>Sign in</h1>
      {step === 'email' ? (
        <form onSubmit={sendCode}>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
          <button type="submit" disabled={!hydrated || pending}>
            {pending ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <p>We emailed a code to {email}.</p>
          <label htmlFor="code">Code</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            // Autofocused because the user has just switched to their mail app
            // and back; landing with the caret already in the field saves a tap.
            // Safe here: it only mounts after an explicit action, never on load.
            autoFocus
          />
          <button type="submit" disabled={!hydrated || pending}>
            {pending ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}

      {/* Disabled until hydrated for the same reason as the OTP buttons above
          (wt-ksh.2.2): before React attaches, a click is a native GET that
          navigates nowhere useful. */}
      <section aria-labelledby="social-heading" style={{ marginTop: 24 }}>
        <h2 id="social-heading" style={{ fontSize: '1rem' }}>
          Or continue with
        </h2>
        {SOCIAL_PROVIDERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => void signInWith(id)}
            disabled={!hydrated || pending}
            style={{ display: 'block', width: '100%', marginTop: 8, padding: 8 }}
          >
            {label}
          </button>
        ))}
      </section>
    </main>
  )
}
