'use server'

import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

export async function save(formData: FormData) {
  const supabase = createClient(await cookies())
  const session = await getSession(supabase)
  if (!session) throw new Error('Unauthorized')

  const teamId = Number.parseInt(formData.get('teamId') as string)
  const pointsNA = Number.parseInt(formData.get('points[0]') as string)
  const points1 = Number.parseInt(formData.get('points[1]') as string)
  const points2 = Number.parseInt(formData.get('points[2]') as string)
  const points3 = Number.parseInt(formData.get('points[3]') as string)
  const points4 = Number.parseInt(formData.get('points[4]') as string)
  const points5 = Number.parseInt(formData.get('points[5]') as string)
  const points6 = Number.parseInt(formData.get('points[6]') as string)
  const pointsX = Number.parseInt(formData.get('points[7]') as string)

  const { error } = await supabase
    .from('teams')
    .update({
      n_a: pointsNA,
      one_guess: points1,
      two_guesses: points2,
      three_guesses: points3,
      four_guesses: points4,
      five_guesses: points5,
      six_guesses: points6,
      failed: pointsX,
    })
    .eq('id', teamId)
  if (error) {
    log.error('Failed to update scoring system', { error })
    return { success: false, message: 'Failed to save scoring system' }
  }

  revalidatePath('/me', 'page')
  return { success: true, message: 'Successfully saved scoring system' }
}
