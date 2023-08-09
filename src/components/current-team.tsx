import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AppContext from '@/lib/app-context'
import { Settings2 } from 'lucide-react'
import { useContext } from 'react'
import { Button } from './ui/button'

const CurrentTeam = () => {
  const appContext = useContext(AppContext)
  const { selectedTeam } = appContext
  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>{selectedTeam.name}</div>
            <Button size={'icon'} variant={'outline'}>
              <Settings2 size={24} />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col space-y-2'>
          {selectedTeam.players.map((player) => (
            <li key={player.name}>
              <div>{player.name}</div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export default CurrentTeam
