import SubmitButton from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createClient } from '@/lib/supabase/server'
import { players, teams } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { Trash2, UserPlus2 } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { removePlayer } from './actions'

type CurrentTeamData = {
  userId: string
  team: teams
  players: players[]
  canInvite: boolean
}

const getCurrentTeam = async (teamId: number): Promise<CurrentTeamData> => {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (!session) redirect('/login')
  const userId = session.user.id
  const { data: team } = await supabase.from('teams').select('*').eq('id', teamId).single()
  if (!team) throw new Error(`Current team not found. Id: ${teamId}`)
  const { data: players } = await supabase
    .from('players')
    .select('*')
    .in('id', team.player_ids ?? [])

  return {
    userId,
    team,
    players: players ?? [],
    canInvite: team?.creator === userId,
  }
}

export default async function CurrentTeam({initials, teamId}: {initials: string; teamId: number}) {
  // TODO read this data from context
  const { userId, team, players, canInvite } = await getCurrentTeam(teamId)
  const playerIds = players.map((p) => p.id)

  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>{team?.name}</div>
            {canInvite && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link href={`/${initials}/invite-player/${teamId}`}>
                      <Button size={'icon'} variant={'outline'}>
                        <UserPlus2 size={22} />
                      </Button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Invite Player</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col space-y-2'>
          {players.map((player) => (
            <li key={player.id} className='flex justify-between'>
              <div>
                {player.first_name} {player.last_name}
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
                        <SubmitButton>
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
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
