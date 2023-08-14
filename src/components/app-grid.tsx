'use client'

import ActionButtons from '@/components/action-buttons'
import CreateTeam from '@/components/create-team'
import CurrentTeam from '@/components/current-team'
import Login from '@/components/login'
import MyTeams from '@/components/my-teams'
import ScoresTable from '@/components/scores-table'
import ScoringSystem from '@/components/scoring-system'
import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import { Dialog } from '@/components/ui/dialog'
import { AppContextProvider } from '@/lib/app-context'
import { Team } from '@/lib/types'
import { Session } from '@supabase/auth-helpers-nextjs'
import { startOfMonth } from 'date-fns'
import { useEffect, useState } from 'react'

const AppGrid = ({ teamsData, session }: { teamsData: Team[]; session: Session | null }) => {
  const initialTeams = teamsData?.map((t: Team) => Team.prototype.hydrate(t))

  const [teams, setTeams] = useState(initialTeams)
  const [selectedTeam, setSelectedTeam] = useState(teams[0])
  const [selectedMonth, setSelectedMonth] = useState(startOfMonth(new Date()))
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    if (session) setLoginOpen(false)
    else setLoginOpen(true)
  }, [session, loginOpen])

  if (!session)
    return (
      <AlertDialog open={loginOpen} onOpenChange={setLoginOpen}>
        <AlertDialogContent>
          <Login />
        </AlertDialogContent>
      </AlertDialog>
    )

  if (!selectedTeam)
    return (
      <Dialog open={true}>
        <CreateTeam teams={teams} setTeams={setTeams} setCreateTeamOpen={() => {}} />
      </Dialog>
    )

  return (
    <AppContextProvider
      value={{ teams, setTeams, selectedTeam, setSelectedTeam, selectedMonth, setSelectedMonth }}
    >
      <div className='p-2 grid gap-2 @md:grid-cols-3 @md:p-12 @md:gap-6'>
        <ActionButtons classes={'@md:col-span-3'} />
        <ScoresTable classes={'@md:col-span-3'} />
        <CurrentTeam userId={session.user.id} />
        <MyTeams />
        <ScoringSystem classes={'@md:row-span-3'} />
      </div>
    </AppContextProvider>
  )
}

export default AppGrid
