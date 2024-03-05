import { createClient } from '@/lib/supabase/server'
import { player_with_scores, team_with_players, teams } from '@/lib/types'
import { getUser } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

type GetTeamsResponse = {
  userId: string
  teams: team_with_players[]
  isSubscriber: boolean
}

export const getTeams = async (): Promise<GetTeamsResponse> => {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const user = await getUser(supabase)
  if (!user) redirect('/login')

  const { data: teams } = await supabase.from('teams').select('*').returns<teams[]>()
  const playerIds = teams?.flatMap((t) => t.player_ids) ?? []
  const { data: players } = await supabase
    .from('players')
    .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
    .in('id', playerIds)
    .returns<player_with_scores[]>()

  const teamsWithPlayers =
    teams?.map((t) => {
      const teamPlayers = players?.filter((p) => t.player_ids.includes(p.id)) ?? []
      return { ...t, players: teamPlayers } as team_with_players
    }) ?? []

  return { userId: user.id, teams: teamsWithPlayers, isSubscriber: user.app_metadata.is_subscriber as boolean }
}
