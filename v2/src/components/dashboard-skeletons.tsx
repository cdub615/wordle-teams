import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table.tsx'
import { cn } from '#/lib/utils.ts'
import { SYSTEM_FIELDS } from '../../convex/lib/scoringSystem.ts'
import { daysOfMonth, type PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * THE DASHBOARD'S LOADING STATES (wordle-teams-9ahw).
 *
 * WHAT WAS WRONG. Three components on the dashboard call `useSuspenseQuery` on
 * the SAME query — `api.scores.getTeamMonth`, keyed by `(teamId, month)`:
 * scores-table.tsx, teams/team-boards.tsx and scoring-system-card.tsx. Changing
 * team or month changes that key, so all three suspend at once — and there was
 * no Suspense boundary anywhere on the dashboard, nor a `defaultPendingComponent`
 * in router.tsx, so the suspension bubbled past the route and unmounted the whole
 * grid. Every switch blanked the page.
 *
 * v1 HAD THIS AND v2 LOST IT, WHICH IS WHY IT IS A PARITY GAP RATHER THAN A
 * FEATURE. `src/app/me/page.tsx:60` wraps its scores table in
 * `<Suspense fallback={<SkeletonTable/>}>`, and `src/app/me/loading.tsx` is a
 * route-level skeleton of the whole grid. v2 ported neither.
 *
 * THIS GOES FURTHER THAN v1 ON PURPOSE. v1 wrapped ONLY the scores table, so
 * its Team Boards panel and Scoring System card blanked on a switch too — the
 * same defect, just less noticeable next to the table. All three are covered
 * here. Owner's decision, 2026-09-02.
 *
 * EVERY SKELETON CARRIES ITS COMPONENT'S GRID CLASSES, WHICH IS NOT DECORATION.
 * `md:col-span-3` and `md:row-span-3` decide the shape of the whole grid; a
 * fallback that omits them collapses its neighbours into the gap and then
 * shoves them back when the real content arrives — a layout jump on every
 * switch, which is the reported problem restated rather than fixed. The
 * `className` prop on each of these exists for that and should always be passed
 * the same value its component gets.
 *
 * SIZES ARE DERIVED, NOT HARDCODED, wherever the real component derives them.
 * The day-column count comes from `daysOfMonth(month)` — v1's skeleton hardcodes
 * 30 columns and is visibly wrong in February — and the scoring row count from
 * `SYSTEM_FIELDS`, the same array the card maps over, so it cannot drift from
 * it.
 *
 * ALL PULSING COMES FROM ui/skeleton.tsx (`animate-pulse bg-muted`), which is
 * the same primitive v1 used. No second implementation.
 */

/**
 * Fallback row count, used only when the caller cannot name one. v1 shows three
 * unconditionally; here it is the floor rather than the rule — see `rows`.
 */
const DEFAULT_SKELETON_ROWS = 3

/**
 * WIDTHS AND HEIGHTS MEASURED IN A BROWSER, NOT CHOSEN BY EYE.
 *
 * The first version of this skeleton was visibly too small and the numbers say
 * why: it rendered a 2009px-wide, 194px-tall table where the real one is 2782
 * by 100. So the grid narrowed by 773px and grew by 94 on every switch, then
 * snapped back — a skeleton that causes the layout jump it exists to prevent.
 *
 * Measured on the same team and month, real against fallback:
 *
 *                     real          before        after
 *   table width       2782          2009          2788
 *   table height       100           194           100
 *   body rows            1 (actual)    3 (fixed)     1 (actual)
 *   body row height     52            49            52
 *   day column       74-92            62            88
 *   Player column       74            87            74
 *
 * A day column is `content + px-4` — 32px of padding from ui/table.tsx. The
 * real columns vary from 74 to 92 with the day name ("Fri 4th" is narrow,
 * "Wed 10th" wide), so a uniform skeleton can only match their average; 56px of
 * content lands the total within 6px of 2782, which is 0.2%.
 *
 * THE BODY PILL IS DELIBERATELY NARROWER THAN THE HEADER ONE and is not a
 * missed opportunity to match: with `table-layout: auto` a column is as wide as
 * its widest cell, and in the real table that is always the day header
 * ("Wed 10th") rather than the score ("0"). Widening the body pill would copy a
 * number that decides nothing.
 *
 * `h-5`, NOT THE `h-4` THIS SHIPPED WITH. `p-4` gives 32px of vertical padding
 * and the real rows measure 52px, so the content is 20px. `h-4` measured 49 —
 * three pixels short per row, which compounds down a team.
 */
const DAY_HEADER_WIDTH = 'w-[56px]'
const DAY_CELL_WIDTH = 'w-[30px]'
/** The pinned Player and Score headers, measured the same way: 74px - 32px. */
const PINNED_WIDTH = 'w-[42px]'

/**
 * Content height inside a body cell. `p-4` gives 32px of vertical padding, and
 * the real rows measured 52px, so the content is 20px — `h-5`, not the `h-4`
 * this shipped with, which measured 49 and left a 3px-per-row difference that
 * compounds down a team.
 */
const CELL_HEIGHT = 'h-5'

/**
 * The scores table, at rest.
 *
 * BUILT FROM THE REAL TABLE PRIMITIVES rather than a single grey block, because
 * the thing being replaced is horizontally scrollable and 28-31 columns wide.
 * A plain rectangle of the same height would collapse the horizontal scroll
 * position on every switch and change the page's width as it came and went.
 *
 * THE PINNED COLUMNS ARE REPRODUCED for the same reason they exist in
 * scores-table.tsx: `sticky` cells have no z-index of their own, so without
 * `z-10` and an opaque background the day columns show through them while
 * scrolling. A skeleton that scrolls differently from the table it stands in
 * for is its own small lie.
 */
export function ScoresTableSkeleton({
  month,
  rows = DEFAULT_SKELETON_ROWS,
  className,
  footer,
}: {
  month: PuzzleMonth
  /**
   * How many player rows to draw. THE CALLER CAN USUALLY KNOW THIS EXACTLY,
   * which is what makes the skeleton the right height rather than approximately
   * right: team membership comes from `api.teams.getMyTeams`, which does NOT
   * suspend on a team or month change — it is already resolved by the time this
   * fallback renders. routes/app.tsx passes `selectedTeam.members.length`.
   *
   * v1 draws three rows unconditionally, so its skeleton is the wrong height
   * for every team that is not exactly three players, and the grid jumps
   * vertically as the table lands.
   */
  rows?: number
  className?: string
  /**
   * Mirrors the real ScoresTable's own `footer` prop — routes/app.tsx passes
   * `<ScoringLegendSkeleton />` here, since ScoringLegend is now rendered as
   * that same footer slot rather than as its own grid child. Omitting this
   * would size the fallback for a card with no footer region while the real
   * card, once it lands, has one — the exact layout jump this file's own
   * header comment (wordle-teams-9ahw) exists to prevent.
   */
  footer?: ReactNode
}) {
  // The real column count for the month being loaded — 28, 29, 30 or 31.
  const days = daysOfMonth(month)

  const pinnedLeft = 'sticky left-0 z-10 bg-background'
  const pinnedRight = 'sticky right-0 z-10 bg-background'

  return (
    <div className={className} data-slot="scores-table-skeleton" aria-hidden="true">
      {/* `max-w-full`, matching the real table it stands in for — see its note
          on wordle-teams-rpql. A skeleton bounded differently from its component
          is a layout jump waiting for a wide screen. */}
      <div className="max-w-full rounded-md border text-xs md:text-base">
        {/* `w-max min-w-full` for the reason scores-table.tsx gives at length:
            at 100% width, `table-layout: auto` treats that as a cap and
            compresses every column to fit instead of scrolling. */}
        <Table className="relative w-max min-w-full">
          <TableHeader>
            <TableRow>
              <TableHead className={cn(pinnedLeft, 'rounded-tl-md px-2 md:px-4')}>
                <Skeleton className={cn(CELL_HEIGHT, PINNED_WIDTH)} />
              </TableHead>
              {days.map((day) => (
                <TableHead key={day}>
                  <Skeleton className={cn('mx-auto', CELL_HEIGHT, DAY_HEADER_WIDTH)} />
                </TableHead>
              ))}
              <TableHead className={cn(pinnedRight, 'rounded-tr-md px-2 md:px-4')}>
                <Skeleton className={cn('ml-auto', CELL_HEIGHT, PINNED_WIDTH)} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child>td:first-child]:rounded-bl-md [&_tr:last-child>td:last-child]:rounded-br-md">
            {Array.from({ length: Math.max(1, rows) }, (_, row) => (
              <TableRow key={row}>
                <TableCell className={pinnedLeft}>
                  <Skeleton className={cn(CELL_HEIGHT, PINNED_WIDTH)} />
                </TableCell>
                {days.map((day) => (
                  <TableCell key={day}>
                    <Skeleton className={cn('mx-auto rounded-full', CELL_HEIGHT, DAY_CELL_WIDTH)} />
                  </TableCell>
                ))}
                <TableCell className={pinnedRight}>
                  <Skeleton className={cn('ml-auto', CELL_HEIGHT, DAY_CELL_WIDTH)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* Mirrors scores-table.tsx's own footer wrapper exactly — same
            border, same padding — so the real card and this fallback occupy
            the same height whether or not a footer is present. */}
        {footer && <div className="border-t border-line-subtle px-2 py-4 md:px-4">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * The Team Boards panel, at rest.
 *
 * KEEPS THE REAL TITLE AND THE SHAPE OF THE DAY-NAV ROW, so the card does not
 * change height when the panel arrives. The 450px block matches the slide
 * height in team-boards.tsx; the arrows are rendered as disabled buttons rather
 * than as skeletons because they are ALWAYS there in the real panel and their
 * dimensions are what the row's height depends on.
 */
export function TeamBoardsSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className} data-slot="team-boards-skeleton" aria-hidden="true">
      <CardHeader>
        <CardTitle>Team Boards</CardTitle>
        <div className="flex pt-2">
          <Skeleton className="h-9 w-9">
            <ArrowLeft className="invisible h-4 w-4" />
          </Skeleton>
          <div className="mx-auto">
            <Skeleton className="h-9 w-52 md:w-56" />
          </div>
          <Skeleton className="h-9 w-9">
            <ArrowRight className="invisible h-4 w-4" />
          </Skeleton>
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[450px] w-full" />
      </CardContent>
    </Card>
  )
}

/**
 * The Scoring System card, at rest.
 *
 * ONE ROW PER `SYSTEM_FIELDS` ENTRY — the same array scoring-system-card.tsx
 * maps over — so adding a scoring field changes both together and this cannot
 * silently become the wrong height.
 */
export function ScoringSystemCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className} data-slot="scoring-system-skeleton" aria-hidden="true">
      <CardHeader>
        <CardTitle asChild>
          <div className="flex items-center justify-between">
            <h2>Scoring System</h2>
          </div>
        </CardTitle>
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Skeleton className="h-4 w-20" />
              </TableHead>
              <TableHead className="text-right">
                <Skeleton className="ml-auto h-4 w-12" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SYSTEM_FIELDS.map((field) => (
              <TableRow key={field}>
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="ml-auto h-4 w-8" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/**
 * The whole dashboard grid, for the route's `pendingComponent` — v1's
 * `src/app/me/loading.tsx`, which v2 never ported.
 *
 * THIS COVERS A DIFFERENT MOMENT FROM THE THREE ABOVE, and both are needed. The
 * boundaries above catch a team or month switch, where the route does NOT
 * re-run its loader — that loader prefetches getMyTeams, amIPro and
 * getMyPlayerId, none of which depend on team or month. This one catches the
 * client-side navigation INTO /app, where the loader does run and there is no
 * grid on screen yet to keep.
 *
 * NO `month` TO SIZE THE TABLE WITH, which is why the top block is a plain
 * rectangle rather than ScoresTableSkeleton: at this point the route has not
 * resolved its search params, and useDashboardSearchSync has not yet filled
 * them in. Guessing a column count here would be a guess about a month nobody
 * has chosen.
 *
 * THE GRID CLASSES MIRROR routes/app.tsx's OWN, including the `grid-cols-1`
 * that file's comment calls load-bearing: without it the single implicit column
 * is `auto`, whose max sizing is max-content, and one long team name widens the
 * whole page.
 */
export function DashboardSkeleton() {
  return (
    <main
      className="page-max mb-12 mt-2 grid grid-cols-1 gap-2 md:mt-6 md:grid-cols-3 md:gap-6"
      data-slot="dashboard-skeleton"
      aria-hidden="true"
    >
      {/* The picker row: team, month, and the board-entry button pushed right. */}
      <div className="flex items-center gap-2 md:col-span-3">
        <Skeleton className="h-10 w-28 md:w-32" />
        <Skeleton className="h-10 w-28 md:w-32" />
        <Skeleton className="ml-auto h-10 w-28 md:w-32" />
      </div>
      {/*
        THE ORDER AND THE GRID CLASSES MIRROR routes/app.tsx's OWN CHILDREN,
        checked against it rather than adapted from v1's loading.tsx: scores
        table (col-span-3), Team Boards (row-span-3), then the current-team,
        scoring-system and my-teams cards, none of which carry a grid class.
        A skeleton whose shape disagrees with the page it precedes produces the
        jump it exists to prevent.
      */}
      <Skeleton className="h-[175px] w-full rounded-xl md:col-span-3" />
      <TeamBoardsSkeleton className="md:row-span-3" />
      <Skeleton className="h-[175px] w-full rounded-xl" />
      <ScoringSystemCardSkeleton />
      <Skeleton className="h-[175px] w-full rounded-xl" />
    </main>
  )
}

/**
 * CONSTANT HEIGHT AT ANY TEAM SIZE, matching the panel it stands in for: the
 * count, the bar and the capped name list are all fixed-height, so this cannot
 * cause the layout jump the other skeletons here were written to avoid.
 *
 * It is ALSO what TodayPanel renders before hydration — not only what Suspense
 * renders. See that component's hydration note; "today" is a client-only fact
 * and there is nothing honest to draw until the browser clock is readable.
 */
export function TodayPanelSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('rounded-md border p-4', className)}>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-3 h-2 w-full" />
      <Skeleton className="mt-3 h-4 w-48" />
    </div>
  )
}

/**
 * The scoring legend, at rest — now rendered as ScoresTableSkeleton's own
 * `footer` prop (Task wordle-teams-ha7u), not as a standalone grid fallback.
 *
 * ONE LABEL/VALUE PAIR PER `SYSTEM_FIELDS` ENTRY, matching the real
 * scoring-legend.tsx's two-row shape (a narrow label pill over a shorter
 * value pill) rather than one flat row of chips — the caption row above it
 * (with an Edit-sized pill when `isOwner`) is drawn too, since that row's
 * height is part of what the real component occupies and a skeleton missing
 * it undersizes the footer region.
 */
export function ScoringLegendSkeleton({
  isOwner,
  className,
}: {
  isOwner?: boolean
  className?: string
}) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-4 w-28" />
        {isOwner && <Skeleton className="h-4 w-10" />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {SYSTEM_FIELDS.map((field) => (
          <div key={field} className="flex flex-col items-center gap-1">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-4 w-8" />
          </div>
        ))}
      </div>
    </div>
  )
}
