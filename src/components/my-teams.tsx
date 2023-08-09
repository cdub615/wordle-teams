import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AppContext from '@/lib/app-context'
import { Settings2 } from 'lucide-react'
import { useContext } from 'react'
import { Button } from './ui/button'

const MyTeams = () => {
  const appContext = useContext(AppContext)
  const { teams } = appContext
  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>My Teams</div>
            <Button size={'icon'} variant={'outline'}>
              <Settings2 size={24} />
            </Button>
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
