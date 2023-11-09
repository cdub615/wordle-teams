import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ListPlus, Plus } from 'lucide-react'
import Link from 'next/link'
import MonthDropdown from './month-dropdown/month-dropdown'
import TeamsDropdown from './teams-dropdown/teams-dropdown'

type ActionButtonProps = {
  teamId: number
  month: string
  classes?: string
}

export default async function ActionButtons({ teamId, month, classes }: ActionButtonProps) {
  return (
    <div className={cn('flex items-center space-x-2 @md:space-x-4', classes)}>
      <MonthDropdown teamId={teamId} month={month} />
      <TeamsDropdown teamId={teamId} month={month} />
      <div className='flex-grow'>
        <Link href={'/create-team'}>
          <Button variant={'outline'} size={'icon'}>
            <ListPlus size={24} />
          </Button>
        </Link>
      </div>
      <Link href={'/scores'}>
        <Button size={'icon'}>
          <Plus size={24} />
        </Button>
      </Link>
    </div>
  )
}
