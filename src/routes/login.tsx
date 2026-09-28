import { createFileRoute, redirect } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { authClient } from '#/lib/auth-client'
import { SIGNIN_PARAM, trackFunnel } from '#/lib/funnel.ts'
import { lastLoginMethod, rememberLoginAttempt } from '#/lib/last-login.ts'
import { passkeyRegisteredHere, passkeySupported } from '#/lib/passkey.ts'
import { publicRouteHead } from '#/lib/seo'
import { signInWithPasskey } from '#/lib/signin-passkey.ts'
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

/**
 * The method id the passkey path records (wordle-teams-wty4.1.7.4).
 *
 * IT IS THE SAME WORD AS THE FUNNEL'S, AND THAT IS A COINCIDENCE RATHER THAN A
 * SHARED VALUE. `?signin=passkey` is a FUNNEL marker, charted by
 * `login_callback_arrived` beside oauth and otp; this is a method id sitting in
 * `wt.login.pending` beside google/microsoft/github/discord and 'email'. The
 * email path is the one where the two vocabularies visibly differ — 'email'
 * here, 'otp' on the URL — and the note on EMAIL_METHOD above explains why they
 * must not be conflated. There is only one honest English word for this one, so
 * they coincide; do not turn that into an import in either direction.
 */
const PASSKEY_METHOD = 'passkey'

function LoginPage() {
  const hydrated = useHydrated()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  /**
   * Whether to draw the passkey button at all (wordle-teams-wty4.1.7.4).
   *
   * BOTH HALVES OR NEITHER. WebAuthn has to exist, AND this device has to have
   * registered a credential — without the second the button is a dead-end tap
   * that opens a system sheet reading "no passkeys found", which is worse than
   * no button, and lib/passkey.ts's header says so at the function it calls.
   *
   * STARTS FALSE AND IS RAISED IN AN EFFECT, which is this page's existing rule
   * for anything read out of localStorage wearing a different shape — see
   * `lastUsed` below. The server cannot see the marker, so a button in the SSR
   * pass is a hydration mismatch on exactly the returning players it is for,
   * and `false` is what both sides agree on.
   *
   * STATE RATHER THAN A `useMemo` OVER `hydrated`, AND THAT IS THE DIFFERENCE
   * FROM `lastUsed`: this value CHANGES while the page is open. A ceremony that
   * the server refuses with PASSKEY_NOT_FOUND proves the marker was wrong,
   * lib/signin-passkey.ts clears it, and the button has to go with it — a memo
   * keyed on `hydrated` would leave a control on screen offering a ceremony
   * that has just been shown to fail.
   */
  const [canUsePasskey, setCanUsePasskey] = useState(false)
  useEffect(() => {
    setCanUsePasskey(passkeySupported() && passkeyRegisteredHere())
  }, [])

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

  /**
   * Sign in with the credential this device already holds
   * (wordle-teams-wty4.1.7.4).
   *
   * THE CEREMONY AND ITS CLASSIFICATION ARE lib/signin-passkey.ts's, not this
   * file's, for the reason that module's header gives: the decision about which
   * failure clears the per-device marker is the whole of
   * wordle-teams-wty4.1.7.8's residual case, and a route module cannot be
   * imported under vitest. What is left here is what to SAY and where to GO.
   *
   * THE THREE ENDINGS THAT ARE NOT A SIGN-IN ARE THREE DIFFERENT THINGS:
   *
   *   - 'cancelled' SAYS NOTHING. Dismissing the system sheet is how a person
   *     says "not now" to a modal their operating system drew; a message there
   *     scolds them for using its cancel button. components/passkey-offer.tsx
   *     takes the same line on the registration ceremony's 'aborted'.
   *   - 'no-credential' IS A SIGNPOST AND NOT A WALL, which is the whole point
   *     of it having an outcome of its own. The marker has just been cleared as
   *     wrong, so the button disappears in the same commit as the sentence
   *     appears — and the sentence names what still works and where to make a
   *     new one. The page the player is left looking at is one where every
   *     control on it can succeed.
   *   - 'failed' is an ordinary error in the ordinary place.
   */
  async function passkeySignIn() {
    setPending(true)
    setError(null)
    const result = await signInWithPasskey()
    setPending(false)
    if (result.outcome === 'cancelled') return
    if (result.outcome === 'no-credential') {
      // THE MARKER IS ALREADY GONE FROM THE STORE; this is the same fact on
      // screen. Nothing else re-reads it while this page is open.
      setCanUsePasskey(false)
      return setError(result.message)
    }
    if (result.outcome === 'failed') return setError(result.message)
    // PAST EVERY REFUSAL, and last, exactly as the email path's is and for the
    // same reason: the reload below is what discards this component, so nothing
    // may follow it. src/routes.test.ts pins "nothing runs after this".
    rememberLoginAttempt(PASSKEY_METHOD)
    // full reload — required with expectAuth, as on the code path above. The
    // session cookie is set by /passkey/verify-authentication and the Convex
    // client only re-reads auth on a fresh document.
    window.location.href = `/app?${SIGNIN_PARAM}=passkey`
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

          {/*
            BELOW THE FORM AND ABOVE THE ALERT, DELIBERATELY, ON BOTH COUNTS.

            Below: it cannot exist before hydration, so wherever it goes it
            arrives late and pushes something down. Here it pushes only the
            social section; above the form it would push the whole form, which
            is the thing a player may already be typing into.

            Above the alert: the sentence this button can produce IS the alert —
            "this device's passkey is no longer on your account" — and a
            signpost reads as an answer when it sits under the control that
            provoked it and as a page-level error when it floats above it.
          */}
          {canUsePasskey && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void passkeySignIn()}
              // NOT `!hydrated || pending`, unlike every other button on this
              // page, and the difference is not an oversight. Those exist in
              // the SSR pass and must refuse a pre-hydration click (wt-ksh.2.2);
              // this one is mounted BY an effect, so there is no frame in which
              // it exists and React has not attached.
              disabled={pending}
            >
              <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
              {/* NOT the offer dialog's "Set up a passkey" nor the Settings
                  tab's "Add a passkey": this one USES a passkey rather than
                  making one, and three controls with one accessible name is an
                  ambiguous target for a screen reader. */}
              Sign in with a passkey
              {lastUsed === PASSKEY_METHOD && <LastUsedBadge />}
            </Button>
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
