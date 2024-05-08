'use client'

import { getCheckoutUrl } from '@/app/me/actions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useTeams } from '@/lib/contexts/teams-context'
import { getMonthsFromScoreDate } from '@/lib/utils'
import { format, formatISO, parseISO, startOfMonth, subMonths } from 'date-fns'
import { ChevronDown, Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { getScrollAreaHeight } from './utils'

export default function MonthDropdown() {
  const [loading, setLoading] = useState(false)
  const { teams, teamId, month, setMonth, user } = useTeams()
  let startingMonth = subMonths(new Date(), 2)
  const proMember = user.memberStatus === 'pro'

  if (proMember) {
    const earliest = teams.find((t) => t.id === teamId)?.earliestScore?.date ?? new Date().toISOString()
    let earliestScoreDate = new Date(earliest)
    if (earliestScoreDate < startingMonth) startingMonth = earliestScoreDate
  }

  const monthOptions = getMonthsFromScoreDate(startingMonth)
  const scrollAreaHeight = getScrollAreaHeight(monthOptions.length)
  const handleMonthChange = (m: string) => setMonth(parseISO(m))
  const handleUpgrade = async () => {
    setLoading(true)
    const { checkoutUrl, error } = await getCheckoutUrl(user)
    if (error) toast.error(error)
    else if (checkoutUrl) window.LemonSqueezy.Url.Open(checkoutUrl)
    setLoading(false)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' className='text-xs px-2 md:text-sm md:px-4'>
          {loading ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <>
              {format(month, 'MMM yyyy')} <ChevronDown className='ml-1 md:ml-2 h-4 w-4' />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Change Month</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea className={scrollAreaHeight}>
          <DropdownMenuRadioGroup
            value={formatISO(startOfMonth(month), { representation: 'date' })}
            onValueChange={handleMonthChange}
          >
            {monthOptions.map((option) => (
              <DropdownMenuRadioItem
                key={formatISO(option, { representation: 'date' })}
                value={formatISO(option, { representation: 'date' })}
              >
                {format(option, 'MMM yyyy')}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <ScrollBar orientation='vertical' />
        </ScrollArea>
        {!proMember && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleUpgrade}>
              <div className='flex items-center w-full space-x-2'>
                <Sparkles size={18} />
                <span>Upgrade for more</span>
              </div>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
