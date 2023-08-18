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
import AppContext from '@/lib/app-context'
import { getMonthsFromEarliestScore } from '@/lib/utils'
import { format, formatISO, parseISO } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'

const MonthDropdown = () => {
  const { selectedMonth, setSelectedMonth, selectedTeam } = useContext(AppContext)
  const [monthOptions, setMonthOptions] = useState(getMonthsFromEarliestScore(selectedTeam))

  useEffect(() => setMonthOptions(getMonthsFromEarliestScore(selectedTeam)), [selectedTeam])

  const handleMonthChange = (m: string) => {
    const newMonth = parseISO(m)
    setSelectedMonth(newMonth)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline'>
          {format(selectedMonth, 'MMMM')} <ChevronDown className='ml-2 h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={formatISO(selectedMonth)} onValueChange={handleMonthChange}>
          {monthOptions.map((option) => (
            <DropdownMenuRadioItem key={formatISO(option)} value={formatISO(option)}>
              {format(option, 'MMMM')}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default MonthDropdown
