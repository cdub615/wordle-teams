'use server'

import { createClient } from '@/lib/supabase/actions'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function logout() {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const { error } = await supabase.auth.signOut()

  if (error) {
    redirect('/error')
  }

  cookieStore.delete('initials')
  revalidatePath('/', 'layout')
  redirect('/')
}
