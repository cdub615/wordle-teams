'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTeams } from '@/lib/contexts/teams-context'
import { defaultSystem } from '@/lib/types'
import { CustomizeButton } from './customize-button'

export type Score = {
  attempts: number
  points: number
}

export default function ScoringSystem({ proMember, classes }: { proMember: boolean; classes?: string }) {
  const { teams, teamId, user } = useTeams()
  const team = teams.find((t) => t.id === teamId)
  const scoringSystem = team?.scoringSystem || defaultSystem
  const scores: Score[] = []
  scoringSystem.forEach((entry) => scores.push({ attempts: entry[0], points: entry[1] }))

  return (
    <Card className={classes}>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>Scoring System</div>
            {proMember && /*user.id === team?.creator &&*/ <CustomizeButton scores={scores} />}
          </div>
        </CardTitle>
        <CardDescription>Points awarded by number of attempts</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Attempts</TableHead>
              <TableHead>Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scores.map((score: Score) => (
              <TableRow key={score.attempts}>
                <TableCell>{score.attempts === 7 ? 'X' : score.attempts === 0 ? 'N/A' : score.attempts}</TableCell>
                <TableCell>{score.points}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
