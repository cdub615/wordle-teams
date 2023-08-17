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
import { Team, players, teams } from '@/lib/types'
import { Session } from '@supabase/auth-helpers-nextjs'
import { startOfMonth } from 'date-fns'
import { useEffect, useState } from 'react'

const AppGrid = ({ teamsData, session }: { teamsData: any; session: Session | null }) => {
  const initialTeams = teamsData.teams?.map((t: teams) => {
    const players = teamsData.players.filter((p: players) => t.player_ids.includes(p.id) || t.creator === p.id)
    return Team.prototype.fromDbTeam(t, players)
  })

  const [teams, setTeams] = useState(initialTeams)
  const [selectedTeam, setSelectedTeam] = useState(teams[0])
  const [selectedMonth, setSelectedMonth] = useState(startOfMonth(new Date()))
  const [userId, setUserId] = useState(session?.user.id!)
  const [loginOpen, setLoginOpen] = useState(false)
  const [createTeamOpen, setCreateTeamOpen] = useState(!selectedTeam)

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

  if (createTeamOpen)
    return (
      <Dialog open={createTeamOpen}>
        <CreateTeam
          teams={teams}
          setTeams={setTeams}
          setCreateTeamOpen={setCreateTeamOpen}
          setSelectedTeam={setSelectedTeam}
        />
      </Dialog>
    )

  return (
    <AppContextProvider
      value={{
        teams,
        setTeams,
        selectedTeam,
        setSelectedTeam,
        selectedMonth,
        setSelectedMonth,
        userId,
        setUserId,
      }}
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
