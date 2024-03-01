import ActionButtons from '@/components/action-buttons'
import { CurrentTeam, MyTeams, ScoresTable, ScoringSystem, SkeletonTable } from '@/components/app-grid-items'
import { TeamsProvider } from '@/lib/contexts/teams-context'
import { Database } from '@/lib/database.types'
import { createClient } from '@/lib/supabase/server'
import { player_with_scores, team_with_players, teams } from '@/lib/types'
import { getSession, getUserInitials, setInitialsCookie, validParams } from '@/lib/utils'
import { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

const checkInitials = async (initialsParam: string, supabase: SupabaseClient<Database>) => {
  let initials
  const cookieStore = cookies()
  const initialsCookie = cookieStore.get('initials')
  if (!initialsCookie || !initialsCookie.value || initialsCookie.value.length === 0) {
    const session = await getSession(supabase)
    if (!session) redirect('/login')
    const initials = getUserInitials(session.user)
    // TODO verify we have what we need here and don't get sent to complete profile when we shouldn't
    if (!initials || initials.length === 0) redirect('/complete-profile')

    await setInitialsCookie(initials)
    if (initials !== initialsParam) redirect(`/${initials}`)
  } else if (initialsCookie.value !== initialsParam) redirect(`/${initials}`)
}

const getTeams = async (initialsParam: string): Promise<team_with_players[]> => {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)
  await checkInitials(initialsParam, supabase)

  const { data: teams } = await supabase.from('teams').select('*').returns<teams[]>()
  const playerIds = teams?.flatMap((t) => t.player_ids) ?? []
  const { data: players } = await supabase
    .from('players')
    .select('*, daily_scores ( id, created_at, player_id, date, answer, guesses )')
    .in('id', playerIds)
    .returns<player_with_scores[]>()

  const teamsWithPlayers =
    teams?.map((t) => {
      const teamPlayers = players?.filter((p) => t.player_ids.includes(p.id)) ?? []
      return { ...t, players: teamPlayers } as team_with_players
    }) ?? []

  return teamsWithPlayers
}

export default async function Page({ params }: { params: { initials: string; teamId: string; month: string } }) {
  const { initials, teamId: teamIdString, month } = params
  if (!validParams(initials, teamIdString, month)) redirect('/')
  else {
    const teamId = Number.parseInt(teamIdString)
    const teams = await getTeams(initials)

    return (
      <div className='p-2 grid gap-2 md:grid-cols-3 md:p-12 md:gap-6'>
        <TeamsProvider initialTeams={teams}>
          <ActionButtons classes={'md:col-span-3'} initials={initials} teamId={teamId} month={month} />
          <Suspense fallback={<SkeletonTable classes={'md:col-span-3'} />}>
            <ScoresTable classes={'md:col-span-3'} teamId={teamId} month={month} />
          </Suspense>
          <CurrentTeam initials={initials} teamId={teamId} />
          <MyTeams />
          <ScoringSystem teamId={teamId} classes={'md:row-span-3'} />
        </TeamsProvider>
      </div>
    )
  }
}
