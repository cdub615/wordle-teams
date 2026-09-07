/**
 * THE TOKEN FROM A SHARED INVITE LINK, WHILE ITS HOLDER IS BUSY SIGNING IN.
 *
 * `routes/join.$token.tsx` writes it; `routes/app.tsx` spends it. Two route
 * modules, so the key lives here rather than being exported from one of them
 * and imported by the other — the same reason `SIGNIN_PARAM` is in lib/funnel
 * .ts and `STORAGE_KEY` is in lib/dashboard-search.ts. A key spelled in two
 * places is a key that can be spelled differently in one of them, and the
 * failure is silent: the write succeeds, the read finds nothing, and the
 * invite is simply lost.
 *
 * WHY THE TOKEN HAS TO WAIT AT ALL. `consumeLink` calls `requirePlayer`, and a
 * brand-new account has no `players` row until /complete-profile. So the token
 * cannot be spent when the link is followed; it has to survive sign-in AND
 * profile completion, and be spent on arrival at /app.
 *
 * sessionStorage, NOT localStorage. A capability that outlives the tab it was
 * opened in is one left lying around on a shared computer. localStorage would
 * work — better, in casual testing, since it survives a tab close — which is
 * exactly why the choice is stated here and pinned in src/routes.test.ts
 * rather than left to read as an accident.
 *
 * NOTHING HERE MAY THROW, AND THAT IS NOT A FORMALITY. Private mode and
 * disabled site data make a bare `window.sessionStorage` access throw rather
 * than answer null. This sits on the path of someone who is trying to join a
 * team: a throw in the route's effect is a blank page instead of sign-in, and
 * one in the dashboard's effect takes the whole dashboard down. Both functions
 * below degrade to "the link did not survive the round trip", which is a
 * disappointment rather than an outage.
 */
export const PENDING_INVITE_KEY = 'wt.pendingInviteToken'

/** Stash a token for the trip through /login and /complete-profile. */
export function rememberPendingInvite(token: string): void {
  try {
    window.sessionStorage.setItem(PENDING_INVITE_KEY, token)
  } catch {
    // See the note above. The holder still reaches sign-in; they simply arrive
    // at the dashboard without the invite.
  }
}

/**
 * Read the stashed token AND CLEAR IT, in that order, as one operation.
 *
 * THE CLEAR IS NOT THE CALLER'S JOB, and making it structural here is the
 * whole reason this is `take` rather than `get`. `consumeLink` refuses an
 * expired, revoked or unknown token, and refuses a free-tier joiner already at
 * the team cap — and a refused token still in storage is read again on the next
 * dashboard render, and the one after that: an error toast that cannot be
 * dismissed for good, and a mutation call per render. A token is spent by
 * being ATTEMPTED, once, so it is removed before anyone can attempt it.
 *
 * ONE `try`, DELIBERATELY. If the removal throws, nothing is returned — this
 * refuses to hand back a token it could not mark as spent, because the caller
 * would then be in exactly the retry loop above. In practice the two throw
 * together (blocked storage fails the whole accessor), so this costs nothing
 * real and removes a state that would otherwise have to be reasoned about.
 */
export function takePendingInvite(): string | undefined {
  try {
    const token = window.sessionStorage.getItem(PENDING_INVITE_KEY)
    window.sessionStorage.removeItem(PENDING_INVITE_KEY)
    return token ?? undefined
  } catch {
    return undefined
  }
}
