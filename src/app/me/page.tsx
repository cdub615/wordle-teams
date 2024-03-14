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
  const { userId, teams, proMember } = await getTeams()
  // TODO consider dropping the profiles table (and updating functions that reference it)
  // and potentially store player names as claims in the jwt like we're now doing with member status

  if (!teams || teams.length === 0)
    return (
      <TeamsProvider initialTeams={teams} isProMember={proMember}>
        <NoTeams />
      </TeamsProvider>
    )

  return (
    <div className='p-2 grid gap-2 md:grid-cols-3 md:p-12 md:gap-6'>
      <TeamsProvider initialTeams={teams} isProMember={proMember}>
        <ActionButtons classes={'md:col-span-3'} userId={userId} />
        <Suspense fallback={<SkeletonTable classes={'md:col-span-3'} />}>
          <ScoresTable classes={'md:col-span-3'} />
        </Suspense>
        <CurrentTeam />
        <MyTeams userId={userId} />
        <ScoringSystem classes={'md:row-span-3'} />
      </TeamsProvider>
    </div>
  )
}
