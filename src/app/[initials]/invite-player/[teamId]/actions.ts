'use server'

import { createAdminClient } from '@/lib/supabase/actions'
import { getSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function invitePlayer(formData: FormData) {
  const supabase = createAdminClient(cookies())
  const session = await getSession(supabase)
  if (!session) throw new Error('Unauthorized')

  const teamId = formData.get('teamId') as string
  const playerIds = formData.getAll('playerIds') as string[]
  const invited = formData.getAll('invited') as string[]
  const email = formData.get('email') as string

  const { data: players, error } = await supabase.from('players').select('*').eq('email', email)

  if (players && players[0]) {
    if (!playerIds.includes(players[0].id)) {
      const newPlayerIds = playerIds.length > 0 ? [...playerIds, players[0].id] : [players[0].id]
      const { error } = await supabase
        .from('teams')
        .update({ player_ids: newPlayerIds })
        .eq('id', teamId)
        .select('*')
      if (error) {
        log.error(`Failed to fetch team ${teamId}`, { error })
        throw error
      }
    } else log.info(`Player with email ${email} already on team ${teamId}`)
  } else {
    const { error } = await supabase.auth.admin.inviteUserByEmail(email)
    if (error) {
      log.error('Failed to send invite email', { error })
      throw error
    }
    const newInvited = [...invited, email]
    const { error: teamUpdateError } = await supabase
      .from('teams')
      .update({ invited: newInvited })
      .eq('id', teamId)
      .select('*')
    if (teamUpdateError) {
      log.error('team update error', { teamUpdateError })
      throw error
    }
  }

  if (error) {
    log.error('An unexpected error occurred while trying to invite player', { error })
    throw error
  }

  revalidatePath('/[teamId]', 'page')
  redirect('/')
}
