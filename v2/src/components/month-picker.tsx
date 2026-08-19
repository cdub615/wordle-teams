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
 * The current month and the two before it — what v1 shows a free account.
 *
 * The pro expansion (back to the team's earliest score) ships with the rest of
 * the pro gate, not here. Note that in v1 this window is a UI affordance rather
 * than access control: every score is loaded client-side regardless. Whether the
 * gate should be enforced server-side is a question for the phase that adds it.
 */
export function monthOptions(currentMonth: PuzzleMonth): Array<PuzzleMonth> {
  return [addMonths(currentMonth, -2), addMonths(currentMonth, -1), currentMonth]
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
