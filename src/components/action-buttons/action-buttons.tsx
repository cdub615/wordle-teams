import { cn } from '@/lib/utils'
import { BoardEntryButton } from './board-entry-button'
import MonthDropdown from './month-dropdown/month-dropdown'
import RefreshButton from './refresh-button'
import TeamsDropdown from './teams-dropdown/teams-dropdown'

type ActionButtonProps = {
  userId: string
  classes?: string
}

export default async function ActionButtons({ userId, classes }: ActionButtonProps) {
  return (
    <div className={cn('flex items-center space-x-2 md:space-x-4', classes)}>
      <MonthDropdown />
      <div className='flex-grow'>
        <TeamsDropdown />
      </div>
      <RefreshButton />
      <BoardEntryButton userId={userId} />
    </div>
  )
}
