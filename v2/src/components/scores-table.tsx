import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { api } from '../../convex/_generated/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#/components/ui/table.tsx'
import { ScoreCell } from '#/components/score-cell.tsx'
import { formatDayHeader } from '#/lib/format-day.ts'
import { cn } from '#/lib/utils.ts'
import { attemptsFor } from '../../convex/lib/board.ts'
import { monthTotal } from '../../convex/lib/scoring.ts'
import { daysOfMonth, isWeekendDay, toPuzzleDay } from '../../convex/lib/puzzleDay.ts'
import { useHydrated } from '#/lib/use-hydrated.ts'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * The month grid. DESIGN_SYSTEM.md §8 "Leaderboard table".
 *
 * Hand-rolled rather than @tanstack/react-table, which is what v1 uses: this
 * table never sorts, filters or paginates, and its column pinning is plain
 * `sticky` CSS that react-table plays no part in. The rows arrive pre-ordered by
 * month total, exactly as v1's getData sorted them.
 *
 * Live-updating comes free from Convex reactivity through convexQuery — one of
 * the two sanctioned departures from strict parity in the parent design.
 */
export function ScoresTable({
  teamId,
  month,
  className,
}: {
  teamId: Id<'teams'>
  month: string
  className?: string
}) {
  const hydrated = useHydrated()
  const { data } = useSuspenseQuery(convexQuery(api.scores.getTeamMonth, { teamId, month }))
  const { team, players } = data

  // Local midnight, and only after hydration — the server has no idea what
  // "today" is for this viewer, and guessing it is a hydration mismatch. Before
  // hydration every day of the month reads as "not yet due", which renders
  // blanks rather than wrong values.
  const today = hydrated ? toPuzzleDay(new Date()) : `${month}-01`
  const days = daysOfMonth(month)

  const rows = players
    .map((player) => {
      const byDay = new Map(player.scores.map((score) => [score.puzzleDay, score]))
      return {
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        byDay,
        total: monthTotal({
          month,
          scores: player.scores,
          system: team.system,
          playWeekends: team.playWeekends,
          today,
        }),
      }
    })
    .sort((a, b) => b.total - a.total)

  // v1 shows a first name alone, and 'First L' only when two players on the team
  // share one. Initials replace both on mobile.
  const duplicateFirstNames = new Set(
    rows
      .map((row) => row.firstName)
      .filter((name, i, all) => all.indexOf(name) !== i),
  )

  // z-10: sticky cells have no z-index of their own, so nothing guarantees
  // they paint above the scrolling day columns beneath them (wt-ksh.3.16).
  // bg-background must stay opaque and paired with it — z-index alone
  // reorders painting, it doesn't stop the day columns showing through.
  const pinnedLeft = 'sticky left-0 z-10 bg-background'
  const pinnedRight = 'sticky right-0 z-10 bg-background'

  return (
    <div className={className}>
      {/* This div is a static bordered/rounded frame with no overflow of its
          own — it does NOT scroll. The Table primitive's own wrapper div is
          the single, x-axis-only scroll container (wt-ksh.3.13); the
          keyboard focus target below (tabIndex, aria-label) lives on that
          inner div via wrapperProps, since Table doesn't otherwise expose
          it. Do not add overflow back here — two nested overflow containers
          is exactly the bug this was fixed from. */}
      <div className="max-w-[96vw] rounded-md border text-xs md:text-base">
        {/* w-max min-w-full overrides the primitive's own `w-full`: at 100%
            width, `table-layout: auto` treats that as a CAP and compresses
            every column to fit — with 28-31 day columns that means each
            header wraps one character per line, not the intended horizontal
            scroll. w-max lets the table grow to its natural content width
            (min-w-full keeps it at least full width when content is
            narrower), so the wrapper div above is what scrolls.
            Caught by the screenshot verification this task requires. */}
        <Table
          className="relative w-max min-w-full"
          wrapperProps={{ tabIndex: 0, 'aria-label': 'Scores, scrollable by day' }}
        >
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className={cn(pinnedLeft, 'rounded-tl-md px-2 md:px-4')}>
                <div className="text-xs md:text-sm">Player</div>
              </TableHead>
              {days.map((day) => (
                <TableHead scope="col" key={day}>
                  <div className="text-xs md:text-sm">{formatDayHeader(day)}</div>
                </TableHead>
              ))}
              <TableHead scope="col" className={cn(pinnedRight, 'rounded-tr-md px-2 md:px-4')}>
                <div className="text-right text-xs font-bold md:text-sm">Score</div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody
            // Bottom corner radius belongs to the LAST row only — applying it
            // inside rows.map (as this used to) put it on every row's pinned
            // cells, since each one now paints its own border-b under
            // border-separate (wt-ksh.3.16). Targeted the same way TableBody
            // already cancels the last row's border in ui/table.tsx
            // ([&_tr:last-child>td]:border-b-0), rather than computed from the
            // row index in the map, so the two last-row rules stay adjacent
            // and consistent. Radius must match the frame's own rounded-md or
            // the corner reads as a double curve (wt-ksh.3.17).
            className="[&_tr:last-child>td:first-child]:rounded-bl-md [&_tr:last-child>td:last-child]:rounded-br-md"
          >
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className={pinnedLeft}>
                  <div className="invisible h-0 w-0 md:visible md:h-fit md:w-max md:pr-px">
                    {duplicateFirstNames.has(row.firstName)
                      ? `${row.firstName} ${row.lastName[0]}`
                      : row.firstName}
                  </div>
                  <div className="text-xs md:invisible md:h-0 md:w-0 md:text-sm">
                    {row.firstName[0]}
                    {row.lastName[0]}
                  </div>
                </TableCell>
                {days.map((day) => {
                  const score = row.byDay.get(day)
                  return (
                    // data-day exists purely for e2e/board-entry.spec.ts: the
                    // day headers render as e.g. "Sun 2nd", so a plain
                    // toContainText('2') matches the 2nd of the month on
                    // every load whether or not a board was ever entered.
                    // This makes the specific (player, day) cell addressable
                    // without relying on column position.
                    <TableCell key={day} data-day={day}>
                      <ScoreCell
                        attempts={score ? attemptsFor(score.guesses, score.answer) : undefined}
                        hasScore={score !== undefined}
                        isBeforeToday={day < today}
                        isWeekend={isWeekendDay(day)}
                        playWeekends={team.playWeekends}
                      />
                    </TableCell>
                  )
                })}
                <TableCell className={pinnedRight}>
                  <div className="text-right font-bold">{row.total}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default ScoresTable
