import Welcome from '@/components/welcome'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function Home() {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (session?.user) {
    const { user_metadata } = session.user
    const initials = `${user_metadata.firstName[0].toLocaleLowerCase()}${user_metadata.lastName[0].toLocaleLowerCase()}`
    redirect(`/${initials}`)
  }
  return <Welcome />
}
