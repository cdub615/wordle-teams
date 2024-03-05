'use client'

import SubmitButton from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
            <li key={player.id} className='flex justify-between items-center'>
              <div className='flex justify-between items-center'>
                <div>
                  {player.firstName} {player.lastName}
                </div>
                {/* TODO add tooltips for the buttons and open an alert dialog for deletion
              the tooltip might be interfering with the submit button pending state,
              maybe just have the alert dialog where we'll have a working submit button */}
                {canInvite && player.id !== userId && (
                  <form action={removePlayer}>
                    <input type='hidden' name='playerIds' value={playerIds} />
                    <input type='hidden' name='playerId' value={player.id} />
                    <input type='hidden' name='teamId' value={teamId} />
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger>
                          <SubmitButton variant={'ghost'}>
                            <Trash2 size={16} className='text-red-500' />
                          </SubmitButton>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Remove Player</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </form>
                )}
              </div>
              {index < team?.players.length - 1 && <Separator />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
