import Home from '@/components/home'
import { createClient } from '@/lib/supabase/server'
import { getSession, hasName } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Page() {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  const session = await getSession(supabase)
  if (session && !hasName(session)) redirect('/complete-profile')

  return <Home />
}
