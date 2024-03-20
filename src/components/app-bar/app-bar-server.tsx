import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import { getSession, getUserFromSession } from '@/lib/utils'
import { cookies } from 'next/headers'
import AppBarBase from './app-bar-base'

export default async function AppBarServer() {
  let user: User | undefined = undefined

  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (session) {
    user = getUserFromSession(session)
  }

  return <AppBarBase user={user} />
}
