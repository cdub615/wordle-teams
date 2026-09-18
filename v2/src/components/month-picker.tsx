import { ChevronDown } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu.tsx'
import { formatMonthLabel } from '#/lib/format-day.ts'
import { addMonths, type PuzzleMonth } from '../../convex/lib/puzzleDay.ts'

/**
 * The current month and the two before it — what v1 shows a free account —
 * NEWEST FIRST.
 *
 * DESCENDING IS A DELIBERATE DIVERGENCE FROM v1 (wordle-teams-l23h), which
 * builds the same list ascending: `getMonthsFromScoreDate` in v1's
 * src/lib/utils.ts walks forward from the starting month and pushes the current
 * one last. Recorded in V2-ADDENDUM.md section 7a so the parity audit expects it.
 *
 * IT MATTERS MORE THAN THREE ROWS SUGGESTS, WHICH IS WHY IT IS WORTH DOING
 * BEFORE THE LIST GROWS. The window here is temporary: the pro expansion — back
 * to the team's earliest score — ships with the rest of the pro gate, not here.
 * v1 already has that expansion and wraps its dropdown in a ScrollArea with a
 * computed height (src/components/action-buttons/month-dropdown/utils.ts)
 * precisely because the list gets long. Ascending order in that shape puts the
 * month a reader almost always wants — this one — off the bottom of a scroll.
 * Fixing the order now means the expansion inherits it rather than rediscovering
 * the problem once the list is long enough to hurt.
 *
 * IN v1 THIS WINDOW IS A UI AFFORDANCE RATHER THAN ACCESS CONTROL — every score
 * is loaded client-side regardless — AND IN v2 IT NO LONGER IS. That question is
 * answered: convex/scores.ts's getTeamMonthFor refuses any month below the
 * viewer's floor (wordle-teams-kusd's task 3), so reaching further back is no
 * longer a matter of typing a URL.
 *
 * THIS LIST IS A STRICT SUBSET OF WHAT THE SERVER ALLOWS, NOT A MIRROR OF IT, and
 * every month it offers is safe for that reason rather than by agreement. The
 * three here are the FREE window specifically, and the server floor sits one
 * month below even that (SERVER_SLACK_MONTHS, for the UTC-versus-viewer
 * disagreement at a month boundary). A Pro viewer is therefore currently offered
 * far less than they are entitled to; task 5 replaces this function with
 * lib/monthWindow.ts's monthWindowFor, which is the shared rule both sides
 * already derive their bounds from. Do not widen this list by hand in the
 * meantime — monthWindowFor needs the team's earliest board and the viewer's
 * membership, neither of which is in scope here, so anything hand-rolled would be
 * right by luck rather than by construction.
 */
export function monthOptions(currentMonth: PuzzleMonth): Array<PuzzleMonth> {
  return [currentMonth, addMonths(currentMonth, -1), addMonths(currentMonth, -2)]
}

export function MonthPicker({
  currentMonth,
  value,
  onChange,
}: {
  currentMonth: PuzzleMonth
  value: PuzzleMonth
  onChange: (month: PuzzleMonth) => void
}) {
  const options = monthOptions(currentMonth)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="px-2 text-xs md:px-4 md:text-sm">
          {formatMonthLabel(value)}
          <ChevronDown className="ml-1 h-4 w-4 md:ml-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {formatMonthLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default MonthPicker
