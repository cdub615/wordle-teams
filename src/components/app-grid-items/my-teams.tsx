import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { Team, players, teams } from '@/lib/types'
import { playerIdsFromTeams } from '@/lib/utils'
import { cookies } from 'next/headers'

type MyTeamsData = {
  teams: teams[]
  players: players[]
}

const getMyTeams = async (): Promise<MyTeamsData> => {
  const supabase = createClient(cookies())
  const { data: teams } = await supabase.from('teams').select('*')
  const playerIds = playerIdsFromTeams(teams ?? [])
  const { data: players } = await supabase.from('players').select('*').in('id', playerIds)
  return { teams: teams ?? [], players: players ?? [] }
}

export default async function MyTeams() {
  const { teams: dbTeams, players } = await getMyTeams()

  const teams = dbTeams.map((t) => {
    const teamPlayers = players.filter((p) => t.player_ids.includes(p.id))
    return Team.prototype.fromDbTeam(t, teamPlayers)
  })
  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>My Teams</div>
            {/* <Button size={'icon'} variant={'outline'}>
              <Settings2 size={24} />
            </Button> */}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col space-y-2'>
          {teams.map((team) => (
            <li key={team.name} className='flex justify-between'>
              <div>{team.name}</div>
              <ul>
                {team.players.map((player) => (
                  <li key={player.fullName}>
                    <div className='text-right'>{player.fullName}</div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
