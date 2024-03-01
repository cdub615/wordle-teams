import Welcome from '@/components/welcome'
import { createClient } from '@/lib/supabase/server'
import { getUser, getUserInitials, setInitialsCookie } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Home() {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  let initials
  const initialsCookie = cookieStore.get('initials')
  if (!initialsCookie || !initialsCookie.value || initialsCookie.value.length === 0) {
    const user = await getUser(supabase)
    if (!user) return <Welcome />

    initials = getUserInitials(user)
    await setInitialsCookie(initials)
  } else initials = initialsCookie.value

  if (!initials || initials.length === 0) redirect('/complete-profile')
  else redirect(`/${initials}/first/current`)
}
