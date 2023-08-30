'use server'

import { Database } from '@/lib/database.types'
import { createServerActionClient } from '@supabase/auth-helpers-nextjs'
import { format } from 'date-fns'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function createTeam(formData: FormData) {
  const supabase = createServerActionClient<Database>({ cookies })
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Unauthorized')

  const name = formData.get('name') as string
  const playWeekends = (formData.get('playWeekends') as string) === 'on'
  const creator = session.user.id

  const { data: newTeam, error } = await supabase
    .from('teams')
    .insert({ name, play_weekends: playWeekends, creator, player_ids: [creator] })
    .select('*')
    .single()

  if (error) {
    log.error('Failed to insert team', { error })
    throw new Error('Failed to insert team')
  }

  revalidatePath('/')
  redirect(`/${newTeam.id}/${format(new Date(), 'yyyyMM')}`)
}
