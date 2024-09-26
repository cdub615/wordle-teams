import { updateTeam } from '@/app/me/actions'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useTeams } from '@/lib/contexts/teams-context'
import { DialogClose } from '@radix-ui/react-dialog'
import { Loader2 } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'

export default function UpdateTeam() {
  const { teams, setTeams, teamId } = useTeams()
  const [pending, setPending] = useState(false)
  const [team, setTeam] = useState(teams.find((t) => t.id === teamId)!)
  const [name, setName] = useState(team.name)
  const [playWeekends, setPlayWeekends] = useState(team.playWeekends)
  const [showLetters, setShowLetters] = useState(team.showLetters)

  useEffect(() => {
    const newTeam = teams.find((t) => t.id === teamId)!
    setTeam(newTeam)
    setName(newTeam.name)
    setPlayWeekends(newTeam.playWeekends)
    setShowLetters(newTeam.showLetters)
  }, [teamId, teams])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    const formData = new FormData(event.currentTarget)
    const result = await updateTeam(formData)

    if (result.success) {
      const updatedTeams = teams.map((t) => {
        if (t.id === teamId) t.updateTeamName(name).updateShowLetters(showLetters).updatePlayWeekends(playWeekends)
        return t
      })
      setTeams(updatedTeams)
      toast.success(result.message)
    } else toast.error(result.message)
    document.getElementById('close-update-team')?.click()
    setPending(false)
  }
  return (
    <DialogContent className='w-11/12 rounded-lg'>
      <DialogHeader>
        <DialogTitle>Update Team</DialogTitle>
        <DialogDescription>
          Enter your team&apos;s name and select desired team settings
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className='w-full space-y-6'>
        <input type='hidden' name='teamId' value={teamId} />
        <div className='flex flex-col space-y-4 py-4'>
          <div className='flex justify-between items-center'>
            <Label htmlFor='name' className='text-right'>
              Team Name
            </Label>
            <Input name='name' required className='w-48 md:w-80' value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className='flex justify-between items-center'>
            <Label htmlFor='playWeekends'>
              Play Weekends
            </Label>
            <Switch name='playWeekends' checked={playWeekends} onCheckedChange={() => setPlayWeekends(!playWeekends)} />
          </div>
          <div className='flex justify-between items-center'>
            <Label htmlFor='showLetters'>
              Show Letters in Completed Boards
            </Label>
            <Switch name='showLetters' checked={showLetters} onCheckedChange={() => setShowLetters(!showLetters)} />
          </div>
        </div>
        <DialogFooter className='sm:space-x-0'>
          <Button type='submit' variant={'secondary'} aria-disabled={pending} disabled={pending}>
            {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            Update
          </Button>
          <DialogClose id='close-update-team' />
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
