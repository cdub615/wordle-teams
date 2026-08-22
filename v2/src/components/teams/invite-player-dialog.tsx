import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConvexMutation } from '@convex-dev/react-query'
import { useMutation } from '@tanstack/react-query'
import type { FormEventHandler } from 'react'
import { api } from '../../../convex/_generated/api'
import { Button } from '#/components/ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { useVisualViewport } from '#/lib/use-visual-viewport.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Invite someone by email. Ports v1's invite-player.tsx.
 *
 * FOUR OUTCOMES, FOUR MESSAGES. v1 reports all of them as "Successfully invited
 * player" — including `already_member`, where nothing happened at all.
 * Divergence 9.
 *
 * `already_member` is the one that keeps the dialog OPEN: nothing the user
 * wanted actually happened, and the likeliest next action is correcting the
 * address, so closing would make them reopen it. The field is cleared so the
 * next attempt starts fresh.
 */
export function InvitePlayerDialog({
  open,
  onOpenChange,
  teamId,
  teamName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Id<'teams'>, for the reason CurrentTeamCard's own prop gives.
  teamId: Id<'teams'>
  teamName: string
}) {
  const invite = useMutation({ mutationFn: useConvexMutation(api.teams.invitePlayer) })
  const { height, offsetTop } = useVisualViewport()
  // CONTROLLED, unlike /login's and /complete-profile's inputs, and the
  // difference is not an oversight. Those two are rendered into the SSR HTML,
  // so a fast typist can type before hydration and React's first controlled
  // render wipes it (wt-ksh.2.2, and again in Phase 4). Radix unmounts
  // DialogContent while `open` is false, so nothing here exists until the user
  // clicks Invite — which is itself an onClick, and therefore already
  // post-hydration. There is no pre-hydration window to lose input in. Do not
  // "fix" this into an uncontrolled input: submit deliberately CLEARS the field
  // on already_member and deliberately LEAVES it on failure, and neither is
  // expressible without owning the value.
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset on the OPEN transition, matching create-team-dialog.tsx: a failed
  // submit leaves `open` true, so this never clobbers what submit deliberately
  // left on screen.
  useEffect(() => {
    if (!open) return
    setEmail('')
  }, [open])

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const outcome = await invite.mutateAsync({
        teamId,
        email,
        today: toPuzzleDay(new Date()),
      })

      // EXHAUSTIVE, not a chain ending in `else`. Three of the four outcomes
      // carry an `email`, so a fifth InviteOutcome variant that also carried one
      // would fall into a bare else and be announced as "Invite sent to …" —
      // compiling cleanly, and in the one place whose entire purpose is one
      // message per outcome (divergence 9). The `never` assignment below turns
      // that into a compile error instead.
      switch (outcome.status) {
        case 'already_member':
          // The typed address, not a server-normalised one: `already_member`
          // carries no payload, because the server wrote nothing on that path.
          toast.info(`${email} is already on ${teamName}`)
          setEmail('')
          return // deliberately NOT closing — see the doc comment
        case 'added':
          toast.success(`${outcome.firstName} was added to ${teamName}`)
          break
        case 'resent':
          toast.success(`Invite re-sent to ${outcome.email}`)
          break
        case 'invited':
          toast.success(`Invite sent to ${outcome.email}`)
          break
        default: {
          const _exhaustive: never = outcome
          return _exhaustive
        }
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Player invite failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* w-11/12 rounded-lg and the visual-viewport `top` are parity with the
          other team dialogs — see create-team-dialog.tsx for why both are
          load-bearing on a phone. */}
      <DialogContent
        className="w-11/12 rounded-lg overflow-y-auto"
        style={height ? { top: offsetTop + height / 2, maxHeight: height } : undefined}
      >
        {/* NO WRAPPING OR TRUNCATING CLASSES HERE, DELIBERATELY, even though
            this is the only dialog title that embeds the team name.
            __root.tsx's <body> carries `[overflow-wrap:anywhere]`; it inherits,
            and unlike `break-words` it also shrinks min-content, so the grid
            column never widens and a 48-character unbreakable name already
            wraps inside the `w-11/12` box. Measured at 390px: bare title →
            overflow-wrap `anywhere`, dialog scrollWidth 356 == clientWidth 356.
            Adding `min-w-0 break-words` → `break-word`, byte-identical geometry
            and strictly weaker than what is inherited. Only neutralising the
            body rule too → scrollWidth 451 > clientWidth 356, real overflow.

            A `truncate` here is the one thing that genuinely breaks it, because
            its `white-space: nowrap` beats the inherited rule: the grid column
            takes min-content from the whole unwrapped string, DialogHeader is
            `text-center` inside it, and the description, the input and the
            Invite button all land off a 390px screen. An earlier draft of this
            file did exactly that.

            The lasting trap is the measurement, not the CSS: `document.
            scrollWidth` reports no horizontal overflow for anything inside
            DialogContent, because it is `fixed` and Radix locks body scroll
            while a dialog is open. Check the dialog's own scrollWidth. */}
        <DialogHeader>
          <DialogTitle>Invite Player to {teamName}</DialogTitle>
          <DialogDescription>Enter the player&apos;s email address</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div className="space-y-2">
            {/* type="email" + required is v1's markup, kept: it gets the @ key
                on a phone keyboard and catches the obvious typo without a round
                trip. It is NOT the same rule as the server's — the HTML5
                validator accepts a dotless domain ('a@b') that
                normaliseInviteEmail rejects — so INVALID_EMAIL is still
                reachable from this form, not merely defence in depth. */}
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" variant="secondary" disabled={submitting} aria-disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
