import { createFileRoute, Link } from '@tanstack/react-router'
import { pageTitle } from '#/lib/seo'
import { Button } from '#/components/ui/button.tsx'
import { OTP_EXPIRY_LABEL } from '../../convex/lib/otpExpiry.ts'

/**
 * Ported from v1's src/app/login-error/page.tsx.
 *
 * THE COPY IS v1'S, WITH ONE DELIBERATE CHANGE, RECORDED BELOW. The two
 * asterisked notes are the whole value of this page: they name the two things
 * that actually go wrong, to a user who has just had one of them go wrong.
 * src/login-error.test.ts pins every visible line of it.
 *
 * THE ONE CHANGE: v1 says the passcode "will expire after 1 hour". ON v2 IT
 * EXPIRES IN FIVE MINUTES — convex/lib/otpExpiry.ts sets OTP_EXPIRY_SEC to 300,
 * and that one constant configures the emailOTP plugin AND writes the "It
 * expires in 5 minutes" sentence in the code email itself. Porting "1 hour"
 * verbatim would have this page contradict the email the user is looking at,
 * and would tell someone whose code is forty minutes old that it should still
 * work — the exact opposite of the guidance the note exists to give. So the
 * duration is INTERPOLATED FROM THE SAME MODULE rather than written out, which
 * is the reason that module exists (the email and the plugin "were previously
 * independent, so the email could have promised five minutes while the plugin
 * enforced something else"). This page is the third consumer and cannot drift
 * from the other two either — and it reads OTP_EXPIRY_LABEL rather than
 * dividing by 60 itself, because two call sites each rounding the same number
 * is how one off-by-a-minute bug came to exist in two places at once.
 *
 * v1 ALSO CALLED clearAllCookies() IN A useEffect ON MOUNT. IT IS NOT PORTED,
 * and the reason is not "v2 is different" — it is that the same code would be a
 * verified no-op here:
 *
 *   1. IT COULD NOT TOUCH THE COOKIES THAT MATTER. v1's helper (src/lib/utils
 *      .ts:158) walks `document.cookie` and expires each name it finds. v2's
 *      session lives in `better-auth.session_token` and `better-auth.convex_jwt`,
 *      and better-auth's cookie factory sets `httpOnly: true` by default
 *      (node_modules/better-auth/dist/cookies/index.mjs createCookieGetter);
 *      convex/auth.ts sets no `advanced.defaultCookieAttributes` to change that.
 *      An httpOnly cookie is invisible to `document.cookie`, so the loop would
 *      not enumerate it and could not expire it. v1 needed the sweep because
 *      Supabase's SSR session was readable, chunked cookies that could be left
 *      half-written; nothing in v2 has that shape.
 *   2. THE THEME SURVIVES EITHER WAY — worth stating because it is the obvious
 *      objection and it is WRONG. v2's theme is localStorage, not a cookie
 *      (src/lib/theme.ts), as is the dashboard's selectedTeam.
 *      Clearing cookies would not have touched them.
 *   3. SIGNING OUT THROUGH authClient INSTEAD WOULD BE WORSE, not better.
 *      Landing here does not imply a session exists — every path that reaches
 *      it is an OAuth failure, which is precisely the case where no session was
 *      created. A signOut() on mount would take a session the user still has in
 *      another tab and destroy it because they followed a stale link.
 *
 * So: nothing runs on mount. The page renders and offers the way back.
 */

/**
 * THE `wordle-teams-vjh` DECISION: THE PROVIDER'S ERROR IS CARRIED THROUGH.
 *
 * vjh is filed against v1, where src/app/api/auth/callback/route.ts reads only
 * `code` and `token_hash` and drops the provider's `?error=` on the floor — so
 * the user who declined Microsoft consent in production on 2026-07-22 got this
 * page with no explanation, identical to the one an expired passcode produces.
 *
 * THAT BUG IS NOT REACHABLE IN v2, because v2 does not own the callback.
 * Better Auth 1.6.23 owns it, and it already parses both `error` and
 * `error_description` (dist/api/routes/callback.mjs) and redirects to an error
 * URL with a machine-readable code attached. v2 was throwing that away at a
 * later point instead: with no error URL configured, the code went to Better
 * Auth's own /api/auth/error page, which in production 302s onward to `/` with
 * the error in the query string and NOTHING SHOWN AT ALL. A declined consent
 * landed silently on the marketing page. That is worse than v1's dead end.
 *
 * Two lines now point that flow here, and they are both one-liners because the
 * parsing was never the missing part:
 *
 *   - src/routes/login.tsx passes `errorCallbackURL: '/login-error'` to
 *     signIn.social, which Better Auth stores in the OAuth state and honours
 *     when the provider comes back with an error.
 *   - convex/auth.ts sets `onAPIError.errorURL`, which catches the failures
 *     that happen BEFORE that state can be read — a mismatched or missing
 *     state, which is exactly the first asterisked note's failure mode.
 *
 * THE PARAM IS NAMED `error`, NOT `reason`. It is Better Auth's spelling, fixed
 * inside redirectOnError (dist/oauth2/errors.mjs); renaming it would mean
 * intercepting a callback that runs on the Convex deployment, which is the
 * complexity this decision is specifically avoiding.
 *
 * NOTHING FROM THE QUERY STRING IS EVER RENDERED. `error` is matched against
 * the Map below and only the Map's own literal is displayed; an unrecognised
 * code shows the generic copy alone. `error_description` — free text written by
 * the provider, and in the observed production hit a full AADSTS sentence — is
 * NOT READ AT ALL, here or in validateSearch.
 */

/**
 * The sentence for BOTH of Better Auth's parseState failures, which are one
 * situation to a user.
 *
 * `state_mismatch` is thrown when the state cookie is missing (dist/state.mjs,
 * the `!encryptedData` branch); `state_invalid` is thrown a few lines later
 * when the cookie is there but will not decrypt or parse. Different causes,
 * identical advice: the attempt is no longer usable and starting again is what
 * fixes it. Written once so the two cannot drift into saying different things
 * about the same failure.
 */
const STALE_ATTEMPT =
  'This sign in attempt expired, or it was started in a different browser or tab. Starting again from the sign in page usually works.'

const REASONS = new Map<string, string>([
  [
    // The provider said the user declined. This is the code from the production
    // hit recorded in wordle-teams-vjh.
    'access_denied',
    'You cancelled at your sign in provider, or declined the permissions it asked for. You can try again, choose a different provider, or use a one time passcode instead.',
  ],
  [
    // access_denied's cousin in the OAuth2 spec, and the one Microsoft in
    // particular sends: the provider WOULD sign the user in but has no consent
    // on record and was not able to ask for it. Distinct from access_denied,
    // where the user was asked and said no, but the way out is the same one.
    'consent_required',
    'Your sign in provider needs your permission before it can sign you in, and it did not get it. Try again and accept the permissions it asks for, or use a one time passcode instead.',
  ],
  [
    // parseState could not match the callback's state to the cookie it stored,
    // or the attempt aged out. This is the first asterisked note, named.
    'state_mismatch',
    STALE_ATTEMPT,
  ],
  [
    // The same note's other half: the state cookie came back but could not be
    // decrypted or parsed. See STALE_ATTEMPT above.
    'state_invalid',
    STALE_ATTEMPT,
  ],
  [
    // No state parameter came back at all — the shape of the paramless callback
    // hit also recorded in wordle-teams-vjh.
    'state_not_found',
    'The response from your sign in provider came back incomplete. Starting again from the sign in page usually works.',
  ],
  [
    // Better Auth refuses to link an account when the provider will not vouch
    // for the email, and it refuses rather than creating a duplicate. See the
    // accountLinking note in convex/auth.ts — a personal Microsoft account hit
    // exactly this.
    'account_not_linked',
    'Your sign in provider did not confirm your email address, so we could not match it to your account. Signing in with a one time passcode will work.',
  ],
])

type LoginErrorSearch = { error?: string }

export const Route = createFileRoute('/login-error')({
  // v1: src/app/login-error/layout.tsx metadata.title -> 'Login / Signup',
  // which is the same title v1 gives /login. Deliberately identical: this page
  // is a step in the sign-in flow, not a destination of its own.
  head: () => ({ meta: [{ title: pageTitle('Login / Signup') }] }),
  validateSearch: (search: Record<string, unknown>): LoginErrorSearch => ({
    // An allowlist, not a sanitiser. Anything not spelled exactly like one of
    // the six codes above is dropped here and never reaches the component, so
    // there is no path by which a query string can become page content.
    error:
      typeof search.error === 'string' && REASONS.has(search.error) ? search.error : undefined,
  }),
  component: LoginErrorRoute,
})

function LoginErrorRoute() {
  const { error } = Route.useSearch()
  return <LoginErrorPage error={error} />
}

/**
 * The page itself, taking the already-validated code as a prop.
 *
 * SPLIT FROM THE ROUTE COMPONENT SO THE COPY IS TESTABLE. `Route.useSearch()`
 * needs a running router, which does not exist under vitest — the same
 * constraint src/routes.test.ts and src/legal-prose.test.ts are both written
 * around. With the search read one level up, src/login-error.test.ts can
 * call this as the plain function it is and walk the element tree it returns,
 * which is the only way the two asterisked notes get a gate-level assertion.
 */
export function LoginErrorPage({ error }: { error?: string }) {
  const reason = error ? REASONS.get(error) : undefined

  return (
    <main className="page-wrap flex justify-center px-4 py-12">
      <section className="island-shell w-full max-w-md rounded-2xl p-6 text-center sm:p-8">
        {/* aria-hidden for the reason given in src/routes/privacy.tsx: it sits
            inside the island so a screen reader would announce it ahead of the
            h1, and the h1 says the same thing better. */}
        <p className="island-kicker mb-2" aria-hidden="true">
          Sign in
        </p>
        <h1 className="font-display mb-3 text-3xl font-bold text-foreground sm:text-4xl">
          Sign In Failed
        </h1>
        <p className="m-0 text-base text-muted-foreground">Please try again</p>

        {reason && (
          <p className="mt-4 rounded-md bg-muted p-3 text-sm leading-6 text-foreground">
            {reason}
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 text-xs leading-5 text-muted-foreground">
          <p className="m-0">
            <b>*</b> sometimes the first login with a sign in provider fails when redirecting to
            Wordle Teams.
          </p>
          <p className="m-0">
            <b>*</b> a One Time Passcode (OTP) will expire after {OTP_EXPIRY_LABEL}. If your email
            has been delayed you may need to try again.
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          {/* asChild, so this is an <a> carrying the button's styling rather
              than v1's <button> nested inside an <a> — which is invalid HTML and
              gives assistive technology two overlapping controls. */}
          <Button asChild>
            <Link to="/login">Head to Sign In</Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
