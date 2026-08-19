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
      <DialogContent className="w-11/12 rounded-lg">
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
