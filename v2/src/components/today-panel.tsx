import { useState } from 'react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { BoardEntryButton } from '#/components/board-entry/button.tsx'
import { TodayPanelSkeleton } from '#/components/dashboard-skeletons.tsx'
import { Button } from '#/components/ui/button.tsx'
import { useHydrated } from '#/lib/use-hydrated.ts'
import { waitingOnSummary } from '#/lib/waiting-on.ts'
import { displayNamesFor } from '#/lib/display-names.ts'
import { cn } from '#/lib/utils.ts'
import { monthContainsToday, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Id } from '../../convex/_generated/dataModel'

/** At most three names before the disclosure. The design's number, not a guess. */
const NAME_LIMIT = 3

/**
 * "Did I play today", and "who are we waiting on" — the two jobs the month grid
 * answers badly by asking you to locate a cell.
 *
 * NO NEW QUERY. This joins the `getTeamMonth` subscription that the dashboard
 * already fetches for ScoresTable, TeamBoards and ScoringSystemCard, so it
 * costs no round-trip and updates live with them. getTeamMonthFor maps over
 * team.playerIds, so the payload carries EVERY MEMBER, not only those with
 * scores — which is exactly what "who hasn't played" needs and is why no
 * backend change is required.
 *
 * THE HYDRATION HAZARD IS THE REAL TRAP HERE, and it is why this component
 * renders a skeleton rather than a value on the server. "Today" is a
 * client-only fact; scores-table.tsx records the rule and the reason. That
 * table can render a *neutral* pre-hydration state (every day reads "not yet
 * due", which draws blanks rather than wrong values) because today is one
 * detail of a month grid. This panel is ENTIRELY about today — there is no
 * neutral version of it — so guessing would be a guaranteed mismatch, and a
 * mismatch here is a minified React #418 in production.
 *
 * LONG NAMES USE THE TABLE'S RULE, IMPORTED. lib/display-names.ts is shared
 * with scores-table.tsx so the two surfaces cannot call the same person two
 * different things on one screen.
 *
 * CONSTANT HEIGHT AT ANY TEAM SIZE. Team membership is unbounded
 * (FREE_TEAM_LIMIT caps teams per player, not members per team), so nothing
 * here renders one element per member: the count and the bar are fixed, and the
 * name list is capped by waitingOnSummary with the remainder behind a
 * disclosure.
 */
export function TodayPanel({
  teamId,
  month,
  myPlayerId,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  myPlayerId?: Id<'players'>
  className?: string
}) {
  const hydrated = useHydrated()
  const [expanded, setExpanded] = useState(false)
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))

  // Before hydration there is no honest answer — see the note above.
  if (!hydrated) return <TodayPanelSkeleton className={className} />

  const today = toPuzzleDay(new Date())
  // Absent, not empty. A "Today" panel while browsing March is noise.
  if (!monthContainsToday(month, today)) return null

  const { players } = data
  const played = new Set(
    players.filter((p) => p.scores.some((s) => s.puzzleDay === today)).map((p) => p.id),
  )
  // THE SAME COLLISION RULE THE TABLE USES, imported rather than restated: two
  // Adas on a team must not both read as "Ada" in a "waiting on" line that the
  // table below disambiguates.
  const displayNames = displayNamesFor(players)
  const summary = waitingOnSummary(
    players.map((p) => ({ id: p.id, label: displayNames.get(p.id) ?? p.firstName })),
    played,
    NAME_LIMIT,
  )
  const iPlayed = myPlayerId !== undefined && played.has(myPlayerId)
  const pct = summary.total === 0 ? 0 : Math.round((summary.playedCount / summary.total) * 100)

  return (
    <section aria-label="Today" data-testid="today-panel" className={cn('rounded-md border p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold md:text-base">
          {iPlayed ? "You've played today" : 'You have not played today'}
        </h2>
        {!iPlayed && <BoardEntryButton teamId={teamId} month={month} />}
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground md:text-sm">
          <span>
            {summary.playedCount} of {summary.total} played
          </span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        {/* A plain div, not <progress>: the role and the values are stated
            explicitly so a screen reader gets the same sentence the sighted
            reader does, without the UA's own styling to fight. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={summary.total}
          aria-valuenow={summary.playedCount}
          aria-label="Players who have entered a board today"
          className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {summary.waiting.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground md:text-sm">
          Waiting on {(expanded ? summary.waiting : summary.shown).join(', ')}
          {!expanded && summary.othersCount > 0 && (
            <>
              {' '}
              <Button
                variant="link"
                className="h-auto p-0 text-xs md:text-sm"
                onClick={() => setExpanded(true)}
              >
                and {summary.othersCount} other{summary.othersCount === 1 ? '' : 's'}
              </Button>
            </>
          )}
        </p>
      )}
    </section>
  )
}

export default TodayPanel
