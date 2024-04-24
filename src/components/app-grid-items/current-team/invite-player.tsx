import { invitePlayer } from '@/app/me/actions'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useTeams } from '@/lib/contexts/teams-context'
import { Player } from '@/lib/types'
import { DialogClose } from '@radix-ui/react-dialog'
import { Loader2 } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { toast } from 'sonner'

export default function InvitePlayer() {
  const [pending, setPending] = useState(false)
  const { teams, teamId, setTeams } = useTeams()
  const team = teams.find((t) => t.id === teamId)
  const playerIds = team?.players?.map((p) => p.id)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    const formData = new FormData(event.currentTarget)
    const result = await invitePlayer(formData)

    // if (result.success) {
    //   if (result.invitedPlayer) {
    //     const newPlayer = Player.prototype.fromDbPlayer(
    //       result.invitedPlayer,
    //       result.invitedPlayer?.daily_scores ?? []
    //     )
    //     const updatedTeams = teams.map((t) => {
    //       if (t.id === teamId) t.addPlayer(newPlayer)
    //       return t
    //     })
    //     setTeams(updatedTeams)
    //   }
    //   toast.success(result.message)
    // } else toast.error(result.message)
    document.getElementById('close-invite-player')?.click()
    setPending(false)
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Invite Player to {team?.name}</DialogTitle>
        <DialogDescription>Enter player&apos;s email address</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className='w-full space-y-6'>
        <Input type='email' name='email' required />
        <input hidden name='teamId' value={teamId} />
        <input hidden name='teamName' value={team?.name} />
        <input hidden name='playerIds' value={playerIds} />
        <input hidden name='invited' value={team?.invited} />
        <DialogFooter>
          <DialogClose id='close-invite-player' />
          <div className='flex justify-end space-x-4'>
            <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending}>
              {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              Invite
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
