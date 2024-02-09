import ActionButtons from '@/components/action-buttons'
import { CurrentTeam, MyTeams, ScoresTable, ScoringSystem } from '@/components/app-grid-items'

export default async function Page({params}: {params: {initials: string; teamId: string; month: string } }) {
  const { initials, teamId: teamIdString, month } = params
  const teamId = Number.parseInt(teamIdString)

  return (
    <div className='p-2 grid gap-2 @md:grid-cols-3 @md:p-12 @md:gap-6'>
      <ActionButtons classes={'@md:col-span-3'} initials={initials} teamId={teamId} month={month} />
      <ScoresTable classes={'@md:col-span-3'} teamId={teamId} month={month} />
      <CurrentTeam initials={initials} teamId={teamId} />
      <MyTeams />
      <ScoringSystem teamId={teamId} classes={'@md:row-span-3'} />
    </div>
  )
}
