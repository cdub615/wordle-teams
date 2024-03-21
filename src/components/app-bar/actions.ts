'use server'

import { createNewCheckout } from '@/lib/lemonsqueezy'
import { createClient } from '@/lib/supabase/actions'
import { User } from '@/lib/types'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export async function logout() {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const { error } = await supabase.auth.signOut()

  if (error) {
    redirect('/error')
  }

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function getCheckoutUrl(user: User) {
  log.info('user passing to createNewCheckout', user)
  const checkout = await createNewCheckout(`${user.firstName} ${user.lastName}`, user.email, user.id)
  log.info('checkout', checkout)
  if (checkout?.data?.attributes?.url) return { checkoutUrl: checkout?.data?.attributes?.url }
  else return { error: 'Failed to create checkout, please try again later.' }
}
