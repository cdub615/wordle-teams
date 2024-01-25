import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getMonthsFromEarliestScore, monthAsDate } from '@/lib/utils'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { format } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { cookies } from 'next/headers'
import { Database } from '../../../lib/database.types'
import MonthDropdownRadioGroup from './month-dropdown-radio-group'

type MonthDropdownProps = {
  teamId: number
  month: string
}

export default async function MonthDropdown({ teamId, month }: MonthDropdownProps) {
  const supabase = createServerComponentClient<Database>({ cookies })
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
        <MonthDropdownRadioGroup teamId={teamId} selectedMonth={selectedMonth} monthOptions={monthOptions} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
