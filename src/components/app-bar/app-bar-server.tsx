import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import { getUser } from '@/lib/utils'
import { cookies } from 'next/headers'
import AppBarBase from './app-bar-base'

export default async function AppBarServer() {
  let user: User | undefined = undefined

  const supabase = createClient(cookies())
  const dbUser = await getUser(supabase)

  if (dbUser) {
    const firstName = dbUser.user_metadata.firstName
    const lastName = dbUser.user_metadata.lastName
    const email = dbUser.email
    user = { firstName, lastName, email }
  }

  return <AppBarBase user={user} />
}
