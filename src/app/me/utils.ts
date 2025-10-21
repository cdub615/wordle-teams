import { Database } from '@/lib/database.types'
import { User, player_with_scores, team_with_players, teams } from '@/lib/types'
import { getSession, getUserFromSession, hasName } from '@/lib/utils'
import { SupabaseClient } from '@supabase/supabase-js'
import { log } from 'next-axiom'

type GetTeamsResponse = {
  _user: User | undefined
  teams: team_with_players[]
  hasSession: boolean
  hasName: boolean
}

export const getTeams = async (supabase: SupabaseClient<any, "public", any>): Promise<GetTeamsResponse> => {
  try {
    const session = await getSession(supabase)
    if (!session) return { _user: undefined, teams: [], hasSession: false, hasName: false }
    if (!hasName(supabase)) return { _user: undefined, teams: [], hasSession: true, hasName: false }
    const user = await getUserFromSession(supabase)

    const { data: teams } = await supabase.from('teams').select('*').order('created_at').returns<teams[]>()
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

    return { _user: user, teams: teamsWithPlayers, hasSession: true, hasName: true }
  } catch (error) {
    log.error('Unexpected error occurred in getTeams', { error })
    throw error
  }
}
