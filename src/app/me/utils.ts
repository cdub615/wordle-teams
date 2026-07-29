import { Database } from '@/lib/database.types'
import { User, player_with_scores, team_with_players, teams } from '@/lib/types'
import { getSession, getUserFromSession } from '@/lib/utils'
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
    const user = await getUserFromSession(supabase)
    // Route users who haven't completed their profile (e.g. a just-accepted invitee) to
    // /complete-profile. Previously this called hasName(supabase) without awaiting it, so the
    // guard was a no-op and nameless users fell through to the dashboard.
    const nameComplete = (user.firstName?.length ?? 0) > 1 && (user.lastName?.length ?? 0) > 1
    if (!nameComplete) return { _user: undefined, teams: [], hasSession: true, hasName: false }

    const { data: teams } = await supabase.from('teams').select('*').order('created_at').returns<teams[]>()
    const playerIds = teams?.flatMap((t) => t.player_ids) ?? []
    const { data: players } = await supabase
      .from('players')
      .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
      .in('id', playerIds)
      .returns<player_with_scores[]>()

    const teamsWithPlayers =
      teams?.map((t) => {
        // Exclude players who haven't completed their profile yet (a just-accepted invitee is in
        // player_ids but has no name). fromDbPlayer requires first/last name, so including them
        // crashes the client render; they reappear on the roster once they finish signup.
        const teamPlayers =
          players?.filter((p) => t.player_ids.includes(p.id) && !!p.first_name && !!p.last_name) ?? []
        return { ...t, players: teamPlayers } as team_with_players
      }) ?? []

    return { _user: user, teams: teamsWithPlayers, hasSession: true, hasName: true }
  } catch (error) {
    log.error('Unexpected error occurred in getTeams', { error })
    throw error
  }
}
