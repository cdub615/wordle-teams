import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { convexQuery, useConvexMutation } from '@convex-dev/react-query'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { pageTitle } from '#/lib/seo'
import { challengeClaimArgs, useChallengeArrival } from '#/lib/use-pending-challenge.ts'
import { ChallengeClaim, type TerminalRefusal } from '#/components/challenges/challenge-claim.tsx'

/**
 * Follow a challenge link (zic8.2.13, Task 13).
 *
 * UNLIKE A JOIN LINK, THE TOKEN IS SPENT ON THIS PAGE, NOT ON /app. The holder
 * has to CHOOSE which of their teams accepts, so there is a page to choose on;
 * /app's part is only to bring a holder back here once they have a player row
 * (lib/use-pending-challenge.ts, `usePendingChallenge`).
 *
 * WHO IS SENT WHERE, AND WHEN THE TOKEN IS STASHED, is `useChallengeArrival` —
 * read its header. In short: stashed only while there is no player row, and
 * cleared the moment a player arrives, because /app forwards a challenge token
 * rather than spending it and a stash left for a player would bring them back
 * here on every dashboard visit.
 *
 * THERE IS NO `beforeLoad` HERE, for the reason routes/join.$token.tsx's banner
 * measures: on a fresh document load a beforeLoad runs only on the server, its
 * redirect becomes a 307 on the wire, and a stash written there is written on
 * nobody. The decisions live in an effect, where client code actually runs.
 */
export const Route = createFileRoute('/challenge/$token')({
  head: () => ({ meta: [{ title: pageTitle('Accept a challenge') }] }),
  component: ChallengeLink,
})

/**
 * KEYED BY TOKEN. TanStack reuses this component when only the param changes,
 * so without a key a client-side move from /challenge/A to /challenge/B would
 * carry A's outcome (say, a dead-link message) and its selection onto B
 * without ever trying B (found by the Task 13 review).
 */
function ChallengeLink() {
  const { token } = Route.useParams()
  return <ChallengeLinkFor key={token} token={token} />
}

function ChallengeLinkFor({ token }: { token: string }) {
  // Resolved by the root route's beforeLoad before this renders — see the join
  // route for why this, and not useConvexAuth.
  const { isAuthenticated } = Route.useRouteContext()
  const navigate = useNavigate()
  const [outcome, setOutcome] = useState<TerminalRefusal | null>(null)

  // NOT ASKED WHILE SIGNED OUT: a signed-out page looks nothing up.
  const { data: needsProfile, error: needsProfileError } = useQuery(
    convexQuery(api.players.needsProfile, isAuthenticated ? {} : 'skip'),
  )
  const { data: teams, error: teamsError } = useQuery(
    convexQuery(api.teams.getMyTeams, isAuthenticated && needsProfile === false ? {} : 'skip'),
  )

  /*
    A FAILED LOOKUP IS NOT A SLOW ONE (zic8.2.21 M12). Either query failing
    leaves `teams` undefined, which on its own reads as 'loading' — "One
    moment…" for ever. The error arm sits after 'signed-out' (a signed-out page
    looks nothing up) and before 'loading' (which a failure also satisfies).
    A NAMED CONST so src/routes.test.ts can pin it whole with initializerOf.
  */
  const claimState = !isAuthenticated
    ? 'signed-out'
    : needsProfileError || teamsError
      ? 'error'
      : needsProfile !== false || !teams
        ? 'loading'
        : 'ready'
  const claim = useMutation({
    mutationFn: useConvexMutation(api.challenges.claimChallengeLink),
  })

  useChallengeArrival({
    token,
    isAuthenticated,
    needsProfile,
    // `replace`, so Back from /login or /app returns to wherever the link was,
    // not to this page, which would bounce them straight forward again.
    go: (to) => void navigate({ to, replace: true }),
  })

  return (
    <ChallengeClaim
      state={claimState}
      teams={teams ?? []}
      onClaim={(teamId) => claim.mutateAsync(challengeClaimArgs(token, teamId))}
      onClaimed={(teamId) =>
        void navigate({ to: '/team', search: { team: teamId }, replace: true })
      }
      outcome={outcome}
      onTerminal={setOutcome}
    />
  )
}
