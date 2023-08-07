import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Team } from '@/lib/types'

const CurrentMonthScores = ({ team }: { team: Team }) => {
  const today = new Date()
  const sorted = !!team.players
    ? team.players.sort(
        (a, b) =>
          a.aggregateScoreByMonth(today, team.playWeekends, team.scoringSystem) +
          b.aggregateScoreByMonth(today, team.playWeekends, team.scoringSystem)
      )
    : []

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
              <div>{player.aggregateScoreByMonth(today, team.playWeekends, team.scoringSystem)}</div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export default CurrentMonthScores
