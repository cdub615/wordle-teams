import { useId, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group.tsx'
import { convexErrorCode, mutationErrorMessage, typedCodeMessage } from '#/lib/convex-error.ts'
import { forgetPendingChallenge } from '#/lib/pending-challenge.ts'
import type { Id } from '../../../convex/_generated/dataModel'

type TeamId = Id<'teams'>

/**
 * The refusals that end the page rather than the attempt.
 *
 * CHALLENGE_LINK_INVALID IS ONE MESSAGE FOR FOUR CAUSES — unknown, expired,
 * claimed and withdrawn — because claimChallengeLinkFor throws the same code for
 * each on purpose. Nothing here may tell them apart again: a holder of a
 * guessed token would learn which tokens were once real.
 *
 * CHALLENGE_OWN_PROPOSAL IS NEITHER (wordle-teams-zic8.2.23). It is about the
 * VIEWER — the link's own minter — so every team they could pick is refused the
 * same way, yet the link itself is still good for anyone else. It ends the page
 * for this viewer only: see OWN_LINK below. It is not one of these, because
 * TERMINAL_REFUSALS means "this link is dead", and the route's `outcome` says so.
 *
 * Everything else (CHALLENGE_LIMIT_REACHED, CHALLENGE_EXISTS,
 * CHALLENGES_REFUSED, INVALID_TEAM, INVALID_DATE, and anything untyped) is a
 * refusal OF THAT TEAM or of that moment, and another team may still accept —
 * so it toasts and leaves the picker.
 */
export const TERMINAL_REFUSALS = ['CHALLENGE_LINK_INVALID', 'CHALLENGES_DISABLED'] as const
export type TerminalRefusal = (typeof TERMINAL_REFUSALS)[number]

const isTerminal = (code: string | null): code is TerminalRefusal =>
  (TERMINAL_REFUSALS as ReadonlyArray<string | null>).includes(code)

/**
 * What the page says once CHALLENGE_OWN_PROPOSAL has come back. Its own copy,
 * not typedCodeMessage's: that one is written for the team page's Accept
 * ("someone else on your team"), and here the move belongs to another team.
 */
const OWN_LINK =
  'This is your own challenge link. Share it with another team — someone there has to accept it.'

/**
 * The body of /challenge/<token> (zic8.2.13, Task 13).
 *
 * NO CONVEX AND NO ROUTER CALLS HERE, as with ProposeChallengeDialog: the route
 * hands in the mutation (`onClaim`, token and day already bound) and what to do
 * after it, so every state renders in a test without a backend. The toasts and
 * the stash's clear ARE here, because which fire on which answer is this
 * component's whole behaviour.
 *
 * `outcome` IS OWNED BY THE ROUTE and reported back through `onTerminal`, so a
 * dead link stays dead for as long as the page is mounted, whatever re-renders
 * the team subscription causes.
 */
export function ChallengeClaim({
  state,
  teams,
  onClaim,
  onClaimed,
  outcome,
  onTerminal,
}: {
  /**
   * 'error': getMyTeams or needsProfile FAILED (zic8.2.21 M12). Distinct from
   * 'loading', which would otherwise say "One moment…" for ever.
   */
  state: 'signed-out' | 'loading' | 'error' | 'ready'
  /** The viewer's teams (getMyTeams). */
  teams: ReadonlyArray<{ id: TeamId; name: string }>
  /** claimChallengeLink for this token and the viewer's local day. */
  onClaim: (teamId: TeamId) => Promise<unknown>
  /** After a successful claim: the route navigates to the team. */
  onClaimed: (teamId: TeamId) => void
  /** A terminal refusal, once one has happened; null until then. */
  outcome: TerminalRefusal | null
  onTerminal: (code: TerminalRefusal) => void
}) {
  const groupLabelId = useId()
  const [selected, setSelected] = useState<TeamId | null>(null)
  const [pending, setPending] = useState(false)
  // LOCAL, NOT THE ROUTE'S `outcome`: that one means the link is dead, and this
  // is only about who is holding it. The component stays mounted for the
  // route's life, so it holds as long as `outcome` would.
  const [ownLink, setOwnLink] = useState(false)

  // DERIVED, NOT INITIAL STATE. `teams` is a subscription that can arrive or
  // change after mount; a lone team is the choice whenever it is the only one,
  // and a remembered choice counts only while that team is still listed.
  const chosen =
    teams.length === 1
      ? teams[0]
      : (teams.find((team) => team.id === selected) ?? null)

  if (state === 'error') {
    // ONE MESSAGE, NO CONTROLS: nothing on this page would succeed where the
    // subscription failed, and a refresh is the retry.
    return (
      <main className="page-wrap flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold">
          Something went wrong loading your teams. Refresh to try again.
        </h1>
      </main>
    )
  }

  if (state !== 'ready') {
    // Like the join route: names nothing, because this side has not looked the
    // token up — an anonymous holder learns nothing about whether it is real.
    return (
      <main className="page-wrap flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold">Opening a challenge</h1>
        <p className="text-muted-foreground text-sm">One moment…</p>
      </main>
    )
  }

  if (outcome !== null) {
    // ONE MESSAGE, NO CONTROLS. There is nothing left to try on this link.
    return (
      <main className="page-wrap flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold">{typedCodeMessage(outcome)}</h1>
      </main>
    )
  }

  if (ownLink) {
    // ONE MESSAGE AND A WAY OUT, no picker: every team here would be refused.
    return (
      <main className="page-wrap flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <h1 className="text-lg font-semibold">{OWN_LINK}</h1>
        <Button asChild variant="outline">
          <Link to="/team">Go to your team</Link>
        </Button>
      </main>
    )
  }

  if (teams.length === 0) {
    return (
      <main className="page-wrap flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">You've been challenged</h1>
          <p className="text-muted-foreground text-sm">You need a team to accept a challenge.</p>
        </div>
        <Button asChild variant="outline">
          <Link to="/app">Go to your dashboard</Link>
        </Button>
      </main>
    )
  }

  const accept = async () => {
    if (chosen === null) return
    setPending(true)
    try {
      await onClaim(chosen.id)
    } catch (error) {
      const code = convexErrorCode(error)
      if (isTerminal(code)) {
        forgetPendingChallenge()
        onTerminal(code)
      } else if (code === 'CHALLENGE_OWN_PROPOSAL') {
        // FORGET ANYWAY, though useChallengeArrival normally already has: a
        // surviving stash would bounce the minter back here from every
        // dashboard visit. Idempotent, and the link itself lives on the server.
        forgetPendingChallenge()
        setOwnLink(true)
      } else {
        toast.error(mutationErrorMessage(error, 'Could not accept that challenge'))
      }
      setPending(false)
      return
    }
    // STILL PENDING ON SUCCESS: the page is about to be replaced by the team's,
    // and a second tap in between would claim a link that is already spent.
    forgetPendingChallenge()
    toast.success('Challenge accepted')
    onClaimed(chosen.id)
  }

  return (
    <main className="page-wrap flex min-h-[50vh] flex-col items-center justify-center py-8">
      <div className="w-full max-w-sm space-y-5">
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold">You've been challenged</h1>
          <p className="text-muted-foreground text-sm">
            A team accepts on behalf of all its members, and the challenge starts tomorrow.
          </p>
        </div>

        <div className="space-y-2">
          <p id={groupLabelId} className="text-sm font-medium">
            {teams.length === 1 ? 'Your team' : 'Which team accepts?'}
          </p>
          <RadioGroup
            aria-labelledby={groupLabelId}
            value={chosen?.id ?? ''}
            onValueChange={(value) => setSelected(value as TeamId)}
            disabled={pending}
          >
            {teams.map((team) => (
              <div key={team.id} className="flex min-w-0 items-center gap-3">
                <RadioGroupItem value={team.id} id={`${groupLabelId}-${team.id}`} />
                {/* Wraps rather than truncating: a long team name must stay
                    readable at 390px, which is what the choice is made by. */}
                <Label htmlFor={`${groupLabelId}-${team.id}`} className="min-w-0 break-words">
                  {team.name}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <Button
          type="button"
          className="h-auto min-h-10 w-full whitespace-normal"
          disabled={chosen === null || pending}
          onClick={accept}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {/* A SPAN THAT CAN BREAK ANYWHERE. Team names have no length limit and
              may have no spaces; the button is a flex row whose bare text item
              would take the whole unbroken name as its minimum width and push
              the page sideways at 360px. */}
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {chosen ? `Accept for ${chosen.name}` : 'Choose a team to accept'}
          </span>
        </Button>
      </div>
    </main>
  )
}
