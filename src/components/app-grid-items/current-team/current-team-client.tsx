'use client'

import { removePlayer } from '@/app/me/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useTeams } from '@/lib/contexts/teams-context'
import { Loader2, Settings, Trash2, UserPlus2 } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import InvitePlayer from './invite-player'
import UpdateTeam from './update-team'

export default function CurrentTeamClient({ userId }: { userId: string }) {
  const { teams, teamId, setTeams } = useTeams()
  const [team, setTeam] = useState(teams.find((t) => t.id === teamId)!)
  const [pending, setPending] = useState(false)
  const canInvite = team?.creator === userId
  const playerIds = team?.players.map((p) => p.id)

  useEffect(() => {
    setTeam(teams.find((t) => t.id === teamId)!)
  }, [teamId, teams])

  const handleSubmit = async (event: FormEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setPending(true)
    const form = document.getElementById('remove-player-form') as HTMLFormElement
    const formData = new FormData(form)
    const playerId = formData.get('playerId') as string
    const result = await removePlayer(formData)
    if (result.success) {
      const updatedTeams = teams.map((t) => {
        if (t.id === teamId) t.removePlayer(playerId)
        return t
      })
      setTeams(updatedTeams)
      toast.success(result.message)
    } else toast.error(result.message)
    setPending(false)
  }

  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>{team?.name}</div>
            {canInvite && (
              <div className='flex gap-2'>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size={'icon'} variant={'outline'} aria-label='Update team'>
                      <Settings size={22} />
                    </Button>
                  </DialogTrigger>
                  <UpdateTeam />
                </Dialog>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button size={'icon'} variant={'outline'} aria-label='Invite player'>
                      <UserPlus2 size={22} />
                    </Button>
                  </DialogTrigger>
                  <InvitePlayer />
                </Dialog>
              </div>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col space-y-2'>
          {team?.players.map((player, index) => (
            <li key={player.id} className='flex flex-col justify-between items-center'>
              <div className='flex w-full justify-between items-center'>
                <div>
                  {player.firstName} {player.lastName}
                </div>
                {canInvite && player.id !== userId && (
                  <form id='remove-player-form'>
                    <input type='hidden' name='playerIds' value={playerIds} />
                    <input type='hidden' name='playerId' value={player.id} />
                    <input type='hidden' name='teamId' value={teamId} />
                    <Popover>
                      <PopoverTrigger>
                        <Button variant={'ghost'} type='button' aria-label='Remove player'>
                          <Trash2 size={16} className='text-red-500' />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className='w-auto'>
                        <div className='flex flex-col space-y-4'>
                          <div>Remove player from {team.name}?</div>
                          <Button
                            type='button'
                            variant={'destructive'}
                            aria-disabled={pending}
                            disabled={pending}
                            onClick={handleSubmit}
                          >
                            {pending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                            Remove
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </form>
                )}
              </div>
              {index < team?.players.length - 1 && <Separator className='mt-2' />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
