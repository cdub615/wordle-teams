import Welcome from '@/components/welcome'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Home() {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const session = await getSession(supabase)
  if (session) {
    const initials = cookieStore.get('initials')
    if (!initials || initials.value.length === 0) redirect('/complete-profile')
    else redirect(`/${initials.value}`)
  }
  return <Welcome />
}
