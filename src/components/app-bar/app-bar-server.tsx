import { createClient } from '@/lib/supabase/server'
import { User, UserToken } from '@/lib/types'
import { getSession } from '@/lib/utils'
import { jwtDecode } from 'jwt-decode'
import { cookies } from 'next/headers'
import AppBarBase from './app-bar-base'

export default async function AppBarServer() {
  let user: User | undefined = undefined

  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (session) {
    const token = jwtDecode<UserToken>(session.access_token)
    console.dir(token)
    const { user_first_name: firstName, user_last_name: lastName } = token
    user = { firstName, lastName, email: session.user.email }
  }

  return <AppBarBase user={user} />
}
