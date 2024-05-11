'use server'

import { createClient } from '@/lib/supabase/actions'
import { getSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import {redirect} from 'next/navigation'
import * as Sentry from '@sentry/nextjs'

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
      .single()

    if (error) {
      'Token Hash or Type were missing in the auth callback'
      log.error('Failed to update player name', { error })
      throw new Error('Failed to update player name')
    }

    const currentSession = { refresh_token: session.refresh_token }
    const {error: refreshError} = await supabase.auth.refreshSession(currentSession)
    if (refreshError) {
      'Token Hash or Type were missing in the auth callback'
      log.error('Failed to refresh session after updating player name', { error })
    }

    redirect('/me')
  } catch (error) {
    Sentry.captureException(error)
    log.error('An unexpected error occurred in updateProfile', { error })
    throw new Error('An unexpected error occurred in updateProfile')
  }
}
