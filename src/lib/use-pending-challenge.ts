import { useEffect, useRef } from 'react'
import { hasPendingInvite } from '#/lib/pending-invite.ts'
import {
  forgetPendingChallenge,
  rememberPendingChallenge,
  takePendingChallenge,
} from '#/lib/pending-challenge.ts'
import { toPuzzleDay } from '../../convex/lib/puzzleDay.ts'

/**
 * BOTH ENDS OF A CHALLENGE LINK'S TRIP THROUGH SIGN-IN, LIFTED OUT OF THE TWO
 * ROUTES SO THEY CAN BE EXECUTED (Task 13, zic8.2.13).
 *
 * A route module cannot be rendered under vitest, and routes/app.tsx's
 * `Dashboard` is not exported — the reasons use-pending-invite.ts was lifted.
 * Neither hook here calls Convex or the router: the routes hand in a callback,
 * so each is driven by `renderHook` with nothing else in the tree.
 */

type ArrivalTarget = '/login' | '/app'

/**
 * Where the challenge page sends its visitor, and what it does with the stash.
 *
 *   signed out                  stash, go to /login
 *   signed in, no player row    stash, go to /app (its guard sends them through
 *                               /complete-profile, then the resume brings them
 *                               back here)
 *   signed in, player row       CLEAR any stash, stay
 *   signed in, still asking     nothing yet
 *
 * THE THIRD ROW IS THE ONE THAT MATTERS, and it is where this differs from the
 * join route. /app SPENDS a join token, so the join route can stash for every
 * visitor. /app only FORWARDS a challenge token, back to this page — so a stash
 * left behind for a player sends them here again on every dashboard visit for
 * the life of the tab, and a player with no team can never reach the dashboard
 * to make one. The stash exists only to cross /login and /complete-profile; a
 * player has crossed both.
 *
 * IN AN EFFECT, NOT A beforeLoad, for the reason routes/join.$token.tsx's
 * banner measures: a fresh document load runs beforeLoad only on the server,
 * where there is no sessionStorage to write.
 *
 * `needsProfile` is undefined while its query is in flight; a signed-out
 * visitor never asks it.
 */
export function useChallengeArrival({
  token,
  isAuthenticated,
  needsProfile,
  go,
}: {
  token: string
  isAuthenticated: boolean
  needsProfile: boolean | undefined
  go: (to: ArrivalTarget) => void
}): void {
  // Held in a ref, as usePendingInvite does, so an inline arrow from the route
  // cannot re-run the effect.
  const latest = useRef(go)
  latest.current = go

  useEffect(() => {
    if (!isAuthenticated) {
      rememberPendingChallenge(token)
      latest.current('/login')
      return
    }
    if (needsProfile === undefined) return
    if (needsProfile) {
      rememberPendingChallenge(token)
      latest.current('/app')
      return
    }
    forgetPendingChallenge()
  }, [token, isAuthenticated, needsProfile])
}

/**
 * THE OTHER END, ON THE DASHBOARD: a stashed challenge token sends the player
 * back to the challenge page.
 *
 * TAKEN, NOT READ — read and cleared in one step (takePendingChallenge), so a
 * refresh, a remount or a Back cannot loop the dashboard into /challenge.
 *
 * AN INVITE GOES FIRST, AND THIS IS DECLARED BEFORE usePendingInvite FOR THAT
 * REASON. That hook DESTROYS its stash inside its own effect, and effects run
 * in the order their hooks are called — so declared after it, this would
 * always find "no invite" and race the consume it is meant to wait for. Here it
 * runs first, sees the invite (a `?join=` in the address bar, or a stashed
 * one), and stands aside without touching its own token.
 *
 * `inviteBusy` IS WHAT BRINGS IT BACK, NOT `joinParam`. The reachable way to
 * hold both stashes — a join link and a challenge link followed while signed
 * out, or before /complete-profile — never has `?join=` in the URL (/login and
 * the profile redirect both drop it), so joinParam never changes and a
 * joinParam-only effect would never run again in that arrival. The challenge
 * would then fire on some later, unrelated dashboard visit (found by the Task
 * 13 review). Keyed on the consume's in-flight flag instead, this re-runs as
 * the invite is spent and forwards once it has SETTLED — after consumeLink,
 * not in the middle of it.
 *
 * `?join=` IS READ FROM window.location, as usePendingInvite reads it, not from
 * the router: the router's copy is what survives a remount after the address
 * bar has already been stripped.
 */
export function usePendingChallenge(
  joinParam: string | undefined,
  /** The invite consume is in flight: wait for it to settle. */
  inviteBusy: boolean,
  /**
   * The dashboard's own search correction has nothing left to do.
   *
   * WITHOUT THIS THE FORWARD IS LOST, and only a real browser shows it (found
   * by the Task 14 e2e; traced 2026-10-05). On a sign-in arrival this effect
   * runs on the first client pass, before hydration, and starts the navigation
   * to /challenge. The dashboard stays mounted while that navigation is
   * pending; then it hydrates, useSearchSync sees no ?team=/?month= and
   * navigates back to /app?team=&month= — superseding the forward. The token
   * has already been taken, so the link is simply gone. Waiting until the sync
   * is settled means the forward comes AFTER useSearchSync's correction.
   *
   * NOT AFTER EVERY NAVIGATION. The month-window correction in app.tsx is
   * computed below usePendingInvite, which this must precede, so the gate
   * cannot see it. It fires only for a ?month= outside the team's window, and
   * the arrivals this resume serves (sign-in, /complete-profile) carry no
   * month until useSearchSync sets the current one, which is always inside the
   * window. A stashed token meeting a bookmarked out-of-window month is the
   * unguarded case; it would lose the link, not loop.
   */
  searchSettled: boolean,
  onToken: (token: string) => void,
): void {
  const latest = useRef(onToken)
  latest.current = onToken

  useEffect(() => {
    if (new URL(window.location.href).searchParams.has('join')) return
    if (hasPendingInvite()) return
    if (inviteBusy) return
    if (!searchSettled) return
    const token = takePendingChallenge()
    if (!token) return
    latest.current(token)
  }, [joinParam, inviteBusy, searchSettled])
}

/**
 * claimChallengeLink's arguments. `today` is the VIEWER'S LOCAL day — the
 * challenge window starts the day after it, and resolving "today" in UTC is
 * v1's bug (see toPuzzleDay). A function rather than inline in the route so
 * that choice can be executed in a test.
 */
export function challengeClaimArgs<TeamId extends string>(
  token: string,
  opponentTeamId: TeamId,
  now: Date = new Date(),
): { token: string; opponentTeamId: TeamId; today: string } {
  return { token, opponentTeamId, today: toPuzzleDay(now) }
}
