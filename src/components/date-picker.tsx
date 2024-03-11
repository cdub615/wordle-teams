'use client'

import { format } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { PopoverClose } from '@radix-ui/react-popover'
import { Dispatch, SetStateAction } from 'react'
import { Matcher } from 'react-day-picker'

type DatePickerProps = {
  date: Date | undefined
  setDate: Dispatch<SetStateAction<Date | undefined>>
  noDateText?: string
  tabIndex?: number | undefined
  playWeekends?: boolean
}

export default function DatePicker({ date, setDate, noDateText, tabIndex, playWeekends }: DatePickerProps) {
  const disabledDays: Matcher[] = [{ after: new Date() }]
  if (!playWeekends) disabledDays.push({ dayOfWeek: [0, 6] })
  const onSelect = (date: Date | undefined) => {
    setDate(date)
    document.getElementById('date-picker-close')?.click()
  }
  return (
    <Popover modal={true}>
      <PopoverTrigger asChild>
        <Button
          tabIndex={tabIndex}
          variant={'outline'}
          className={cn(
            'w-full justify-start text-left font-normal px-2 md:px-4',
            !date && 'text-muted-foreground'
          )}
        >
          <CalendarIcon className='mr-2 h-4 w-4' />
          {date ? format(date, 'PPP') : <span>{noDateText ?? 'Pick a date'}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0'>
        <Calendar
          mode='single'
          selected={date}
          onSelect={onSelect}
          initialFocus
          showOutsideDays
          fixedWeeks
          disabled={disabledDays}
        />
      </PopoverContent>
      <PopoverClose id='date-picker-close' className='invisible h-0 m-0' />
    </Popover>
  )
}
