import { invitePlayer } from '@/app/me/actions'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useTeams } from '@/lib/contexts/teams-context'
import { DialogClose } from '@radix-ui/react-dialog'
import { FormEvent } from 'react'
import { toast } from 'sonner'
import SubmitButton from '../../submit-button'

export default function InvitePlayer() {
  const { teams, teamId } = useTeams()
  const team = teams.find((t) => t.id === teamId)!
  const playerIds = team.players.map((p) => p.id)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const result = await invitePlayer(formData)

    if (result.success) toast.success(result.message)
    else toast.error(result.message)
    document.getElementById('close-invite-player')?.click()
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Invite Player to {team.name}</DialogTitle>
        <DialogDescription>Enter player's email address</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className='w-full space-y-6'>
        <Input type='email' name='email' required />
        <input hidden name='teamId' value={teamId} />
        <input hidden name='teamName' value={team.name} />
        <input hidden name='playerIds' value={playerIds} />
        <input hidden name='invited' value={team.invited} />
        <DialogFooter>
          <DialogClose id='close-create-team' />
          <div className='flex justify-end space-x-4'>
            <SubmitButton label='Invite' />
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
