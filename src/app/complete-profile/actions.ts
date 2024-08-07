'use server'

import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'

export default async function updateProfile(formData: FormData) {
  try {
    const cookieStore = cookies()
    const supabase = createClient(cookieStore)
    const session = await getSession(supabase)
    if (!session) throw new Error('Unauthorized')

    const firstName = formData.get('firstName') as string
    const lastName = formData.get('lastName') as string

    const { error } = await supabase
      .from('players')
      .update({ first_name: firstName, last_name: lastName })
      .eq('id', session.user.id)
      .select('*')
      .maybeSingle()

    if (error) {
      log.error('Failed to update player name', { error })
      return { error: 'Failed to update player name' }
    }

    const currentSession = { refresh_token: session.refresh_token }
    const { error: refreshError } = await supabase.auth.refreshSession(currentSession)
    if (refreshError) {
      log.error('Failed to refresh session after updating player name', { error })
    }

    return { error: undefined }
  } catch (error) {
    log.error('An unexpected error occurred in updateProfile', { error })
    return { error: 'An unexpected error occurred in updateProfile' }
  }
}
