import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BoardEntryButton } from './board-entry-button'
import MonthDropdown from './month-dropdown/month-dropdown'
import SentryClientTest from './sentry-test'
import TeamsDropdown from './teams-dropdown/teams-dropdown'
import * as Sentry from '@sentry/nextjs'

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
      <SentryServerTest />
      <SentryClientTest />
      <BoardEntryButton userId={userId} />
    </div>
  )
}
export async function SentryServerTest() {
  const handleSubmit = async (formData: FormData) => {
    'use server'
    Sentry.captureException(new Error('testing Sentry from server component'))
  }
  return (
    <form action={handleSubmit}>
      <Button type='submit'>Sentry Server Test</Button>
    </form>
  )
}
