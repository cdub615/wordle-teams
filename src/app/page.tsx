import Welcome from '@/components/welcome'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '../lib/supabase/server'

export default async function Home() {
  const supabase = createClient(cookies())
  const { data } = await supabase.auth.getUser()
  const { user } = data
  if (user) {
    const initials = `${user.user_metadata.firstName[0].toLocaleLowerCase()}${user.user_metadata.lastName[0].toLocaleLowerCase()}`
    redirect(`/${initials}`)
  }
  return <Welcome />
}
