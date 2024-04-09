import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import { getSession, getUserFromSession } from '@/lib/utils'
import { kv } from '@vercel/kv'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import AppBarBase from './app-bar-base'

export default async function AppBarServer() {
  let user: User | undefined = undefined

  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (session) {
    user = getUserFromSession(session)
  }

  if (user) {
    const refresh = await kv.getdel<boolean>(`${process.env.ENVIRONMENT}_${user.id}`)
    log.info(`fetched refresh for env_userid: ${refresh}`)
    if (refresh !== null && refresh) {
      const { data, error } = await supabase.auth.refreshSession()
      if (error) log.error(error.message)
      revalidatePath('/me', 'layout')
      if (data?.session) {
        user = getUserFromSession(data.session)
      }
    }
  }

  return <AppBarBase user={user} />
}
