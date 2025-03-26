import ActionButtons from '@/components/action-buttons'
import {
  CurrentTeam,
  MyTeams,
  ScoresTable,
  ScoringSystem,
  SkeletonTable,
  TeamBoards,
} from '@/components/app-grid-items'
import { TeamsProvider } from '@/lib/contexts/teams-context'

import { createClient } from '@/lib/supabase/server'
import { User } from '@/lib/types'
import type { Metadata } from 'next'
import { log } from 'next-axiom'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Intro from './intro'
import { getTeams } from './utils'

export const metadata: Metadata = {
  title: 'Dashboard',
}

export default async function Page() {
  const supabase = createClient(await cookies())
  const { _user, teams, hasSession, hasName } = await getTeams(supabase)
  if (!hasSession) redirect('/login')
  if (!hasName) redirect('/complete-profile')
  let user: User = _user!

  const { data, error } = await supabase
    .from('player_customer')
    .select('*')
    .eq('player_id', _user!.id)
    .maybeSingle()

  if (error) {
    log.error('Failed to fetch customer', { error })
  } else if (data && data.membership_status !== user.memberStatus) {
    revalidatePath('/me', 'layout')
    user = { ...user, memberStatus: data.membership_status, memberVariant: data.membership_variant }
  } else if (!teams || teams.length === 0)
    return (
      <TeamsProvider initialTeams={teams} _user={user}>
        <Intro />
      </TeamsProvider>
    )

  return (
    <div className='p-2 grid gap-2 md:grid-cols-3 md:p-12 md:gap-6 mb-12'>
      <TeamsProvider initialTeams={teams} _user={user}>
        <ActionButtons classes={'md:col-span-3'} userId={user.id} />
        <Suspense fallback={<SkeletonTable classes={'md:col-span-3'} />}>
          <ScoresTable classes={'md:col-span-3'} />
        </Suspense>
        <TeamBoards classes={'md:row-span-3'} />
        <CurrentTeam />
        <ScoringSystem proMember={user.memberStatus === 'pro'} classes={'md:row-span-3'} />
        <MyTeams userId={user.id} />
      </TeamsProvider>
    </div>
  )
}
