import Home from '@/components/home'
import { createClient } from '@/lib/supabase/server'
import { getSession, getUser, hasName } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Page() {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)
  const user = await getUser(supabase)
  if (user && !hasName(supabase)) redirect('/complete-profile')

  return <Home />
}
