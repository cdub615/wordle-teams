import ActionButtons from '@/components/action-buttons'
import { CurrentTeam, MyTeams, ScoresTable, ScoringSystem, SkeletonTable } from '@/components/app-grid-items'
import { TeamsProvider } from '@/lib/contexts/teams-context'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { Skeleton } from '../../../../components/ui/skeleton'
import NoTeams from './no-teams'
import { getTeams, validParams } from './utils'

// TODO OG Images
// TODO Lemon Squeezy
export default async function Page({params}: {params: {initials: string; teamId: string; month: string}}) {
  const { initials, teamId: teamIdString, month } = params
  if (!validParams(initials, teamIdString, month)) redirect('/not-found')
  else {
    const teams = await getTeams(initials)

    if (!teams || teams.length === 0) return <NoTeams initials={initials} />
    const teamId = teamIdString === 'first' ? teams[0].id : Number.parseInt(teamIdString)
    if (!teams.find((t) => t.id === teamId)) redirect('/not-found')

    return (
      <div className='p-2 grid gap-2 md:grid-cols-3 md:p-12 md:gap-6'>
        <TeamsProvider initialTeams={teams} initialTeamId={teamId} month={month}>
          <ActionButtons classes={'md:col-span-3'} initials={initials} month={month} />
          <Suspense fallback={<SkeletonTable classes={'md:col-span-3'} />}>
            <ScoresTable classes={'md:col-span-3'} />
          </Suspense>
          <CurrentTeam initials={initials} />
          <MyTeams />
          <ScoringSystem classes={'md:row-span-3'} />
        </TeamsProvider>
      </div>
    )
  }
}
