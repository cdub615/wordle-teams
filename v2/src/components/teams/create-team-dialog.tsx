import { useState } from 'react'
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
import { Switch } from '#/components/ui/switch.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'

/**
 * Create a team. Ports v1's create-team.tsx: name, Play Weekends, Show Letters,
 * both switches defaulting on.
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

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      const teamId = await create.mutateAsync({ name, playWeekends, showLetters })
      toast.success('Successfully created team')
      setName('')
      setPlayWeekends(true)
      setShowLetters(true)
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Team</DialogTitle>
          <DialogDescription>
            Enter your team&apos;s name and select desired team settings
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div className="flex flex-col space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                required
                className="w-48 md:w-80"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="create-play-weekends">Play Weekends</Label>
              <Switch
                id="create-play-weekends"
                checked={playWeekends}
                onCheckedChange={setPlayWeekends}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="create-show-letters">Show Letters in Completed Boards</Label>
              <Switch
                id="create-show-letters"
                checked={showLetters}
                onCheckedChange={setShowLetters}
              />
            </div>
          </div>
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
