'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTeams } from '@/lib/contexts/teams-context'
import { getMonthsFromScoreDate } from '@/lib/utils'
import { differenceInMonths, format, formatISO, parseISO, subMonths } from 'date-fns'
import { ChevronDown } from 'lucide-react'

export default function MonthDropdown() {
  const { teams, teamId, month, setMonth, subscriber } = useTeams()
  let startingMonth = subMonths(new Date(), 2)

  if (subscriber) {
    const earliest = teams.find((t) => t.id === teamId)?.earliestScore?.date ?? new Date().toISOString()
    const earliestScoreDate = new Date(earliest)
    differenceInMonths(earliestScoreDate, new Date()) > 2
    startingMonth = earliestScoreDate
  }

  const monthOptions = getMonthsFromScoreDate(startingMonth)
  const handleMonthChange = (m: string) => setMonth(parseISO(m))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' className='text-xs px-2 md:text-sm md:px-4'>
          {format(month, 'MMM yyyy')} <ChevronDown className='ml-1 md:ml-2 h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={formatISO(month)} onValueChange={handleMonthChange}>
          {monthOptions.map((option) => (
            <DropdownMenuRadioItem key={formatISO(option)} value={formatISO(option)}>
              {format(option, 'MMM yyyy')}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
