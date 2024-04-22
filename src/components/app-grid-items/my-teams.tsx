'use client'

import { deleteTeam } from '@/app/me/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useTeams } from '@/lib/contexts/teams-context'
import { Loader2, Trash2 } from 'lucide-react'
import { MouseEventHandler, useState } from 'react'
import { toast } from 'sonner'
import {cn} from '@/lib/utils'

export default function MyTeams({ userId }: { userId: string }) {
  const { teams, setTeams, teamId, setTeamId } = useTeams()
  const [pendingTeamId, setPendingTeamId] = useState(0)
  const handleClick: MouseEventHandler<HTMLButtonElement> = async (e) => {
    e.preventDefault()
    const teamIdToDelete = Number.parseInt(e.currentTarget.id)
    setPendingTeamId(teamIdToDelete)
    const result = await deleteTeam(e.currentTarget.id)
    if (result.success) {
      const newTeams = teams.filter((t) => t.id !== teamIdToDelete)
      setTeams(newTeams)
      if (teamIdToDelete === teamId) setTeamId(newTeams[0]?.id)
      toast.success(result.message)
    } else toast.error(result.message)
    setPendingTeamId(0)
  }
  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>My Teams</div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col space-y-2'>
          {teams.map((team, index) => (
            <li key={team.name}>
              <div className={cn('grid items-center', team.creator === userId ? 'grid-cols-[minmax(0,1fr)_3rem_minmax(0,2fr)]' : 'grid-cols-[minmax(0,1fr)_minmax(0,2fr)]')}>
                <div>{team.name}</div>
                {team.creator === userId && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant={'ghost'}>
                        <Trash2 size={16} className='text-red-500' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='w-auto'>
                      <div className='flex flex-col space-y-4'>
                        <div>Delete {team.name}?</div>
                        <Button
                          variant={'destructive'}
                          size='sm'
                          disabled={pendingTeamId === team.id}
                          aria-disabled={pendingTeamId === team.id}
                          onClick={handleClick}
                          id={`${team.id}`}
                        >
                          {pendingTeamId === team.id && <Loader2 className='h-4 w-4 mr-2 animate-spin' />}
                          Delete
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                <ul>
                  {team.players.map((player) => (
                    <li key={player.fullName} className='flex justify-end'>
                      <span>{player.firstName}</span>
                      <span className='invisible w-0 md:visible md:w-fit'>&nbsp;{`${player.lastName}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {index < teams.length - 1 && <Separator className='mt-2' />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
