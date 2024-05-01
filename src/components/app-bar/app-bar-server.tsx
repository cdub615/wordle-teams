import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import { getSession, getUserFromSession } from '@/lib/utils'
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
    const { data, error } = await supabase
      .from('player_customer')
      .select('*')
      .eq('player_id', user.id)
      .maybeSingle()
    if (error) log.error('Failed to fetch customer', { error })
    else if (data && data.membership_status !== user.memberStatus) {
      revalidatePath('/me', 'layout')
      user = { ...user, memberStatus: data.membership_status, memberVariant: data.membership_variant, customerId: data.customer_id }
    }
  }

  return <AppBarBase user={user} />
}
