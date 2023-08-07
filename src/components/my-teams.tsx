import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Team } from '@/lib/types'

const MyTeams = ({ teams }: { teams: Team[] }) => {
  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>My Teams</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col space-y-2'>
          {teams.map((team) => (
            <li key={team.name} className='flex justify-between'>
              <div>{team.name}</div>
              <ul>
                {team.players.map((player) => (
                  <li key={player.name}>
                    <div>{player.name}</div>
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

export default MyTeams
