import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

type TeamsResponse = {
  teamId: number | undefined
  month: string
}

const checkForTeams = async (): Promise<TeamsResponse> => {
  const supabase = createClient(cookies())
  const { data: teams } = await supabase.from('teams').select('*')

  let teamId: number | undefined = undefined

  teamId = teams?.shift()?.id
  let month = format(new Date(), 'yyyyMM')
  return { teamId, month }
}

export default async function Home({ params }: { params: { initials: string } }) {
  const { initials } = params
  const { teamId, month } = await checkForTeams()
  if (!teamId)
    return (
      <div className='p-2 @md:p-12'>
        <div className='flex'>
          <p>Receive a Team Invite or Create a Team to get started</p>
          <Button>Create Team</Button>
        </div>
      </div>
    )
  else redirect(`/${initials}/${teamId}/${month}`)
}
