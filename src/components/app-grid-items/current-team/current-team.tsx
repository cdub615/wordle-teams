import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { players, teams } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { UserPlus2 } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

type CurrentTeamData = {
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
    team,
    players: players ?? [],
    canInvite: team?.creator === userId,
  }
}

export default async function CurrentTeam({ teamId }: { teamId: number }) {
  const { team, players, canInvite } = await getCurrentTeam(teamId)

  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>{team?.name}</div>
            {canInvite && (
              <Link href={`/invite-player/${teamId}`}>
                <Button size={'icon'} variant={'outline'}>
                  <UserPlus2 size={22} />
                </Button>
              </Link>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col space-y-2'>
          {players.map((player) => (
            <li key={player.id}>
              <div>
                {player.first_name} {player.last_name}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
