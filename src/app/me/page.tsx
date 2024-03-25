import ActionButtons from '@/components/action-buttons'
import { CurrentTeam, MyTeams, ScoresTable, ScoringSystem, SkeletonTable } from '@/components/app-grid-items'
import { TeamsProvider } from '@/lib/contexts/teams-context'

import type { Metadata } from 'next'
import { Suspense } from 'react'
import NoTeams from './no-teams'
import { getTeams } from './utils'

export const metadata: Metadata = {
  title: 'Dashboard',
}

export default async function Page() {
  const { user, teams } = await getTeams()

  if (!teams || teams.length === 0)
    return (
      <TeamsProvider initialTeams={teams} _user={user}>
        <NoTeams />
      </TeamsProvider>
    )

  return (
    <div className='p-2 grid gap-2 md:grid-cols-3 md:p-12 md:gap-6'>
      <TeamsProvider initialTeams={teams} _user={user}>
        <ActionButtons classes={'md:col-span-3'} userId={user.id} />
        <Suspense fallback={<SkeletonTable classes={'md:col-span-3'} />}>
          <ScoresTable classes={'md:col-span-3'} />
        </Suspense>
        <CurrentTeam />
        <MyTeams userId={user.id} />
        <ScoringSystem classes={'md:row-span-3'} />
      </TeamsProvider>
    </div>
  )
}
