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
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useTeams } from '@/lib/contexts/teams-context'
import { getMonthsFromScoreDate } from '@/lib/utils'
import { format, formatISO, parseISO, subMonths } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { getScrollAreaHeight } from './utils'

export default function MonthDropdown() {
  const { teams, teamId, month, setMonth, proMember } = useTeams()
  let startingMonth = subMonths(new Date(), 1)

  if (proMember) {
    const earliest = teams.find((t) => t.id === teamId)?.earliestScore?.date ?? new Date().toISOString()
    let earliestScoreDate = new Date(earliest)
    if (earliestScoreDate < startingMonth) startingMonth = earliestScoreDate
  }

  const monthOptions = getMonthsFromScoreDate(startingMonth)
  const scrollAreaHeight = getScrollAreaHeight(monthOptions.length)
  const handleMonthChange = (m: string) => setMonth(parseISO(m))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' className='text-xs px-2 md:text-sm md:px-4'>
          {format(month, 'MMM yyyy')} <ChevronDown className='ml-1 md:ml-2 h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea className={scrollAreaHeight}>
          <DropdownMenuRadioGroup value={formatISO(month)} onValueChange={handleMonthChange}>
            {monthOptions.map((option) => (
              <DropdownMenuRadioItem key={formatISO(option)} value={formatISO(option)}>
                {format(option, 'MMM yyyy')}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <ScrollBar orientation='vertical' />
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
