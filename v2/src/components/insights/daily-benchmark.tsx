import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import type { InsightsBenchmark } from '#/lib/insights-benchmark.ts'
import {
  ALL,
  boardsForLayer1,
  filterBoards,
  monthOptionsFor,
  openerOptionsFor,
  type Boards,
} from '#/lib/insights-panel.ts'
import { formatMonthLabel } from '#/lib/format-day.ts'
import { BoardRow } from './board-row.tsx'

/**
 * Layer 1's day-by-day list — bounded, scrollable, and filterable.
 *
 * BOUNDED HEIGHT IS THE POINT. Four hundred cards is not a list anybody reads; it
 * is a wall that pushes everything else off the page. Inside its own scroll
 * container it occupies a fixed, predictable slice of the screen however much
 * history sits behind it, so the sections below stay reachable.
 *
 * THE FILTERS ONLY APPEAR WHEN THERE IS SOMETHING TO FILTER. A free player has one
 * board and a trialist sees one; two selects above a single row would be furniture
 * that explains nothing.
 *
 * `overflow-y-auto` NEEDS AN EXPLICIT max-height to do anything, and the count
 * below the box is what tells a reader the list continues past the fold — a
 * scroll container with no such cue reads as a short list on a touch device,
 * where there is no visible scrollbar until you drag it.
 */
export function DailyBenchmark({
  benchmark,
  data,
}: {
  benchmark: InsightsBenchmark
  data: Boards
}) {
  // NOT data.boards: the query returns full history whenever Layer 2 is unlocked,
  // and the trial unlocks Layer 2 WITHOUT Layer 1. See boardsForLayer1.
  const visible = boardsForLayer1(data.boards, data.access.layer1)
  const [month, setMonth] = useState(ALL)
  const [opener, setOpener] = useState(ALL)

  const months = monthOptionsFor(visible)
  const openers = openerOptionsFor(visible)
  const shown = filterBoards(visible, { month, opener })
  const filterable = visible.length > 1

  return (
    <Card data-testid="insights-daily">
      <CardHeader className="pb-2">
        {/*
          STACKED UNDER THE TITLE ON MOBILE, INLINE FROM `md:` UP. The filters
          are the page's only interactive controls, and the old
          `flex-wrap items-center justify-between` arrangement let the title
          and both selects share one row below `md`, squeezing each select
          well under a usable width. `flex-col` here and `md:flex-row` restore
          the original side-by-side layout at `md` and up while giving the
          controls a full-width row of their own on a phone.
        */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-lg md:text-xl">Day by day</CardTitle>
          {filterable && (
            <div className="flex flex-col gap-2 md:flex-row">
              {/*
                h-9, UP FROM px-2 py-1's ~24PX. These are the page's only
                interactive controls, so a touch target under the usual 44px
                minimum is a real defect rather than a nitpick — h-9 (36px) is
                this task's target height, a real improvement over 24px even
                though it is not the full 44px.
              */}
              <select
                aria-label="Filter by month"
                className="bg-background h-9 w-full rounded border px-2 text-sm md:w-auto"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                data-testid="insights-filter-month"
              >
                <option value={ALL}>All months</option>
                {months.map((value) => (
                  <option key={value} value={value}>
                    {formatMonthLabel(value)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by opener"
                className="bg-background h-9 w-full rounded border px-2 text-sm md:w-auto"
                value={opener}
                onChange={(event) => setOpener(event.target.value)}
                data-testid="insights-filter-opener"
              >
                <option value={ALL}>All openers</option>
                {openers.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="insights-daily-none">
            No boards match those filters.
          </p>
        ) : (
          <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1" data-testid="insights-daily-scroll">
            {shown.map((board) => (
              <BoardRow key={board.puzzleDay} benchmark={benchmark} board={board} />
            ))}
          </div>
        )}
        {filterable && (
          <p className="text-muted-foreground pt-2 text-xs" data-testid="insights-daily-count">
            Showing {shown.length} of {visible.length} boards
          </p>
        )}
      </CardContent>
    </Card>
  )
}
