import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import AppContext from '@/lib/app-context'
import { useContext, useMemo } from 'react'

const CurrentMonthScores = () => {
  const appContext = useContext(AppContext)
  const team = appContext?.selectedTeam
  const selectedMonth = appContext?.selectedMonth
  if (team && selectedMonth) {
    const month = useMemo(() => selectedMonth, [selectedMonth])
    const sorted = !!team.players
      ? team.players.sort(
          (a, b) =>
            a.aggregateScoreByMonth(month, team.playWeekends, team.scoringSystem) +
            b.aggregateScoreByMonth(month, team.playWeekends, team.scoringSystem)
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
                <div>{player.aggregateScoreByMonth(month, team?.playWeekends, team.scoringSystem)}</div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    )
  }
}

export default CurrentMonthScores
