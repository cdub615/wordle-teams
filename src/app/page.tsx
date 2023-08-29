import { MyTeams, ScoringSystem } from '@/components/app-grid-items'
import { Button } from '@/components/ui/button'
import { Database } from '@/lib/database.types'
import { setTeam } from '@/lib/utils'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { format } from 'date-fns'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

type TeamsResponse = {
  teamId: number | undefined
  month: string
}

const checkForTeams = async (): Promise<TeamsResponse> => {
  const supabase = createServerComponentClient<Database>({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: teams } = await supabase.from('teams').select('*')

  let teamId: number | undefined = undefined

  teamId = teams?.shift()?.id
  let month = format(new Date(), 'yyyyMM')
  const cookieStore = cookies()
  const teamIdCookie = cookieStore.get('teamId')
  if (
    teamIdCookie &&
    teamIdCookie.value.length > 0 &&
    teams?.some((t) => t.id === Number.parseInt(teamIdCookie.value))
  ) {
    teamId = Number.parseInt(teamIdCookie.value)
  }
  const monthCookie = cookieStore.get('month')
  if (monthCookie && monthCookie.value.length > 0) {
    month = monthCookie.value
  }
  return { teamId, month }
}

export default async function Home() {
  const { teamId, month } = await checkForTeams()
  if (teamId) await setTeam(teamId)
  if (!teamId)
    return (
      <div className='p-2 grid gap-2 @md:grid-cols-3 @md:p-12 @md:gap-6'>
        <div className='flex'>
          <p>Receive a Team Invite or Create a Team to get started</p>
          <Button>Create Team</Button>
        </div>
        <MyTeams />
        <ScoringSystem teamId={0} classes={'@md:row-span-3'} />
      </div>
    )
  else redirect(`/${teamId}/${month}`)
}
