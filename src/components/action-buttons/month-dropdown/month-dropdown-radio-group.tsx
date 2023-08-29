'use client'

import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { format, formatISO, parseISO } from 'date-fns'
import { useRouter } from 'next/navigation'

type MonthDropdownRadioGroupProps = {
  teamId: number
  selectedMonth: Date
  monthOptions: Date[]
}

export default function MonthDropdownRadioGroup({
  teamId,
  selectedMonth,
  monthOptions,
}: MonthDropdownRadioGroupProps) {
  const router = useRouter()
  const handleMonthChange = async (m: string) => {
    const newMonth = format(parseISO(m), 'yyyyMM')
    await fetch('/api/set-month', {
      method: 'POST',
      body: JSON.stringify({ newMonth }),
      headers: {
        'Content-Type': 'application/json',
      },
    })
    router.replace(`/${teamId}/${newMonth}`)
  }
  return (
    <DropdownMenuRadioGroup value={formatISO(selectedMonth)} onValueChange={handleMonthChange}>
      {monthOptions.map((option) => (
        <DropdownMenuRadioItem key={formatISO(option)} value={formatISO(option)}>
          {format(option, 'MMM yyyy')}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
