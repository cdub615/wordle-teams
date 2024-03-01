import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createClient } from '@/lib/supabase/server'
import { Team, defaultSystem } from '@/lib/types'
import { cookies } from 'next/headers'

const getScoringSystem = async (teamId: number): Promise<number[][]> => {
  // TODO read team from context
  const supabase = createClient(cookies())
  const { data: team } = await supabase.from('teams').select('*').eq('id', teamId).single()
  if (team) return Team.prototype.fromDbTeam(team).scoringSystem
  else throw new Error(`Couldn't find team ${teamId}`)
}
type Score = {
  attempts: number
  points: number
}

const ScoringSystem = async ({ teamId, classes }: { teamId: number; classes?: string }) => {
  // TODO allow score system customization for subscribers
  const scoringSystem = teamId === 0 ? defaultSystem : await getScoringSystem(teamId)
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
            {/* <Button size={'icon'} variant={'outline'}>
              <Settings2 size={24} />
            </Button> */}
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

export default ScoringSystem
