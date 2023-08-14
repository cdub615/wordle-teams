import AppGrid from '@/components/app-grid'
import { Team } from '@/lib/types'
import { baseUrl } from '@/lib/utils'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies, headers } from 'next/headers'

const getTeams = async (): Promise<Team[]> => {
  const res = await fetch(`${baseUrl(headers().get('host'))}/api/my-teams`)

  if (!res.ok) throw new Error('Failed to fetch teams')

  return await res.json()
}

const Home = async () => {
  const supabase = createServerComponentClient({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const teamsData = await getTeams()

  return teamsData ? <AppGrid teamsData={teamsData} session={session} /> : <div>Loading...</div>
}

export default Home
