import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createClient } from '@/lib/supabase/server'
import { getMonthsFromEarliestScore, monthAsDate } from '@/lib/utils'
import { format } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { cookies } from 'next/headers'
import MonthDropdownRadioGroup from './month-dropdown-radio-group'

type MonthDropdownProps = {
  initials: string
  teamId: number
  month: string
}

export default async function MonthDropdown({ initials, teamId, month }: MonthDropdownProps) {
  // TODO limit to just past 2 months unless user is a subscriber
  const supabase = createClient(cookies())
  const { data: earliestScore } = await supabase.rpc('earliest_score_for_team', { teamid: teamId })
  const earliest = earliestScore ?? new Date().toISOString()
  const selectedMonth = monthAsDate(month)
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
