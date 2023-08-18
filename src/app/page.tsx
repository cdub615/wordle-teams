import AppGrid from '@/components/app-grid'
import { Database } from '@/lib/database.types'
import { createServerActionClient, createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

const getTeams = async (): Promise<any> => {
  'use server'
  const supabase = createServerActionClient<Database>({ cookies })
  const { data: teams } = await supabase.from('teams').select('*')
  let playerIds = []
  const player_ids = teams?.map((t) => t.player_ids)

  playerIds =
    !!player_ids && player_ids.length > 0
      ? player_ids.reduce((prev, current) => {
          return [...prev, ...current]
        })
      : []
  const { data: players } = await supabase
    .from('players')
    .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
    .in('id', playerIds)

  return { teams, players }
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
