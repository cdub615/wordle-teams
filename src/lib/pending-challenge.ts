/**
 * THE TOKEN FROM A CHALLENGE LINK, WHILE ITS HOLDER HAS NO PLAYER ROW YET.
 *
 * `routes/challenge.$token.tsx` writes it; `routes/app.tsx` takes it and sends
 * the holder back to the challenge page. Two route modules, so the key lives
 * here — the reason pending-invite.ts gives, and this file mirrors that one on
 * purpose: same store, same tolerance, its own key.
 *
 * WHY IT IS SET SO RARELY. A join token is SPENT on /app, so the join route can
 * stash for every visitor. A challenge token is not: /app only FORWARDS to the
 * challenge page, because the holder must choose which team accepts. A stash
 * written on every visit would send a player who left without accepting back
 * there on every later dashboard visit for the life of the tab. So it is
 * written only while there is no player row (signed out, or signed in before
 * /complete-profile) and cleared the moment a player reaches the page.
 *
 * sessionStorage, NOT localStorage, and NOTHING HERE MAY THROW — both for the
 * reasons pending-invite.ts states at length.
 */
export const PENDING_CHALLENGE_KEY = 'wt.pendingChallengeToken'

/** Stash a token for the trip through /login and /complete-profile. */
export function rememberPendingChallenge(token: string): void {
  try {
    window.sessionStorage.setItem(PENDING_CHALLENGE_KEY, token)
  } catch {
    // The holder still reaches sign-in; they arrive at the dashboard without
    // the challenge, and the link in their chat still works.
  }
}

/**
 * Read the stashed token AND CLEAR IT, as one operation — `take`, not `get`, so
 * the dashboard's resume cannot loop on a refresh. One `try`: a token that
 * could not be removed is not handed back. See takePendingInvite.
 */
export function takePendingChallenge(): string | undefined {
  try {
    const token = window.sessionStorage.getItem(PENDING_CHALLENGE_KEY)
    window.sessionStorage.removeItem(PENDING_CHALLENGE_KEY)
    return token ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Drop any stashed token: a player arrived at the challenge page, accepted, or
 * met a dead link. Every one of those ends the stash's job.
 */
export function forgetPendingChallenge(): void {
  try {
    window.sessionStorage.removeItem(PENDING_CHALLENGE_KEY)
  } catch {
    // Blocked storage held nothing to forget.
  }
}
