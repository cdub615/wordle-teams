import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { cn } from '#/lib/utils.ts'
import { MIN_LEAGUE_BOARDS } from '../../../convex/lib/league.ts'
import { fromPuzzleDay, type PuzzleMonth } from '../../../convex/lib/puzzleDay.ts'

type Row = { groupId: string; rank: number | null; average: number | null; boards: number; contributors: number }

type Props = {
  month: PuzzleMonth
  groups: { _id: string; name: string }[]
  standings: Row[]
  myGroupId: string | null
  lastMonth: { month: PuzzleMonth; winnerGroupId: string | null } | null
  monthsWon: { groupId: string; count: number }[]
  className?: string
}

const longMonth = new Intl.DateTimeFormat('en-US', { month: 'long' })

/** 'YYYY-MM' -> 'October'. fromPuzzleDay is local noon, so no timezone rolls it back a month. */
export function monthName(month: PuzzleMonth): string {
  return longMonth.format(fromPuzzleDay(`${month}-01`))
}

/**
 * The standings table (spec §8.2). GROUP TOTALS ONLY: nothing here names a
 * player, and nothing may — strangers see groups, never people (§3.2).
 */
export function LeagueStandings({ month, groups, standings, myGroupId, lastMonth, monthsWon, className }: Props) {
  const nameOf = (id: string) => groups.find((g) => g._id === id)?.name ?? ''
  const tally = monthsWon.filter((m) => m.count > 0).sort((a, b) => b.count - a.count)
  return (
    <Card className={className} role="region" aria-label="Standings">
      <CardHeader>
        <CardTitle asChild>
          <h2>{monthName(month)}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="flex flex-col divide-y">
          {standings.map((row) => {
            const name = nameOf(row.groupId)
            const mine = row.groupId === myGroupId
            return (
              <li
                key={row.groupId}
                data-testid={`standing-${name}`}
                aria-current={mine ? 'true' : undefined}
                className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 py-2', mine && 'font-semibold')}
              >
                <span className="w-5 text-right tabular-nums text-muted-foreground">{row.rank ?? '–'}</span>
                <span className="font-mono tracking-widest">{name}</span>
                {mine && <span className="text-xs text-muted-foreground">you</span>}
                <span className="ml-auto text-right tabular-nums">
                  {row.average === null ? (
                    <span className="text-muted-foreground">
                      not yet ranked ({row.boards}/{MIN_LEAGUE_BOARDS})
                    </span>
                  ) : (
                    <>
                      {row.average.toFixed(1)}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {row.boards} boards · {row.contributors} played
                      </span>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
        {lastMonth && (
          <p className="text-sm">
            {lastMonth.winnerGroupId
              ? `${monthName(lastMonth.month)} winner: ${nameOf(lastMonth.winnerGroupId)}`
              : `No winner in ${monthName(lastMonth.month)}`}
          </p>
        )}
        {tally.length > 0 && (
          <p data-testid="league-all-time" className="text-sm text-muted-foreground">
            {`All-time: ${tally.map((m) => `${nameOf(m.groupId)} ${m.count}`).join(' · ')}`}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
