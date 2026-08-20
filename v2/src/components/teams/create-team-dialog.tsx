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
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { useVisualViewport } from '#/lib/use-visual-viewport.ts'
import { TeamFields } from './team-fields.tsx'

/**
 * Create a team. Ports v1's create-team.tsx: name, Play Weekends, Show Letters,
 * both switches defaulting on — matching v1's default settings for a brand
 * new team, not a v2 choice.
 *
 * The a335ae8 submit shape Phase 2 ported applies here too — try/catch,
 * setSubmitting(false) in `finally`, and the dialog closes ONLY on success, so
 * a failed create never discards what was typed.
 */
export function CreateTeamDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (teamId: string) => void
}) {
  const create = useMutation({ mutationFn: useConvexMutation(api.teams.createTeam) })
  const { height, offsetTop } = useVisualViewport()
  const [name, setName] = useState('')
  const [playWeekends, setPlayWeekends] = useState(true)
  const [showLetters, setShowLetters] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // The dialog is mounted unconditionally by the caller — only Dialog.Content
  // toggles with `open` — so this state would otherwise survive a Cancel/Escape
  // and show a stale draft on reopen. Resetting on the OPEN transition, not on
  // close, is deliberate: a failed submit leaves `open` true (see the catch
  // branch below), so it never runs this effect and never clobbers the values
  // that submit intentionally left on screen.
  useEffect(() => {
    if (!open) return
    setName('')
    setPlayWeekends(true)
    setShowLetters(true)
  }, [open])

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const teamId = await create.mutateAsync({ name, playWeekends, showLetters })
      toast.success('Successfully created team')
      onOpenChange(false)
      onCreated(teamId)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Team creation failed, please try again'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        shadcn's default DialogContent is `w-full max-w-lg`, which is
        edge-to-edge with square corners below the `sm` (640px) breakpoint —
        `sm:rounded-lg` never applies. v1 explicitly overrides this on both
        its team dialogs (create-team.tsx, update-team.tsx) with
        `w-11/12 rounded-lg`, so the dialog is inset with visible side
        margins and rounded corners even on a phone. This is parity with
        that shape, not a v2 stylistic choice.
      */}
      {/*
        The Team Name input autofocuses on open (Radix's default), which pulls
        up the keyboard on a phone. Unlike the top Sheet board entry and the
        scoring editor bind their mobile Sheet to, this Dialog is CENTERED at
        every width via shadcn's `top-[50%] translate-y-[-50%]` — so the
        keyboard-aware fix here is not "reposition to top-of-viewport" but
        "keep the centering math anchored to the VISIBLE viewport instead of
        the full layout viewport". iOS Safari does not shrink the layout
        viewport when the keyboard opens, so `top: 50%` centers against the
        pre-keyboard height; with the keyboard open that midpoint can sit
        below the visible area, pushing the footer's Create button under the
        keyboard. Setting `top` to the visible viewport's own midpoint
        (offsetTop + height / 2) keeps `translate-y-[-50%]` centering the
        dialog within what's actually on screen, and `maxHeight` + scroll
        keeps a tall keyboard from clipping the footer outright.
      */}
      <DialogContent
        className="w-11/12 rounded-lg overflow-y-auto"
        style={height ? { top: offsetTop + height / 2, maxHeight: height } : undefined}
      >
        <DialogHeader>
          <DialogTitle>Create Team</DialogTitle>
          <DialogDescription>
            Enter your team&apos;s name and select desired team settings
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <TeamFields
            idPrefix="create"
            name={name}
            onNameChange={setName}
            playWeekends={playWeekends}
            onPlayWeekendsChange={setPlayWeekends}
            showLetters={showLetters}
            onShowLettersChange={setShowLetters}
          />
          <DialogFooter>
            <Button type="submit" variant="secondary" disabled={submitting} aria-disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
