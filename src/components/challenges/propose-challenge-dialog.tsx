import { useEffect, useId, useState } from 'react'
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
type PlayerId = Id<'players'>

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
 * CHALLENGES_REFUSED, CHALLENGES_DISABLED, CHALLENGE_NO_ACCEPTER) has its own copy in
 * typedCodeMessage, and the likeliest next step after "That team is not taking
 * challenges right now" is picking another team — closing would make the user
 * reopen it. Only a successful direct proposal closes it.
 *
 * ONE PROPOSAL IN FLIGHT AT A TIME, FOR EVERY CONTROL. `pending` disables every
 * team button and the link button together: a second tap on another team while
 * the first is in flight would race two proposals against the same cap, and a
 * double-tapped link button would mint two links.
 *
 * A TEAM ONLY THE VIEWER IS ON IS SHOWN, DISABLED (wordle-teams-zic8.2.24).
 * The viewer cannot accept their own challenge, so with nobody else on the
 * opponent nobody ever could, and proposeToTeam refuses it
 * CHALLENGE_NO_ACCEPTER. Shown rather than hidden: a team the viewer knows they
 * are on, missing from "Your other teams", would read as a bug. The reason line
 * is the button's aria-describedby, so a screen reader hears WHY it is
 * disabled, not only that it is. Counted over getMyTeams' members, which drops
 * a roster id with no player row — the server counts ids, so for that rare
 * state the dialog is the stricter of the two.
 *
 * THE LINK IS SHOWN ONCE. challengesForTeam never returns a token (it is a
 * capability, see convex/challenges.ts newToken), so a link that is dismissed
 * cannot be fetched again — the dialog says so, and points at the remedy the
 * Challenges card already offers. There is deliberately no query that returns
 * tokens.
 */
/** A challenge made, but its one-time link never reached anyone. */
export const LINK_NOT_SHARED =
  "Your challenge was made, but this browser couldn't share the link. Withdraw it under Proposals and make a new one."

export function ProposeChallengeDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
  teams,
  viewerId,
  proposeToTeam,
  proposeByLink,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The team the page is showing: the challenger. */
  teamId: TeamId
  teamName: string
  /** Every team the viewer is on (getMyTeams), the current one included. */
  teams: ReadonlyArray<{ id: TeamId; name: string; members: ReadonlyArray<{ id: PlayerId }> }>
  /**
   * The viewer's own player id (getMyPlayerId), to tell a team with somebody
   * else on it from one with only them. Null counts every member as somebody
   * else — the server still refuses — and the route's guard means a signed-in
   * page always has one.
   */
  viewerId: PlayerId | null
  proposeToTeam: (args: { challengerTeamId: TeamId; opponentTeamId: TeamId }) => Promise<unknown>
  proposeByLink: (args: { challengerTeamId: TeamId }) => Promise<string>
}) {
  const listLabelId = useId()
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

  /**
   * TWO STEPS, TWO FAILURE MESSAGES. Once proposeByLink resolves, the proposal
   * EXISTS — it occupies one of the team's MAX_ACTIVE_CHALLENGES slots — and its
   * token is gone for good if the hand-off fails. Saying "could not create" then
   * would be false, and a user who retries leaves another unclaimable row each
   * time until the team hits CHALLENGE_LIMIT_REACHED. So a failure AFTER the
   * mint says the challenge was made and how to clear it.
   */
  const shareChallengeLink = async () => {
    setPending('link')
    try {
      let token: string
      try {
        token = await proposeByLink({ challengerTeamId: teamId })
      } catch (error) {
        toast.error(mutationErrorMessage(error, 'Could not create a challenge link'))
        return
      }
      // Task 13's route. lib/share-link.ts owns the order (share sheet first,
      // clipboard as the fallback) and what a dismissed sheet means.
      let outcome: Awaited<ReturnType<typeof shareLink>>
      try {
        outcome = await shareLink({
          title: `${teamName} challenges your team on Wordle Teams`,
          url: `${window.location.origin}/challenge/${token}`,
        })
      } catch {
        toast.error(LINK_NOT_SHARED)
        return
      }
      if (outcome === 'unavailable') {
        toast.error(LINK_NOT_SHARED)
      } else if (outcome === 'copied') {
        setCopied(true)
        toast.success('Challenge link copied')
      }
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
        // FOCUS THE DIALOG, NOT ITS FIRST BUTTON. Radix would focus the first
        // team button, so a keyboard user who opened this with Enter and held
        // the key could send a challenge by key repeat. The invite dialog lands
        // on an input, where that is harmless; here it is a proposal.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Challenge a team</DialogTitle>
          <DialogDescription>Pick another team you're on, or share a link</DialogDescription>
        </DialogHeader>

        <div className="w-full space-y-2">
          <p id={listLabelId} className="text-sm font-medium">
            Your other teams
          </p>
          {otherTeams.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You're not on any other team. Share a link below to challenge one.
            </p>
          ) : (
            <ul aria-labelledby={listLabelId} className="flex flex-col gap-2">
              {otherTeams.map((team) => {
                const onlyYou = !team.members.some((member) => member.id !== viewerId)
                // Derived from the list label's useId: a hook cannot run per
                // row, and a Convex id is a safe id fragment.
                const reasonId = `${listLabelId}-${team.id}-only-you`
                return (
                  <li key={team.id} className="space-y-1">
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
                      disabled={busy || onlyYou}
                      aria-disabled={busy || onlyYou}
                      aria-describedby={onlyYou ? reasonId : undefined}
                      onClick={() => propose(team)}
                    >
                      {pending === team.id && <Loader2 className="h-4 w-4 animate-spin" />}
                      {team.name}
                    </Button>
                    {onlyYou && (
                      <p id={reasonId} className="text-muted-foreground text-sm">
                        Only you are on this team
                      </p>
                    )}
                  </li>
                )
              })}
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
