/**
 * WHICH SIGN-IN METHOD THIS DEVICE LAST *COMPLETED* (wordle-teams-ilej).
 *
 * /login offers five paths and a returning player has no cue which one is
 * theirs. Guessing wrong on a social provider does not even fail cleanly:
 * account linking needs a verified email on both sides, so someone who signed
 * up with Google and later picks GitHub can land on "account not linked"
 * rather than simply signing in.
 *
 * TWO KEYS, WRITTEN AT DIFFERENT MOMENTS, AND THE SEPARATION IS THE WHOLE
 * CORRECTNESS ARGUMENT.
 *
 *   - `wt.login.pending` is an ATTEMPT. routes/login.tsx writes it immediately
 *     before the document is handed to a provider, for the same reason
 *     `login_provider_click` is emitted there and not on the way back: once the
 *     redirect happens, nothing on /login runs again.
 *   - `wt.login.last` is what the badge reads, and it only ever moves by
 *     PROMOTING a pending attempt on confirmed arrival at /app.
 *
 * SO A BOUNCE DOES NOT MOVE THE BADGE. Declining consent, or a provider that
 * errors, never reaches /app authenticated with the `?signin=` marker — so
 * nothing is promoted and the badge keeps pointing at whatever last actually
 * worked. Collapsing this to one key written on click is the obvious
 * simplification and it badges a method the user never completed, which is
 * WORSE than no badge: it steers them straight back into the failure.
 *
 * A METHOD IS JUST AN ID HERE, DELIBERATELY. Today's five are the four provider
 * ids plus 'email'; passkey (wordle-teams-wty4.1.7) will be a sixth string and
 * needs no change in this file. Nothing below validates an id — an unknown one
 * matches no button and shows no badge, which is the right outcome for a method
 * that has been removed. A union type here would have to be widened in lockstep
 * with the UI and would buy nothing: the value comes back out of a string store.
 *
 * localStorage, NOT A COOKIE. Nothing server-side reads this, so a cookie would
 * add weight to every request for no one's benefit. Per-device is also the only
 * semantics available at the moment it is needed: the badge renders BEFORE we
 * know who is signing in, so a per-account field is unreadable exactly then.
 * That is also why Better Auth's own `lastLoginMethod` plugin is not used — its
 * database mode cannot serve this feature at all, and its cookie mode is only
 * reachable through the `better-auth/plugins` barrel that convex/auth.ts
 * deliberately refuses. The issue carries the measurement.
 *
 * NOTHING HERE MAY THROW, AND THAT IS NOT A FORMALITY. Private mode and "block
 * all site data" make a bare `window.localStorage` access throw rather than
 * answer null. This sits on the sign-in path: a throw in /login's render is a
 * blank page where the sign-in form should be, for a browser setting that has
 * nothing to do with a cosmetic hint. All three functions degrade to "no badge".
 *
 * THE KEYS LIVE HERE BECAUSE THE WRITE AND THE PROMOTION ARE IN DIFFERENT ROUTE
 * MODULES — the same reason `SIGNIN_PARAM` is in lib/funnel.ts and
 * PENDING_INVITE_KEY is in lib/pending-invite.ts. A key spelled in two places
 * is a key that can be spelled differently in one of them, and the failure is
 * silent: the write succeeds, the read finds nothing, no badge ever appears.
 */
export const LOGIN_PENDING_KEY = 'wt.login.pending'
export const LOGIN_LAST_KEY = 'wt.login.last'

/**
 * Record that a sign-in with `method` was STARTED. Overwrites any earlier
 * unpromoted attempt, which is correct: the one in flight is the only one that
 * can still arrive.
 */
export function rememberLoginAttempt(method: string): void {
  try {
    window.localStorage.setItem(LOGIN_PENDING_KEY, method)
  } catch {
    // See the note above. The sign-in itself is unaffected; the device simply
    // does not learn which button was used.
  }
}

/**
 * Promote a pending attempt to `last`, and clear it — call this ONLY where
 * arrival is confirmed (routes/app.tsx's `?signin=` effect).
 *
 * NO PENDING MEANS NOTHING TO SAY, and `last` is left exactly as it was. That
 * is the case for an already-authenticated visitor and for a second arrival
 * carrying the marker; neither is evidence about a method, and clearing `last`
 * for want of a claim would take the badge away from a player who did nothing
 * wrong.
 *
 * THE CLEAR IS WHAT MAKES THE PROMOTION ONCE-ONLY. An attempt left in place is
 * re-promoted by the next marked arrival, however long afterwards and whatever
 * method that one used — so a bounce, followed weeks later by a sign-in with a
 * different provider, would badge the method that failed.
 *
 * ONE `try`, deliberately, exactly as takePendingInvite does: if the write of
 * `last` throws then the store is blocked and the read would have thrown first,
 * so the state where pending survives a successful promotion is not reachable.
 *
 * THERE ARE TWO CALL SITES, AND THE SECOND IS NOT A BELT-AND-BRACES EXTRA.
 * routes/app.tsx's `?signin=` effect covers a returning player. It CANNOT cover
 * a brand-new one: /app's loader throws `redirect({ to: '/complete-profile' })`
 * for an account with no players row, and that drops the search params —
 * `?signin=` included — so the one sign-in that created the account is never
 * promoted. Left there, the badge would first appear on that player's THIRD
 * visit, and their second visit is exactly the "returning player on a device
 * that has signed in before" the feature is for. routes/complete-profile.tsx
 * promotes on its own success path for that reason; its comment carries the
 * argument that the two sites cannot double-promote or mis-attribute.
 *
 * NEITHER SITE EMITS A FUNNEL EVENT OF ITS OWN. `login_callback_arrived` is
 * emitted where it always was, for the arrivals it always counted; a fresh
 * signup still does not emit one, because the fix was a second promotion rather
 * than carrying `?signin=` through the redirects.
 */
export function promoteLoginAttempt(): void {
  try {
    const pending = window.localStorage.getItem(LOGIN_PENDING_KEY)
    if (pending) window.localStorage.setItem(LOGIN_LAST_KEY, pending)
    window.localStorage.removeItem(LOGIN_PENDING_KEY)
  } catch {
    // No badge, rather than a dashboard that fails to mount on arrival.
  }
}

/**
 * The method this device last COMPLETED a sign-in with, or undefined.
 *
 * Undefined rather than null or '': the caller branches by comparing it to a
 * method id, and a falsy-by-luck value is the kind that stops being falsy.
 *
 * CALL THIS ONLY AFTER HYDRATION. The server cannot see localStorage, so a
 * badge rendered from it during SSR is a hydration mismatch — /login gates the
 * read on `useHydrated()` for that reason.
 */
export function lastLoginMethod(): string | undefined {
  try {
    return window.localStorage.getItem(LOGIN_LAST_KEY) ?? undefined
  } catch {
    return undefined
  }
}
