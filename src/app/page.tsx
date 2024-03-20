import Welcome from '@/components/welcome'
import { createClient } from '@/lib/supabase/server'
import { getSession, hasName } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Home() {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const session = await getSession(supabase)
  if (!session) return <Welcome />

  if (!hasName(session)) redirect('/complete-profile')
  else redirect('/me')
}
