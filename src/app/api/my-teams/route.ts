import { Database } from '@/lib/database.types'
import { Player, Team } from '@/lib/types'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
export type players = Database['public']['Tables']['players']['Row']

const GET = async () => {
  const supabase = createRouteHandlerClient<Database>({cookies})
  supabase.auth.admin.updateUserById('021b1fe0-98d8-4a4c-a82f-66ef7790f35c', {
    email_confirm: true
  })
  const { data: sessionUser, error } = await supabase.auth.getUser()
  const { data: dbTeams } = await supabase.from('teams').select('*')
  const myDbTeams = dbTeams?.filter(
    (t) => t.creator === sessionUser.user?.id || t.player_ids.includes(sessionUser.user?.id!)
  )
  let playerIds = []
  const player_ids = myDbTeams?.map((t) => t.player_ids)

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

  const players = dbPlayers?.map((p) => Player.prototype.fromDbPlayer(p, p.daily_scores))
  const teams = myDbTeams?.map((t) => {
    const { id, name, creator, playWeekends, scoringSystem } = Team.prototype.fromDbTeam(t)
    const teamPlayers = players?.filter((p) => t.player_ids.includes(p.id))
    return new Team(id, name, creator, playWeekends, [], scoringSystem, teamPlayers)
  })

  return NextResponse.json(teams)
}

export { GET }
