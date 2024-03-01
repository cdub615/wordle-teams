import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ListPlus } from 'lucide-react'
import Link from 'next/link'
import MonthDropdown from './month-dropdown/month-dropdown'
import TeamsDropdown from './teams-dropdown/teams-dropdown'
import WordleBoardLink from './wordle-board-link'

type ActionButtonProps = {
  initials: string
  teamId: number
  month: string
  classes?: string
}

export default async function ActionButtons({ initials, teamId, month, classes }: ActionButtonProps) {
  return (
    <div className={cn('flex items-center space-x-2 md:space-x-4', classes)}>
      <MonthDropdown initials={initials} teamId={teamId} month={month} />
      <TeamsDropdown initials={initials} teamId={teamId} month={month} />
      <div className='flex-grow'>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href={`/${initials}/create-team`}>
                <Button variant={'outline'} size={'icon'}>
                  <ListPlus size={24} />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <p>Create Team</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <WordleBoardLink initials={initials} />
          </TooltipTrigger>
          <TooltipContent>
            <p>Add Board</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
