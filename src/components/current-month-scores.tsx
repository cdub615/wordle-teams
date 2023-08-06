import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { players } from '@/lib/data'

const CurrentMonthScores = () => {
  const today = new Date()
  const sorted = players.sort((a, b) => a.aggregateScoreByMonth(today) + b.aggregateScoreByMonth(today))

  return (
    <Card className='h-fit'>
      <CardHeader>
        <CardTitle>Current Month</CardTitle>
        <CardDescription>Total scores by player for this month</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className='flex flex-col space-y-2'>
          {sorted.map((player) => (
            <li key={player.name} className='flex justify-between'>
              <div>{player.name}</div>
              <div>{player.aggregateScoreByMonth(today)}</div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export default CurrentMonthScores
