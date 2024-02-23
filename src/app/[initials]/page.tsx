import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { getUser, getUserInitials } from '@/lib/utils'
import { format } from 'date-fns'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

type TeamsResponse = {
  teamId: number | undefined
  month: string
}

const checkForTeams = async (initialsParam: string): Promise<TeamsResponse> => {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const { data: teams } = await supabase.from('teams').select('*')
  const user = await getUser(supabase)
  if (!user) redirect('/login')
  const initials = getUserInitials(user)
  if (!initials || initials.length === 0) redirect('/complete-profile')
  if (initials !== initialsParam) redirect(`/${initials}`)

  let teamId: number | undefined = undefined

  teamId = teams?.shift()?.id
  let month = format(new Date(), 'yyyyMM')
  return { teamId, month }
}

export default async function Home({ params }: { params: { initials: string } }) {
  const { initials } = params
  if (initials.length !== 2) redirect('/')
  const { teamId, month } = await checkForTeams(initials)

  if (!teamId)
    return (
      <div className='flex justify-center mt-10'>
        <div>
          <p className='text-lg max-w-xs text-center mx-auto'>
            Receive a Team Invite or Create a Team to get started
          </p>
          <div className='flex justify-center my-4'>
            <Link href={`/${initials}/create-team`}>
              <Button>Create Team</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  else redirect(`/${initials}/${teamId}/${month}`)
}
