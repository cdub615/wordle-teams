import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/utils'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import CurrentTeamClient from './current-team-client'

export default async function CurrentTeam({ initials }: { initials: string }) {
  const supabase = createClient(cookies())
  const session = await getSession(supabase)
  if (!session) redirect('/login')
  const userId = session.user.id

  return <CurrentTeamClient initials={initials} userId={userId} />
}
