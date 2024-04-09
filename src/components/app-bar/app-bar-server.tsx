import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import { getSession, getUserFromSession } from '@/lib/utils'
import { kv } from '@vercel/kv'
import { cookies } from 'next/headers'
import AppBarBase from './app-bar-base'
import {log} from 'next-axiom'

export default async function AppBarServer() {
  let user: User | undefined = undefined

  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (session) {
    user = getUserFromSession(session)
  }

  if (user) {
    const refresh = await kv.getdel<boolean>(`${process.env.ENVIRONMENT}_${user.id}`)
    if (refresh !== null && refresh) {
      const { error } = await supabase.auth.refreshSession()
      if (error) log.error(error.message)
    }
  }

  return <AppBarBase user={user} />
}
