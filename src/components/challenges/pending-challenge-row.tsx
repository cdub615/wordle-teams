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
 */
export function PendingChallengeRow({
  challenge,
  viewerIsOwner,
  now,
  busy = false,
  onAccept,
  onDecline,
  onWithdraw,
}: {
  challenge: PendingChallenge
  viewerIsOwner: boolean
  now: number
  busy?: boolean
  onAccept: (challengeId: ChallengeId) => void
  onDecline: (challengeId: ChallengeId) => void
  onWithdraw: (challengeId: ChallengeId) => void
}) {
  const expired = challenge.expiresAt <= now
  const incoming = challenge.direction === 'incoming'
  const canWithdraw = !incoming && (challenge.proposedByViewer || viewerIsOwner)

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="min-w-0 break-words">{describe(challenge)}</p>
        {expired && <p className="text-muted-foreground text-sm">Expired</p>}
      </div>
      {!expired && incoming && (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" disabled={busy} onClick={() => onAccept(challenge.challengeId)}>
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
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
          disabled={busy}
          onClick={() => onWithdraw(challenge.challengeId)}
        >
          Withdraw
        </Button>
      )}
    </div>
  )
}

function describe(challenge: PendingChallenge): string {
  if (challenge.direction === 'incoming') {
    // An incoming row always names its challenger: the challenging team is
    // set at proposal time. The fallback covers only a team deleted under it.
    return `${challenge.otherTeamName ?? 'A team'} challenged your team`
  }
  // A LINK PROPOSAL NOBODY HAS CLAIMED HAS NO OTHER TEAM YET (otherTeamName is
  // null). The link itself is not re-shown: the token reaches only the person
  // who made it, once.
  if (challenge.otherTeamName === null) return 'Waiting for a team to claim your link'
  return `Waiting for ${challenge.otherTeamName} to answer`
}
