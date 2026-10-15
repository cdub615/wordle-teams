import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { GameId } from '../../convex/lib/games.ts'
import { monthOf, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { ScoringSystem } from '../../convex/lib/scoring.ts'
import { ScoresGrid } from '#/components/scores-table.tsx'
import { cn } from '#/lib/utils.ts'

/**
 * A game's month grid other than Wordle's (wordle-teams-9j7o.3.2).
 *
 * THE MONTH PICKER IS WORDLE'S, so it can offer a month before this game's
 * first play. The server serves only the game's own window
 * (getTeamGameMonth's month gate), so asking for such a month would throw into
 * the dashboard's error boundary. This checks first and shows a notice.
 *
 * Mounted only after the viewer flips the dashboard switch, which is after
 * hydration, so reading the clock during render cannot mismatch the server.
 */
export function GameScoresTable({
  teamId,
  month,
  game,
  myPlayerId,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  game: Exclude<GameId, 'wordle'>
  myPlayerId?: Id<'players'>
  className?: string
}) {
  const { data: inputs } = useSuspenseQuery(convexQuery(api.scores.monthWindow, { teamId, game }))
  const firstMonth = inputs.earliestMonth ?? monthOf(toPuzzleDay(new Date()))
  if (month < firstMonth) {
    return (
      <section className={cn('rounded-md border p-4 text-sm text-muted-foreground', className)}>
        No clue ladder games this month.
      </section>
    )
  }
  return <GameMonthGrid teamId={teamId} month={month} game={game} myPlayerId={myPlayerId} className={className} />
}

function GameMonthGrid({
  teamId,
  month,
  game,
  myPlayerId,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  game: Exclude<GameId, 'wordle'>
  myPlayerId?: Id<'players'>
  className?: string
}) {
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamGameMonth, { teamId, month, game }))
  return (
    <ScoresGrid
      teamId={teamId}
      month={month}
      players={data.players.map((player) => ({
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        days: player.results,
      }))}
      system={data.team.system}
      playWeekends={data.team.playWeekends}
      myPlayerId={myPlayerId}
      className={className}
      footer={<ClueLadderLegend system={data.team.system} />}
    />
  )
}

/** ScoringLegend reads Wordle's month and shows Wordle's X, so this game carries its own line. */
function ClueLadderLegend({ system }: { system: ScoringSystem }) {
  const byClue = [
    system.oneGuess,
    system.twoGuesses,
    system.threeGuesses,
    system.fourGuesses,
    system.fiveGuesses,
    system.sixGuesses,
  ]
  return (
    <p className="text-xs text-muted-foreground">
      {`Points by clue: ${byClue.map((points, i) => `${i + 1}: ${points}`).join(' · ')} · X: ${system.failed} · missed: ${system.nA}`}
    </p>
  )
}
