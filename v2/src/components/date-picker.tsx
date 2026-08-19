import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import { Button } from '#/components/ui/button.tsx'
import { Calendar } from '#/components/ui/calendar.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover.tsx'
import { cn } from '#/lib/utils.ts'
import { fromPuzzleDay, toPuzzleDay, type PuzzleDay } from '../../convex/lib/puzzleDay.ts'
import type { Matcher } from 'react-day-picker'

/**
 * Day selection for board entry. Ported from v1's src/components/date-picker.tsx.
 *
 * Speaks puzzle days at its edges and Dates only inside, because
 * react-day-picker insists on Dates. fromPuzzleDay lands on local noon so a DST
 * transition cannot shift the selected day.
 */
export function DatePicker({
  day,
  onSelect,
  playWeekends,
  tabIndex,
  className,
}: {
  day: PuzzleDay | undefined
  onSelect: (day: PuzzleDay) => void
  playWeekends?: boolean
  tabIndex?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = day ? fromPuzzleDay(day) : undefined

  // Same matchers as v1: no future days, and no weekends unless the team plays them.
  const disabled: Array<Matcher> = [{ after: new Date() }]
  if (!playWeekends) disabled.push({ dayOfWeek: [0, 6] })

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          tabIndex={tabIndex}
          variant="outline"
          className={cn(
            'justify-start px-2 text-left text-xs font-normal sm:text-sm md:px-4',
            !day && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {day ? fromPuzzleDay(day).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          }) : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(picked) => {
            if (!picked) return
            onSelect(toPuzzleDay(picked))
            setOpen(false)
          }}
          showOutsideDays
          fixedWeeks
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}

export default DatePicker
