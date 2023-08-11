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
import { format, formatISO, parseISO } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'
import { getMonths } from '../table-config'

const MonthDropdown = () => {
  const { selectedMonth, setSelectedMonth, selectedTeam } = useContext(AppContext)
  const [month, setMonth] = useState(selectedMonth)
  const monthOptions: Date[] = getMonths(selectedTeam)
  useEffect(() => setSelectedMonth(month), [setSelectedMonth, month])

  const handleMonthChange = (m: string) => {
    const newMonth = parseISO(m)
    setMonth(newMonth)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline'>
          {format(month, 'MMMM')} <ChevronDown className='ml-2 h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={formatISO(month)} onValueChange={handleMonthChange}>
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
