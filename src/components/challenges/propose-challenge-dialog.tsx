import { useEffect, useState } from 'react'
import { Loader2, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Separator } from '#/components/ui/separator.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { shareLink } from '#/lib/share-link.ts'
import { useVisualViewport } from '#/lib/use-visual-viewport.ts'
import type { Id } from '../../../convex/_generated/dataModel'

type TeamId = Id<'teams'>

/**
 * "Challenge a team" (zic8.2.19, Task 12b; AC2). Two ways in: one of the
 * viewer's OTHER teams, or a link for a team the app cannot name.
 *
 * NO CONVEX HERE. routes/team.tsx hands in the two mutations' `mutateAsync`
 * and the team list, as it does for ChallengesCard, so every state renders in a
 * test without a backend. The toasts ARE here, because which ones fire and
 * whether the dialog closes is this component's whole behaviour.
 *
 * A REFUSAL LEAVES THE DIALOG OPEN. Every refusal the server has for a
 * proposal (PRO_REQUIRED, CHALLENGE_LIMIT_REACHED, CHALLENGE_EXISTS,
 * CHALLENGES_REFUSED, CHALLENGES_DISABLED) has its own copy in
 * typedCodeMessage, and the likeliest next step after "That team is not taking
 * challenges right now" is picking another team — closing would make the user
 * reopen it. Only a successful direct proposal closes it.
 *
 * ONE PROPOSAL IN FLIGHT AT A TIME, FOR EVERY CONTROL. `pending` disables every
 * team button and the link button together: a second tap on another team while
 * the first is in flight would race two proposals against the same cap, and a
 * double-tapped link button would mint two links.
 *
 * THE LINK IS SHOWN ONCE. challengesForTeam never returns a token (it is a
 * capability, see convex/challenges.ts newToken), so a link that is dismissed
 * cannot be fetched again — the dialog says so, and points at the remedy the
 * Challenges card already offers. There is deliberately no query that returns
 * tokens.
 */
export function ProposeChallengeDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
  teams,
  proposeToTeam,
  proposeByLink,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The team the page is showing: the challenger. */
  teamId: TeamId
  teamName: string
  /** Every team the viewer is on (getMyTeams), the current one included. */
  teams: ReadonlyArray<{ id: TeamId; name: string }>
  proposeToTeam: (args: { challengerTeamId: TeamId; opponentTeamId: TeamId }) => Promise<unknown>
  proposeByLink: (args: { challengerTeamId: TeamId }) => Promise<string>
}) {
  const { height, offsetTop } = useVisualViewport()
  // Which control is in flight: an opponent's id, 'link', or nothing. One value
  // rather than a flag per control, so "anything in flight" is one test.
  const [pending, setPending] = useState<TeamId | 'link' | null>(null)
  // The clipboard path's lasting confirmation, as the invite dialog's: a toast
  // is gone in seconds, and the share sheet gives its own feedback.
  const [copied, setCopied] = useState(false)
  const busy = pending !== null

  // Reset on the OPEN transition, as invite-player-dialog.tsx does, so a
  // second visit does not open on a stale "Link copied".
  useEffect(() => {
    if (!open) return
    setCopied(false)
  }, [open])

  const otherTeams = teams.filter((team) => team.id !== teamId)

  const propose = async (opponent: { id: TeamId; name: string }) => {
    setPending(opponent.id)
    try {
      await proposeToTeam({ challengerTeamId: teamId, opponentTeamId: opponent.id })
      // The card's pending list updates by subscription; nothing to refetch.
      toast.success(`Challenge sent to ${opponent.name}`)
      onOpenChange(false)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not send that challenge'))
    } finally {
      setPending(null)
    }
  }

  const shareChallengeLink = async () => {
    setPending('link')
    try {
      const token = await proposeByLink({ challengerTeamId: teamId })
      // Task 13's route. lib/share-link.ts owns the order (share sheet first,
      // clipboard as the fallback) and what a dismissed sheet means.
      const outcome = await shareLink({
        title: `${teamName} challenges your team on Wordle Teams`,
        url: `${window.location.origin}/challenge/${token}`,
      })
      if (outcome === 'unavailable') {
        // The proposal exists and waits in the card; only the hand-off failed.
        // There is no email field to point at here, unlike the invite dialog.
        toast.error('This browser cannot share or copy the link.')
      } else if (outcome === 'copied') {
        setCopied(true)
        toast.success('Challenge link copied')
      }
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not create a challenge link'))
    } finally {
      setPending(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The visual-viewport `top` is parity with the team dialogs — see
          create-team-dialog.tsx for why it is load-bearing on a phone. */}
      <DialogContent
        style={height ? { top: offsetTop + height / 2, maxHeight: height } : undefined}
      >
        <DialogHeader>
          <DialogTitle>Challenge a team</DialogTitle>
          <DialogDescription>Pick another team you're on, or share a link</DialogDescription>
        </DialogHeader>

        <div className="w-full space-y-2">
          <p className="text-sm font-medium">Your other teams</p>
          {otherTeams.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You're not on any other team. Share a link below to challenge one.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {otherTeams.map((team) => (
                <li key={team.id}>
                  {/* WRAPS, NEVER TRUNCATES. `whitespace-normal` undoes
                      ui/button.tsx's nowrap so the inherited
                      `[overflow-wrap:anywhere]` on <body> can break a long
                      name; a `truncate` would make the grid column take the
                      whole unwrapped name as min-content — see the long note
                      on invite-player-dialog.tsx's title. */}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-10 w-full justify-start whitespace-normal text-left"
                    disabled={busy}
                    aria-disabled={busy}
                    onClick={() => propose(team)}
                  >
                    {pending === team.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    {team.name}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="w-full space-y-2">
          <Separator />
          <p className="text-sm font-medium">Or share a challenge link</p>
          <p className="text-muted-foreground text-sm">
            Any team can accept it. This link can't be shown again. You can withdraw it and make a
            new one.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            aria-disabled={busy}
            onClick={shareChallengeLink}
          >
            {pending === 'link' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="mr-2 h-4 w-4" />
            )}
            Create a challenge link
          </Button>
          {copied && (
            <p className="text-muted-foreground text-sm">Link copied to your clipboard.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
