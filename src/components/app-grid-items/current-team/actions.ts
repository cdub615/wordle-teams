'use server'

import { createClient } from '@/lib/supabase/actions'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

export async function removePlayer(formData: FormData) {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const playerIds = (formData.get('playerIds') as string).split(',')
  const playerId = formData.get('playerId') as string
  const teamId = formData.get('teamId') as string

  const newPlayerIds = playerIds.filter((id) => id !== playerId)
  const { error } = await supabase.from('teams').update({ player_ids: newPlayerIds }).eq('id', teamId).select('*')
  if (error) {
    log.error(`Failed to remove player ${playerId} from team ${teamId}`, { error })
    return { success: false, message: 'Failed to remove player' }
  }

  revalidatePath('/me', 'page')

  return { success: true, message: 'Successfully removed player' }
}
