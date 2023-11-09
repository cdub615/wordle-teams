import { MyTeams, ScoringSystem } from '@/components/app-grid-items'
import { Button } from '@/components/ui/button'
import { Database } from '@/lib/database.types'
import { getSession } from '@/lib/utils'
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
  const session = await getSession(supabase)
  if (!session) redirect('/login')

  const { data: teams } = await supabase.from('teams').select('*')

  let teamId: number | undefined = undefined

  teamId = teams?.shift()?.id
  let month = format(new Date(), 'yyyyMM')
  return { teamId, month }
}

export default async function Home() {
  const { teamId, month } = await checkForTeams()
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
