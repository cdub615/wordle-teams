import { createClient } from '@/lib/supabase/server'
import { teams } from '@/lib/types'
import { cookies } from 'next/headers'
import InvitePlayerForm from './invite-player-form'

type TeamInfo = {
  team: teams
  playerIds: string[]
}

const getTeamInfo = async (teamId: string): Promise<TeamInfo> => {
  const supabase = createClient(cookies())
  const { data: team } = await supabase.from('teams').select('*').eq('id', teamId).single()
  if (!team) throw new Error(`Current team not found. Id: ${teamId}`)

  return {
    team,
    playerIds: team.player_ids,
  }
}

export default async function InvitePlayer({ params }: { params: { teamId: string } }) {
  const { team, playerIds } = await getTeamInfo(params.teamId)
  return <InvitePlayerForm team={team} playerIds={playerIds} />
}
