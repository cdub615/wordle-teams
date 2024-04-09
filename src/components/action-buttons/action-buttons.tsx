import { cn } from '@/lib/utils'
import { BoardEntryButton } from './board-entry-button'
import MonthDropdown from './month-dropdown/month-dropdown'
import TeamsDropdown from './teams-dropdown/teams-dropdown'
import {createClient} from '../../lib/supabase/server'
import {cookies} from 'next/headers'
import {Button} from '../ui/button'

type ActionButtonProps = {
  userId: string
  classes?: string
}

export default async function ActionButtons({userId, classes}: ActionButtonProps) {
  const supabase = createClient(cookies())
  const updateToken = async () => await supabase.auth.refreshSession()
  return (
    <div className={cn('flex items-center space-x-2 md:space-x-4', classes)}>
      <MonthDropdown />
      <div className='flex-grow'>
        <TeamsDropdown />
      </div>
      <Button variant={'secondary'} onClick={updateToken}>Update Token</Button>
      <BoardEntryButton userId={userId} />
    </div>
  )
}
