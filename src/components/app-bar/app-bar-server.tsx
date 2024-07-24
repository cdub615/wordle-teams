import { createClient } from '@/lib/supabase/server'
import { player_with_customer, User } from '@/lib/types'
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
    user = await getUserFromSession(supabase)
  }

  if (user) {
    const { data, error } = await supabase
      .from('players')
      .select('*, player_customer(*)')
      .eq('id', user.id)
      .single<player_with_customer>()

    if (error) {
      log.error('Failed to fetch customer in app bar server', { error })
    } else if (data && data.player_customer && data.player_customer.membership_status !== user.memberStatus) {
      revalidatePath('/me', 'layout')
      user = {
        ...user,
        memberStatus: data.player_customer.membership_status,
        memberVariant: data.player_customer.membership_variant,
        customerId: data.player_customer.customer_id,
        timeZone: data.time_zone,
        hasPwa: data.has_pwa,
        reminderDeliveryMethods: data.reminder_delivery_methods,
        reminderDeliveryTime: data.reminder_delivery_time,
      }
    }
  }

  return <AppBarBase userFromServer={user} />
}
