'use client'

import SubmitButton from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useTeams } from '@/lib/contexts/teams-context'
import { Trash2, UserPlus2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { removePlayer } from './actions'
import InvitePlayer from './invite-player'

export default function CurrentTeamClient({ userId }: { userId: string }) {
  const { teams, teamId } = useTeams()
  const [team, setTeam] = useState(teams.find((t) => t.id === teamId))
  const canInvite = team?.creator === userId
  const playerIds = team?.players.map((p) => p.id)

  useEffect(() => {
    setTeam(teams.find((t) => t.id === teamId))
  }, [teamId, teams])

  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>{team?.name}</div>
            {canInvite && (
              <Dialog>
                <DialogTrigger>
                  <Button size={'icon'} variant={'outline'}>
                    <UserPlus2 size={22} />
                  </Button>
                </DialogTrigger>
                <InvitePlayer />
              </Dialog>
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
                    // TODO fix this form submit it ain't workin
                    <form action={removePlayer}>
                      <input type='hidden' name='playerIds' value={playerIds} />
                      <input type='hidden' name='playerId' value={player.id} />
                      <input type='hidden' name='teamId' value={teamId} />
                      <Popover>
                        <PopoverTrigger>
                          <Button variant={'ghost'} type='button'>
                            <Trash2 size={16} className='text-red-500' />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className='w-auto'>
                          <div className='flex flex-col space-y-4'>
                            <div>Remove player from {team.name}?</div>
                            <SubmitButton variant={'destructive'} label='Remove' />
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
