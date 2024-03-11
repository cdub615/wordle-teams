'use server'

import { createClient } from '@/lib/supabase/actions'
import { getSession } from '@/lib/utils'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function updateProfile(formData: FormData) {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const session = await getSession(supabase)
  if (!session) throw new Error('Unauthorized')

  const firstName = formData.get('firstName') as string
  const lastName = formData.get('lastName') as string

  const { error } = await supabase
    .from('profiles')
    .update({ first_name: firstName, last_name: lastName })
    .eq('id', session.user.id)
    .select('*')
    .single()

  if (error) {
    log.error('Failed to update profile', { error })
    throw new Error('Failed to update profile')
  }

  revalidatePath('/me', 'layout')
  redirect('/me')
}
