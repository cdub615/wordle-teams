import { createClient } from '@/lib/supabase/server'
import { UserToken, player_with_scores, team_with_players, teams } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { jwtDecode } from 'jwt-decode'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

type GetTeamsResponse = {
  userId: string
  teams: team_with_players[]
  proMember: boolean
}

export const getTeams = async (): Promise<GetTeamsResponse> => {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const session = await getSession(supabase)
  if (!session) redirect('/login')
  const jwt = jwtDecode<UserToken>(session.access_token)
  const membershipStatus = jwt.user_member_status
  const proMember = membershipStatus === 'pro'

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

  return { userId: session.user.id, teams: teamsWithPlayers, proMember }
}
