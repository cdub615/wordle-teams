import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { Badge } from '#/components/ui/badge.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table.tsx'
import { ScoringSystemEditor } from '#/components/scoring-system-editor.tsx'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import type { Id } from '../../convex/_generated/dataModel'
import type { ScoringSystem } from '../../convex/lib/scoring.ts'

/**
 * Points awarded by attempts, FOR THE MONTH CURRENTLY BEING VIEWED.
 *
 * wordle-teams-1j3: a scoring change applies from the month it is made, and
 * past months keep the values they were played under. This card is where you
 * see which version applied — it reads the same resolved system the scores
 * table computes with, so the two can never disagree.
 *
 * Customize is hidden when viewing a past month (there is nothing to edit — a
 * past month's rules are settled), when the viewer is not pro, and when they
 * did not create the team. The first is a correctness rule; the other two are
 * v1's gates, and like v1's they are UI-only.
 */
const ROWS: Array<{ label: string; field: keyof ScoringSystem }> = [
  { label: '1', field: 'oneGuess' },
  { label: '2', field: 'twoGuesses' },
  { label: '3', field: 'threeGuesses' },
  { label: '4', field: 'fourGuesses' },
  { label: '5', field: 'fiveGuesses' },
  { label: '6', field: 'sixGuesses' },
  { label: 'X', field: 'failed' },
  // NOT "0" as v1 labels it, and not "N/A". The schema field is nA, which is a
  // misnomer: it is what an unplayed day before today scores, and has nothing
  // to do with the N/A shown for weekends on a no-weekends team.
  { label: 'Missed day', field: 'nA' },
]

function formatEffectiveFrom(month: string): string {
  const [year, monthNum] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(
    new Date(year, monthNum - 1, 1),
  )
}

export function ScoringSystemCard({
  teamId,
  month,
  isPro,
  isCreator,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  isPro: boolean
  isCreator: boolean
  className?: string
}) {
  const hydrated = useHydrated()
  const [open, setOpen] = useState(false)
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { system, systemEffectiveFrom } = data.team

  // Reading the clock is safe only after hydration — the server is UTC and the
  // viewer is not, and they disagree on the first and last days of a month.
  // Before hydration, assume the month is current, which hides nothing.
  const isCurrentMonth = hydrated ? month === monthOf(toPuzzleDay(new Date())) : true
  const canEdit = isCurrentMonth && isPro && isCreator

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle asChild>
          <div className="flex items-center justify-between">
            <h2>Scoring System</h2>
            {canEdit && (
              <Button
                size="icon"
                variant="outline"
                aria-label="Customize scoring system"
                onClick={() => setOpen(true)}
              >
                <Settings2 size={24} />
              </Button>
            )}
          </div>
        </CardTitle>
        <CardDescription>Points awarded by number of attempts</CardDescription>
        {systemEffectiveFrom && (
          <Badge variant="secondary">In effect from {formatEffectiveFrom(systemEffectiveFrom)}</Badge>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Attempts</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => (
              <TableRow key={row.field}>
                <TableCell>{row.label}</TableCell>
                <TableCell className="text-right tabular-nums">{system[row.field]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {canEdit && (
        <ScoringSystemEditor open={open} onOpenChange={setOpen} teamId={teamId} system={system} />
      )}
    </Card>
  )
}
