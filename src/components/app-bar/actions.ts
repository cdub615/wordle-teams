'use server'

import { createNewCheckout, createNewCustomer } from '@/lib/lemonsqueezy'
import { createClient } from '@/lib/supabase/actions'
import { User } from '@/lib/types'
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
  const checkout = await createNewCheckout(`${user.firstName} ${user.lastName}`, user.email, user.id)
  if (checkout?.data?.attributes?.url) return { checkoutUrl: checkout?.data?.attributes?.url }
  else return { error: 'Failed to create checkout, please try again later.' }
}
