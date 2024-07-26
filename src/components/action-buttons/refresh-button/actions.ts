'use server'

import { getTeams } from '@/app/me/utils'
import { createClient } from '@/lib/supabase/server'
import { log } from 'next-axiom'
import { cookies } from 'next/headers'

export async function refreshScores() {
  try {
    const cookieStore = cookies()
    const supabase = createClient(cookieStore)
    const { teams } = await getTeams(supabase)

    return { success: true, teams }
  } catch (error) {
    log.error('Unexpected error occurred in refreshScores', { error })
    return { success: false, message: 'Failed to refresh scores, please try again' }
  }
}
