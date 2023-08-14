import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AppContext from '@/lib/app-context'
import { useContext } from 'react'

const MyTeams = () => {
  const { teams } = useContext(AppContext)
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

export default MyTeams
