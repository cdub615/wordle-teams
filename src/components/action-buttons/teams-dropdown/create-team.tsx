import { createTeam } from '@/app/me/actions'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useTeams } from '@/lib/contexts/teams-context'
import { Player, Team } from '@/lib/types'
import { DialogClose } from '@radix-ui/react-dialog'
import { Loader2 } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { toast } from 'sonner'

export default function CreateTeam() {
  const { teams, setTeams, teamId, setTeamId } = useTeams()
  const [pending, setPending] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    const formData = new FormData(event.currentTarget)
    const result = await createTeam(formData)

    if (result.success && result.newTeam) {
      const newTeam = Team.prototype.fromDbTeam(result.newTeam)
      if (result.player) {
        const player = Player.prototype.fromDbPlayer(result.player, result.player?.daily_scores ?? [])
        newTeam.addPlayer(player)
      }
      setTeams([...teams, newTeam])
      setTeamId(newTeam.id)
      toast.success(result.message)
    } else toast.error(result.message)
    document.getElementById('close-create-team')?.click()
    setPending(false)
  }
  return (
    <DialogContent className='w-11/12 rounded-lg'>
      <DialogHeader>
        <DialogTitle>Create Team</DialogTitle>
        <DialogDescription>
          Enter your team&apos;s name and specify whether you want to include weekend scores
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className='w-full space-y-6'>
        <div className='flex flex-col space-y-4 py-4'>
          <div className='flex justify-between items-center'>
            <Label htmlFor='name' className='text-right'>
              Team Name
            </Label>
            <Input name='name' required className='w-48 md:w-80' />
          </div>
          <div className='flex justify-between items-center'>
            <Label htmlFor='playWeekends'>
              Play Weekends
            </Label>
            <Switch name='playWeekends' defaultChecked />
          </div>
          <div className='flex justify-between items-center'>
            <Label htmlFor='showLetters'>
              Show Letters in Completed Boards
            </Label>
            <Switch name='showLetters' defaultChecked />
          </div>
        </div>
        <DialogFooter>
          <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending}>
            {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Create
          </Button>
          <DialogClose id='close-create-team' />
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
