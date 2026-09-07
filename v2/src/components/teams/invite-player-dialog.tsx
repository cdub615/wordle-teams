import { useEffect, useState } from 'react'
import { Loader2, Share2 } from 'lucide-react'
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
import { Separator } from '#/components/ui/separator.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { useVisualViewport } from '#/lib/use-visual-viewport.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Invite someone by email. Ports v1's invite-player.tsx.
 *
 * FIVE OUTCOMES, FIVE MESSAGES. v1 reports all of them as "Successfully invited
 * player" — including `already_member`, where nothing happened at all.
 * Divergence 9. (Four when this was written; `parked_at_cap` is Phase 5's, and
 * it is the second one v1 reports as a success while nobody joins anything.)
 *
 * `already_member` is the one that keeps the dialog OPEN: nothing the user
 * wanted actually happened, and the likeliest next action is correcting the
 * address, so closing would make them reopen it. The field is cleared so the
 * next attempt starts fresh.
 *
 * THE SECOND PATH, ADDED BESIDE THE FIRST AND NOT INSTEAD OF IT. Typing an
 * address is still the right tool when you know the address; it is a terrible
 * one when you do not, and this app's traffic is heavily iPhone. Six of the
 * eight most recently created production teams invited nobody at all. So there
 * is now a "Share a link" half below the form, which mints a token
 * (convex/inviteLinks.ts createLink) and hands the URL to the platform.
 *
 * BOTH BROWSER APIS ARE FEATURE-DETECTED, AND THIS IS THE APP'S FIRST USE OF
 * EITHER — neither `navigator.share` nor `navigator.clipboard` appears anywhere
 * else in src/. `navigator.share` is absent on most desktop browsers, and BOTH
 * are absent outside a secure context, which is not a hypothetical: an http://
 * LAN address is how this app gets opened on a real phone during development.
 * See shareLink for what each absence does.
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
  const createLink = useMutation({ mutationFn: useConvexMutation(api.inviteLinks.createLink) })
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
  // The link half's own two pieces of state. `sharing` is the mutation's, held
  // locally rather than read off `createLink.isPending` for parity with
  // `submitting` above; `copied` is the only lasting confirmation the clipboard
  // path leaves, since a toast is gone in seconds and the share sheet — the
  // path that does NOT set it — gives its own feedback.
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  // Reset on the OPEN transition, matching create-team-dialog.tsx: a failed
  // submit leaves `open` true, so this never clobbers what submit deliberately
  // left on screen.
  useEffect(() => {
    if (!open) return
    setEmail('')
    // `copied` is reset here too, or a second visit opens on a stale "Link
    // copied" for a link minted minutes ago. Nothing below ever clears it.
    setCopied(false)
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

      // EXHAUSTIVE, not a chain ending in `else`. Four of the five outcomes
      // carry an `email`, so a sixth InviteOutcome variant that also carried one
      // would fall into a bare else and be announced as "Invite sent to …" —
      // compiling cleanly, and in the one place whose entire purpose is one
      // message per outcome (divergence 9). The `never` assignment below turns
      // that into a compile error instead.
      //
      // THIS ALREADY PAID FOR ITSELF. Phase 5's `parked_at_cap` is the fifth,
      // and it carries an `email`; the `never` assignment is what stopped the
      // build until a message for it existed, exactly as described above.
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
        case 'parked_at_cap':
          // NOT toast.success, and not toast.error either. The address WAS
          // parked, so something happened and the dialog closes — but nobody
          // joined the team and nobody was mailed, so calling it a success is
          // the exact lie divergence 9 exists to stop. `info` is what
          // already_member uses, for the same "this is not what you wanted"
          // reason.
          //
          // outcome.email, not the typed `email`: the server parked the
          // normalised address, and that is the string the owner will see in
          // their pending list.
          toast.info(
            `${outcome.email} is already on the maximum number of teams for a free account. They'll join ${teamName} automatically if they upgrade.`,
          )
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

  /**
   * Mint a link and hand it to the platform.
   *
   * navigator.share FIRST, WHERE IT EXISTS, AND THAT ORDER IS THE POINT. This
   * is a phone-first action and the native sheet — Messages, WhatsApp, the
   * group chat the team already lives in — is the whole reason a link beats
   * typing an address. The clipboard is the FALLBACK, for the desktop browsers
   * that have no share sheet at all. Reversing them would technically work and
   * would throw away the feature's reason for existing.
   *
   * AN AbortError IS NOT A FAILURE. It is what both APIs throw when the user
   * dismisses the share sheet, which is a decision they made on purpose. An
   * error toast for it would tell somebody who just changed their mind that the
   * app is broken.
   *
   * THE CLIPBOARD IS FEATURE-DETECTED TOO, not merely called. `navigator.
   * clipboard` is `undefined` outside a secure context, so on an http:// LAN
   * address — how this app is opened on a real phone in development — the bare
   * call is a TypeError that lands in the catch below and reports "Could not
   * create an invite link" about a link that was created successfully. The
   * explicit branch says the true thing and points at the email field, which is
   * two inches up the same dialog and still works.
   *
   * NOT `void createLink.mutateAsync(...)`: a rejecting mutation with nothing
   * attached is an unhandled rejection. This is the try/catch-and-toast shape
   * notifications-tab.tsx:213 and my-teams-card.tsx:50 use.
   */
  const shareLink = async () => {
    setSharing(true)
    try {
      const token = await createLink.mutateAsync({ teamId })
      const url = `${window.location.origin}/join/${token}`
      if (navigator.share) {
        await navigator.share({ title: `Join ${teamName} on Wordle Teams`, url })
        return
      }
      if (!navigator.clipboard) {
        toast.error('This browser cannot copy the link. Invite by email above instead.')
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Invite link copied')
    } catch (error) {
      // An AbortError is the user dismissing the share sheet, which is not a
      // failure and must not raise a toast.
      if (error instanceof Error && error.name === 'AbortError') return
      toast.error(mutationErrorMessage(error, 'Could not create an invite link'))
    } finally {
      setSharing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The visual-viewport `top` is parity with the other team dialogs — see
          create-team-dialog.tsx for why it is load-bearing on a phone. The
          `w-11/12 rounded-lg` that used to sit beside it is ui/dialog.tsx's
          default now (wordle-teams-2uet); the `w-11/12` box the comment below
          measures against is therefore still the box this renders in. */}
      <DialogContent
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
        {/* OUTSIDE THE <form>, DELIBERATELY. Inside it this button would need
            `type="button"` to avoid submitting the email field on every tap, and
            a control that silently depends on one attribute for correctness is
            the kind of thing an edit deletes. It carries `type="button"` anyway
            — ui/button.tsx renders a bare <button>, whose default type is
            "submit", and a future wrapper <form> would resurrect exactly that
            bug. */}
        <div className="w-full space-y-2">
          <Separator />
          <p className="text-sm font-medium">Or share a link</p>
          <p className="text-muted-foreground text-sm">
            {/* "a week" rather than a number of days: LINK_TTL_MS lives in
                convex/inviteLinks.ts:10 and nothing makes this copy follow it,
                so the vaguer sentence is the one that stays true if it moves. */}
            Anyone with the link can join {teamName}. It stops working after a week.
          </p>
          {/* VISIBLE TEXT, NOT AN ICON ALONE, AND THAT IS wordle-teams-390.
              v1's OAuth buttons were icon-only with their labels available only
              in a hover Tooltip; a Tooltip does not open on tap, the login
              traffic is heavily iPhone, and login conversion sat around 7%. The
              icon here is decoration beside a real label — next-step-card.tsx's
              dismiss button carries the same note. */}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={sharing}
            aria-disabled={sharing}
            onClick={shareLink}
          >
            {sharing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Share2 className="mr-2 h-4 w-4" />
            )}
            Share a link
          </Button>
          {copied && (
            <p className="text-muted-foreground text-sm">Link copied to your clipboard.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
