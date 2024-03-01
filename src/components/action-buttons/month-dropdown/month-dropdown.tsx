'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTeams } from '@/lib/contexts/teams-context'
import { getMonthsFromEarliestScore } from '@/lib/utils'
import { format } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import MonthDropdownRadioGroup from './month-dropdown-radio-group'

export default function MonthDropdown({ initials }: { initials: string }) {
  // TODO limit to just past 2 months unless user is a subscriber
  const { teams, teamId, selectedMonth } = useTeams()
  const earliest = teams.find((t) => t.id === teamId)?.earliestScore?.date ?? new Date().toISOString()
  const monthOptions = getMonthsFromEarliestScore(earliest)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline'>
          {format(selectedMonth, 'MMM yyyy')} <ChevronDown className='ml-2 h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <MonthDropdownRadioGroup
          initials={initials}
          teamId={teamId}
          selectedMonth={selectedMonth}
          monthOptions={monthOptions}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
