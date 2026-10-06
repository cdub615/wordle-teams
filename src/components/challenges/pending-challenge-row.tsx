import { Button } from '#/components/ui/button.tsx'
import type { ChallengeId, PendingChallenge } from './types.ts'

/**
 * One pending proposal, from the viewing team's side.
 *
 * NOTHING NUMERIC, EVER (AC3): no scores, no counts, not even "expires in 3
 * days". Before acceptance neither team has agreed to compare, so this row says
 * who and what, and offers the verbs.
 *
 * EXPIRY IS DECIDED AGAINST THE CLIENT'S CLOCK (`now`), as PendingChallengeView
 * documents: the server ships `expiresAt` and a query result does not re-run as
 * time passes. An expired row shows "Expired" and NO actions (AC5) — accepting
 * it would be refused anyway, and withdrawing something already dead is noise.
 *
 * WHO MAY WITHDRAW mirrors withdrawChallengeFor exactly: the proposer, or the
 * challenging team's owner. On an outgoing row the viewing team IS the
 * challenging team, so `viewerIsOwner` is that owner.
 *
 * A TEAM THAT HAS SWITCHED CHALLENGES OFF IS NOT OFFERED ACCEPT (zic8.2.21 M8,
 * owner decision): acceptChallengeFor would refuse it with CHALLENGES_REFUSED.
 * Decline still works, so it stays, with one line saying why Accept is gone.
 * Owners have the switch at the foot of the same card, so nothing more is said.
 *
 * NOR IS THE PROPOSER, ON THEIR OWN PROPOSAL (wordle-teams-zic8.2.23). A direct
 * proposer is a member of both teams, so their proposal also lands on the
 * opponent's card as INCOMING — and acceptChallengeFor refuses them with
 * CHALLENGE_OWN_PROPOSAL, because one person is not the other team's consent.
 * Decline stays, as above, and one line says who has to accept instead —
 * unless the team is refusing challenges, when the refusal line alone is shown.
 */
export function PendingChallengeRow({
  challenge,
  viewerIsOwner,
  now,
  teamAcceptsChallenges = true,
  busy = false,
  onAccept,
  onDecline,
  onWithdraw,
}: {
  challenge: PendingChallenge
  viewerIsOwner: boolean
  now: number
  /** The viewing team's setting, already resolved: absent-means-on is the card's job. */
  teamAcceptsChallenges?: boolean
  busy?: boolean
  onAccept: (challengeId: ChallengeId) => void
  onDecline: (challengeId: ChallengeId) => void
  onWithdraw: (challengeId: ChallengeId) => void
}) {
  const expired = challenge.expiresAt <= now
  const incoming = challenge.direction === 'incoming'
  const canWithdraw = !incoming && (challenge.proposedByViewer || viewerIsOwner)
  const refusing = !expired && incoming && !teamAcceptsChallenges
  // ONE REASON AT A TIME: on a refusing team nobody can accept, so the refusal
  // line is the whole story and "waiting for someone else" would be untrue.
  const ownProposal = !expired && incoming && teamAcceptsChallenges && challenge.proposedByViewer
  const canAccept = teamAcceptsChallenges && !challenge.proposedByViewer
  const label = labelsFor(challenge)

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="min-w-0 break-words">{describe(challenge)}</p>
        {expired && <p className="text-muted-foreground text-sm">Expired</p>}
        {refusing && (
          <p className="text-muted-foreground text-sm">Your team isn't taking challenges right now.</p>
        )}
        {ownProposal && (
          <p className="text-muted-foreground text-sm">
            Waiting for someone else on this team to accept.
          </p>
        )}
      </div>
      {!expired && incoming && (
        <div className="flex shrink-0 gap-2">
          {canAccept && (
            <Button
              size="sm"
              aria-label={label.accept}
              disabled={busy}
              onClick={() => onAccept(challenge.challengeId)}
            >
              Accept
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            aria-label={label.decline}
            disabled={busy}
            onClick={() => onDecline(challenge.challengeId)}
          >
            Decline
          </Button>
        </div>
      )}
      {!expired && canWithdraw && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          aria-label={label.withdraw}
          disabled={busy}
          onClick={() => onWithdraw(challenge.challengeId)}
        >
          Withdraw
        </Button>
      )}
    </div>
  )
}

/**
 * EACH VERB NAMES ITS TEAM (zic8.2.21 M9). Two proposals one above the other
 * would otherwise be two buttons called "Accept", indistinguishable to anyone
 * moving between controls rather than reading the row beside them. An
 * unclaimed link has no team to name, so it is called what it is.
 */
function labelsFor(challenge: PendingChallenge) {
  const other = challenge.otherTeamName ?? 'another team'
  return {
    accept: `Accept the challenge from ${other}`,
    decline: `Decline the challenge from ${other}`,
    withdraw: challenge.isLink ? 'Withdraw your challenge link' : `Withdraw the challenge to ${other}`,
  }
}

function describe(challenge: PendingChallenge): string {
  if (challenge.direction === 'incoming') {
    // An incoming row always names its challenger: the challenging team is
    // set at proposal time. The fallback covers only a team deleted under it.
    return `${challenge.otherTeamName ?? 'A team'} challenged your team`
  }
  // A LINK PROPOSAL NOBODY HAS CLAIMED HAS NO OTHER TEAM YET. KEYED ON `isLink`,
  // NOT ON A NULL NAME (zic8.2.21 M10): a direct proposal whose opponent was
  // deleted under it has a null name too, and was never a link. The link itself
  // is not re-shown: the token reaches only the person who made it, once.
  if (challenge.isLink) return 'Waiting for a team to claim your link'
  return `Waiting for ${challenge.otherTeamName ?? 'a team'} to answer`
}
