import Welcome from '@/components/welcome'
import { createClient } from '@/lib/supabase/server'
import { getUser, hasName } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Home() {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const user = await getUser(supabase)
  if (!user) return <Welcome />

  if (!hasName(user)) redirect('/complete-profile')
  else redirect('/me')
}
