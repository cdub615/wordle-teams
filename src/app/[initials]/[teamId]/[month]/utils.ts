import { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'
import { player_with_scores, team_with_players, teams } from '@/lib/types'
import { getSession, getUserInitials, monthAsDate, setInitialsCookie } from '@/lib/utils'
import { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const validParams = (initials: string, teamId: string, month: string): boolean => {
  if (initials.length !== 2) return false
  if (teamId !== 'first' && Number.isNaN(Number.parseInt(teamId))) return false
  try {
    if (month !== 'current') monthAsDate(month)
  } catch {
    return false
  }
  return true
}

const checkInitials = async (initialsParam: string, supabase: SupabaseClient<Database>) => {
  const cookieStore = cookies()
  const initialsCookie = cookieStore.get('initials')
  if (!initialsCookie || !initialsCookie.value || initialsCookie.value.length === 0) {
    const session = await getSession(supabase)
    if (!session) redirect('/login')
    const initials = getUserInitials(session.user)
    // TODO verify we have what we need here and don't get sent to complete profile when we shouldn't
    if (!initials || initials.length === 0) redirect('/complete-profile')

    await setInitialsCookie(initials)
    if (initials !== initialsParam) redirect('/not-found')
  } else if (initialsCookie.value !== initialsParam) redirect('/not-found')
}

export const getTeams = async (initialsParam: string): Promise<team_with_players[]> => {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  await checkInitials(initialsParam, supabase)

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

  return teamsWithPlayers
}
