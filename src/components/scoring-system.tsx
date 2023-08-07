import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { defaultSystem } from '@/lib/types'

type Score = {
  attempts: number
  points: number
}

type ScoringSystemProps = {
  teamSystem: number[][]
  classes?: string
}

const ScoringSystem = ({ teamSystem, classes }: ScoringSystemProps) => {
  const scores: Score[] = []
  teamSystem.forEach((entry) => {
    scores.push({ attempts: entry[0], points: entry[1] })
  })

  return (
    <Card className={classes}>
      <CardHeader>
        <CardTitle>Scoring System</CardTitle>
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
                <TableCell>{score.attempts === 7 ? 'X' : score.attempts === 8 ? 'N/A' : score.attempts}</TableCell>
                <TableCell>{score.points}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export default ScoringSystem
