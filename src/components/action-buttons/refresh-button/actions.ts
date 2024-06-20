'use server'

import { getTeams } from '@/app/me/utils'
import { log } from 'next-axiom'

export async function refreshScores() {
  try {
    const { teams } = await getTeams()

    return { success: true, teams }
  } catch (error) {
    log.error('Unexpected error occurred in refreshScores', { error })
    return { success: false, message: 'Failed to refresh scores, please try again' }
  }
}
