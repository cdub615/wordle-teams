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
import { Switch } from '#/components/ui/switch.tsx'
import { mutationErrorMessage } from '#/lib/convex-error.ts'
import { toPuzzleDay } from '../../../convex/lib/puzzleDay.ts'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * Rename a team and set its two flags. Ports v1's update-team.tsx.
 *
 * Turning Play Weekends off re-scores every month the team has a winner row
 * for — weekends stop contributing to any total — so the mutation recomputes.
 * That is server-side; nothing here has to know about it.
 */
export function UpdateTeamDialog({
  open,
  onOpenChange,
  team,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  team: { id: string; name: string; playWeekends: boolean; showLetters: boolean }
}) {
  const update = useMutation({ mutationFn: useConvexMutation(api.teams.updateTeam) })
  const [name, setName] = useState(team.name)
  const [playWeekends, setPlayWeekends] = useState(team.playWeekends)
  const [showLetters, setShowLetters] = useState(team.showLetters)
  const [submitting, setSubmitting] = useState(false)

  // Re-seed on OPEN, when the selected team changes underneath an open dialog,
  // and when a live update changes the settings from another browser.
  //
  // `open` is in the deps for the same reason CreateTeamDialog resets on open:
  // this component is mounted unconditionally — only Radix's Dialog.Content
  // toggles — so a cancelled edit would otherwise survive and come back on the
  // next open looking like the team's real settings. Without `open`, none of
  // the other deps change on a cancel-then-reopen, so nothing would re-seed.
  useEffect(() => {
    setName(team.name)
    setPlayWeekends(team.playWeekends)
    setShowLetters(team.showLetters)
  }, [open, team.id, team.name, team.playWeekends, team.showLetters])

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    try {
      await update.mutateAsync({
        teamId: team.id as Id<'teams'>,
        name,
        playWeekends,
        showLetters,
        today: toPuzzleDay(new Date()),
      })
      toast.success('Successfully updated team')
      onOpenChange(false)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Team update failed, please try again'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* w-11/12 rounded-lg matches v1. shadcn's DialogContent default is
          `w-full max-w-lg ... sm:rounded-lg`, so below 640px it is
          edge-to-edge AND square-cornered. Both of v1's team dialogs
          override it the same way. Caught on a phone screenshot. */}
      <DialogContent className="w-11/12 rounded-lg">
        <DialogHeader>
          <DialogTitle>Update Team</DialogTitle>
          <DialogDescription>
            Enter your team&apos;s name and select desired team settings
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div className="flex flex-col space-y-4 py-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="update-team-name">Team Name</Label>
              <Input
                id="update-team-name"
                required
                className="w-48 md:w-80"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="update-play-weekends">Play Weekends</Label>
              <Switch
                id="update-play-weekends"
                checked={playWeekends}
                onCheckedChange={setPlayWeekends}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="update-show-letters">Show Letters in Completed Boards</Label>
              <Switch
                id="update-show-letters"
                checked={showLetters}
                onCheckedChange={setShowLetters}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" variant="secondary" disabled={submitting} aria-disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
