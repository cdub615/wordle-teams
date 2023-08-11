import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import AppContext from '@/lib/app-context'
import { Settings2 } from 'lucide-react'
import { useContext } from 'react'
import { Button } from './ui/button'

type Score = {
  attempts: number
  points: number
}

const ScoringSystem = ({ classes }: { classes?: string }) => {
  const {
    selectedTeam: { scoringSystem },
  } = useContext(AppContext)
  const scores: Score[] = []
  scoringSystem.forEach((entry) => {
    scores.push({ attempts: entry[0], points: entry[1] })
  })

  return (
    <Card className={classes}>
      <CardHeader>
        <CardTitle>
          <div className='flex justify-between'>
            <div>Scoring System</div>
            <Button size={'icon'} variant={'outline'}>
              <Settings2 size={24} />
            </Button>
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
