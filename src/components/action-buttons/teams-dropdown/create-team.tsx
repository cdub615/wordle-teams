import { createTeam } from '@/app/me/actions'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useTeams } from '@/lib/contexts/teams-context'
import { Team } from '@/lib/types'
import { DialogClose } from '@radix-ui/react-dialog'
import { FormEvent } from 'react'
import { toast } from 'sonner'
import SubmitButton from '../../submit-button'

export default function CreateTeam() {
  const { teams, setTeams, teamId, setTeamId } = useTeams()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const result = await createTeam(formData)

    if (result.success && result.newTeam) {
      const newTeam = Team.prototype.fromDbTeam(result.newTeam)
      setTeams([...teams, newTeam])
      if (teamId === -1) setTeamId(newTeam.id)
      toast.success(result.message)
    } else toast.error(result.message)
    document.getElementById('close-create-team')?.click()
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create Team</DialogTitle>
        <DialogDescription>
          Enter your team&apos;s name and specify whether you want to include weekend scores
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className='w-full space-y-6'>
        <div className='grid gap-4 py-4'>
          <div className='grid grid-cols-3 items-center gap-4'>
            <Label htmlFor='name' className='text-right'>
              Team Name
            </Label>
            <Input name='name' className='col-span-2' minLength={2} required />
          </div>
          <div className='grid grid-cols-3 items-center gap-4'>
            <Label htmlFor='playWeekends' className='text-right'>
              Play Weekends
            </Label>
            <Switch name='playWeekends' />
          </div>
        </div>
        <DialogFooter>
          <DialogClose id='close-create-team' />
          <SubmitButton label='Create' />
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
