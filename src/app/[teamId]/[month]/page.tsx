import ActionButtons from '@/components/action-buttons'
import { CurrentTeam, MyTeams, ScoresTable, ScoringSystem } from '@/components/app-grid-items'
import { setTeam } from '@/lib/utils'

export default async function Page({ params }: { params: { teamId: string; month: string } }) {
  const { teamId: teamIdString, month } = params
  const teamId = Number.parseInt(teamIdString)
  await setTeam(teamId)
  return (
    <div className='p-2 grid gap-2 @md:grid-cols-3 @md:p-12 @md:gap-6'>
      <ActionButtons classes={'@md:col-span-3'} teamId={teamId} month={month} />
      <ScoresTable classes={'@md:col-span-3'} teamId={teamId} month={month} />
      <CurrentTeam teamId={teamId} />
      <MyTeams />
      <ScoringSystem teamId={teamId} classes={'@md:row-span-3'} />
    </div>
  )
}
