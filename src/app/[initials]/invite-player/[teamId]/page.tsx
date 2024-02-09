import { AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/server'
import { Team, teams } from '@/lib/types'
import { cookies } from 'next/headers'
import Link from 'next/link'
import invitePlayer from './actions'

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

export default async function InvitePlayer({ params }: { params: { initials: string; teamId: string } }) {
  const { initials, teamId } = params
  const { team, playerIds } = await getTeamInfo(teamId)
  const selectedTeam = Team.prototype.fromDbTeam(team)
  const { name: teamName, invited } = selectedTeam
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Invite Player to {team.name}</AlertDialogTitle>
        <AlertDialogDescription>Add player by email address</AlertDialogDescription>
      </AlertDialogHeader>
      <form action={invitePlayer} className='w-full space-y-6'>
        <Input type='email' name='email' required />
        <input hidden name='teamId' value={teamId} />
        <input hidden name='teamName' value={teamName} />
        <input hidden name='playerIds' value={playerIds} />
        <input hidden name='invited' value={invited} />
        <div className='flex justify-end space-x-4'>
          <Link href={`/${initials}`}>
            <Button variant={'secondary'}>Cancel</Button>
          </Link>
          <Button type='submit'>Submit</Button>
        </div>
      </form>
    </>
  )
}
