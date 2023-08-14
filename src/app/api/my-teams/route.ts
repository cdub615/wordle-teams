import { Database } from '@/lib/database.types'
import { Player, Team, User } from '@/lib/types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
export type players = Database['public']['Tables']['players']['Row']

const GET = async () => {
  const supabase = createRouteHandlerClient<Database>({ cookies })
  const { data: sessionUser, error } = await supabase.auth.getUser()
  const { data: dbTeams } = await supabase.from('teams').select('*')
  let playerIds = []
  const player_ids = dbTeams?.map((t) => t.player_ids)

  playerIds =
    !!player_ids && player_ids.length > 0
      ? player_ids.reduce((prev, current) => {
          return [...prev, ...current]
        })
      : []
  const { data: dbPlayers } = await supabase
    .from('players')
    .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
    .in('id', playerIds)

  // TODO filter for my teams, RLS policy doesn't seem to work quite right for auth.uid() = creator with Select
  const players = dbPlayers?.map((p) => Player.prototype.fromDbPlayer(p, p.daily_scores))
  const teams = dbTeams?.map((t) => {
    const { id, name, creator, playWeekends, scoringSystem } = Team.prototype.fromDbTeam(t)
    const teamPlayers = players?.filter((p) => t.player_ids.includes(p.id))
    return new Team(id, name, creator, playWeekends, [], scoringSystem, teamPlayers)
  })

  return NextResponse.json(teams)
}

export { GET }
