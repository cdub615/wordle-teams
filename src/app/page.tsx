import Welcome from '@/components/welcome'
import { createClient } from '@/lib/supabase/server'
import { getSession, getUser, getUserInitials } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Home() {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const user = await getUser(supabase)
  if (user) {
    const initials = getUserInitials(user)
    if (!initials || initials.length === 0) redirect('/complete-profile')
    else redirect(`/${initials}`)
  }
  return <Welcome />
}
