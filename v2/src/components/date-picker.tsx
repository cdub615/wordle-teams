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
  minDay,
  maxDay,
  tabIndex,
  className,
}: {
  day: PuzzleDay | undefined
  onSelect: (day: PuzzleDay) => void
  playWeekends?: boolean
  /**
   * Optional inclusive bounds. Both are additive and both default to v1's
   * behaviour when omitted, so board entry (the original caller) is unchanged.
   *
   * team-boards.tsx needs them because its data is scoped to ONE month
   * (scores.getTeamMonth): a day outside that month has no boards to show, so
   * offering it in the calendar would hand the viewer a panel that reads as
   * data loss. Enforced by disabling the days rather than by silently clamping
   * whatever gets picked, which would move the selection under the pointer.
   */
  minDay?: PuzzleDay
  maxDay?: PuzzleDay
  tabIndex?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = day ? fromPuzzleDay(day) : undefined

  // Same matchers as v1: no future days, and no weekends unless the team plays
  // them. `maxDay` narrows the future bound; it can never widen it, because a
  // caller passing a maxDay in the future would otherwise open up days the app
  // has no scores for at all.
  const upperBound = maxDay ? fromPuzzleDay(maxDay) : new Date()
  const disabled: Array<Matcher> = [{ after: upperBound < new Date() ? upperBound : new Date() }]
  if (minDay) disabled.push({ before: fromPuzzleDay(minDay) })
  if (!playWeekends) disabled.push({ dayOfWeek: [0, 6] })

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          tabIndex={tabIndex}
          variant="outline"
          className={cn(
            // `text-sm` AT EVERY WIDTH (wordle-teams-5p9). This was
            // `text-xs sm:text-sm`, so the phone — the product's primary device
            // — got the 12px version of a label reading "September 1, 2026".
            // The trigger is the only thing showing the selected day when the
            // popover is shut, and shrinking it on the device with the least
            // room to read it is backwards.
            'justify-start px-2 text-left text-sm font-normal md:px-4',
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
          /**
           * OPEN ON THE DAY BEING SHOWN, NOT ON TODAY (wordle-teams-5vv3).
           *
           * react-day-picker does NOT derive the displayed month from
           * `selected`. Measured in the installed version 10:
           *
           *   helpers/getInitialMonth.js:14
           *     let initialMonth = month || defaultMonth || today;
           *
           * With neither passed, the calendar always opened on today's month —
           * so a viewer looking at a July day had to page back two months to
           * reach the day already on screen behind the popover. It affected
           * BOTH callers: board entry's picker opened on today while editing an
           * older board, which is the same defect and was never reported only
           * because it is reached less often.
           *
           * `defaultMonth`, NOT `month`. The latter is controlled: it would pin
           * the calendar and make paging inside the popover do nothing. This
           * only chooses where it OPENS, and Radix unmounts the popover content
           * on close, so each reopen picks up the current selection.
           *
           * FALLS BACK TO `upperBound` RATHER THAN TO TODAY when nothing is
           * selected: for a caller bounded into a past month, today is not a
           * month the calendar can even show, and RDP would clamp it back to
           * the bound anyway (getInitialMonth.js:16-23). Naming the bound
           * directly is the same result arrived at honestly.
           */
          defaultMonth={selected ?? upperBound}
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
