import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { authClient } from '#/lib/auth-client'
import { SIGNIN_PARAM, trackFunnel } from '#/lib/funnel.ts'
import { lastLoginMethod, rememberLoginAttempt } from '#/lib/last-login.ts'
import { publicRouteHead } from '#/lib/seo'
import { useHydrated } from '#/lib/use-hydrated'
import { LastUsedBadge } from '#/components/last-used-badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card.tsx'
import { Input } from '#/components/ui/input.tsx'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '#/components/ui/input-otp.tsx'
import { Label } from '#/components/ui/label.tsx'

export const Route = createFileRoute('/login')({
  // v1: src/app/login/layout.tsx metadata.title
  head: () => publicRouteHead('/login', 'Login / Signup'),
  beforeLoad: ({ context }) => {
    if (context.isAuthenticated) throw redirect({ to: '/app' })
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
 *
 * NOTE FOR THE RESTYLE (wt-ksh.12.7): the OTP field is the one controlled input
 * on this page, because shadcn's InputOTP owns its value. That is safe and does
 * not reintroduce wt-ksh.2.2 — the code step only ever mounts after an explicit
 * click, so it never exists pre-hydration and has nothing to lose.
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
 *
 * A7 / wordle-teams-390: these carry VISIBLE TEXT LABELS. v1 renders a 3x2 grid
 * of icon-only buttons whose labels exist only as sr-only text plus a hover
 * Tooltip — and tooltips do not appear on tap, while the heaviest login traffic
 * is iPhone. Do not reduce these to icons. components/last-used-badge.tsx
 * defers to this paragraph for the same reason, and is held to it by a test.
 */
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'github', label: 'GitHub' },
  { id: 'discord', label: 'Discord' },
] as const

/**
 * The method id the email one-time-code path records (wordle-teams-ilej).
 *
 * NOT 'otp', which is already taken: `?signin=otp` is a FUNNEL value, charted by
 * `login_callback_arrived` as one of oauth|otp, and the two vocabularies must
 * not be confused for each other. `wt.login.pending` is the granular one — it
 * holds a provider id where the funnel only ever says "oauth" — so sharing a
 * spelling would invite someone to pass one where the other is meant.
 */
const EMAIL_METHOD = 'email'

function LoginPage() {
  const hydrated = useHydrated()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Top of the funnel. Fires once per mount, after hydration, so it counts real
  // browsers rather than SSR renders or crawlers that never execute JS.
  useEffect(() => {
    trackFunnel({ name: 'login_view' })
  }, [])

  /**
   * The method this device last COMPLETED a sign-in with (wordle-teams-ilej).
   *
   * GATED ON `hydrated`, WHICH IS NOT COSMETIC: localStorage does not exist on
   * the server, so a badge rendered in the SSR pass is a hydration mismatch on
   * every returning player. Undefined until the flag flips means the server and
   * the first client render agree on "no badge", and the marker appears in the
   * same commit that enables the buttons.
   *
   * `useMemo` over the flag rather than a plain call, so the store is read once
   * on arrival instead of on every keystroke in the OTP field. Nothing can
   * change the answer while this page is open — the only writer is a promotion
   * on /app, which is a fresh document.
   */
  const lastUsed = useMemo(() => (hydrated ? lastLoginMethod() : undefined), [hydrated])

  async function signInWith(provider: (typeof SOCIAL_PROVIDERS)[number]['id']) {
    // Emitted BEFORE the redirect: once the provider takes over the document,
    // nothing here runs again. This is the event that separates "never chose a
    // provider" from "chose one and did not come back".
    trackFunnel({ name: 'login_provider_click', provider })
    // AND FOR THE SAME REASON, one line later (wordle-teams-ilej). This records
    // an ATTEMPT, not a success: it is promoted to the badge only if the round
    // trip lands back on /app authenticated, so a user who declines consent —
    // and therefore never gets there — leaves the badge on whatever last
    // actually worked.
    rememberLoginAttempt(provider)
    setPending(true)
    setError(null)
    // No full-page reload afterwards, unlike the OTP path: this hands off to the
    // provider and comes back through /api/auth/callback/<provider>, which lands
    // as a fresh document load anyway.
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: `/app?${SIGNIN_PARAM}=oauth`,
      // THE FAILURE HALF OF THE SAME HANDOFF (wordle-teams-vjh). Better Auth
      // stores this in the OAuth state and redirects here — with the provider's
      // own code on the query string — when the provider comes back with an
      // error instead of a code. Without it the flow falls back to Better
      // Auth's built-in /api/auth/error page, which in production 302s onward
      // to `/` and shows nothing: a user who declined consent landed silently
      // on the marketing page. src/routes/login-error.tsx carries the full
      // reasoning and the allowlist of codes it will show a sentence for.
      errorCallbackURL: '/login-error',
    })
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
    trackFunnel({ name: 'login_code_requested' })
    setEmail(entered)
    setStep('code')
  }

  async function verifyCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const otp = code.trim()
    if (!otp) return

    setPending(true)
    setError(null)
    const { error } = await authClient.signIn.emailOtp({ email, otp })
    setPending(false)
    if (error) return setError(error.message ?? 'Invalid code')
    // Written BEFORE the navigation, like the provider path's, and for a
    // slightly different reason: the reload below is what discards this
    // component, so anything after it is code nobody should have to reason
    // about. The code has already verified here, so the attempt this records is
    // one that will be promoted on the very next page.
    rememberLoginAttempt(EMAIL_METHOD)
    // full reload — required with expectAuth
    window.location.href = `/app?${SIGNIN_PARAM}=otp`
  }

  return (
    <main className="page-wrap flex justify-center px-4 py-10 sm:py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl" asChild>
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>
            {step === 'email'
              ? 'We will email you a one-time code. No password needed.'
              : `We emailed a code to ${email}.`}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {step === 'email' ? (
            <form onSubmit={sendCode} className="flex flex-col gap-3">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
              {/* On "Send code" rather than beside the Email label: the badge
                  exists to answer "which control do I press", and this is the
                  control. It is also the slow path — a trip to a mail app and
                  back — so it is the one most worth steering a returning player
                  off when a provider is theirs. */}
              <Button type="submit" disabled={!hydrated || pending}>
                {pending ? 'Sending…' : 'Send code'}
                {lastUsed === EMAIL_METHOD && <LastUsedBadge />}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="flex flex-col gap-3">
              <Label htmlFor="code">Code</Label>
              <InputOTP
                id="code"
                name="code"
                maxLength={6}
                value={code}
                onChange={setCode}
                containerClassName="justify-start"
                // Autofocused because the user has just switched to their mail
                // app and back; landing with the caret already in the field
                // saves a tap. Safe here: it only mounts after an explicit
                // action, never on load.
                autoFocus
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <Button type="submit" disabled={!hydrated || pending}>
                {pending ? 'Verifying…' : 'Verify'}
              </Button>
            </form>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {/* Disabled until hydrated for the same reason as the OTP buttons
              above (wt-ksh.2.2): before React attaches, a click is a native GET
              that navigates nowhere useful. */}
          <section aria-labelledby="social-heading" className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <h2 id="social-heading" className="text-xs font-medium text-muted-foreground">
                Or continue with
              </h2>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid gap-2">
              {SOCIAL_PROVIDERS.map(({ id, label }) => (
                <Button
                  key={id}
                  type="button"
                  variant="outline"
                  onClick={() => void signInWith(id)}
                  disabled={!hydrated || pending}
                >
                  {label}
                  {lastUsed === id && <LastUsedBadge />}
                </Button>
              ))}
            </div>
          </section>
        </CardContent>
      </Card>
    </main>
  )
}
