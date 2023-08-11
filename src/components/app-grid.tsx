'use client'

import CurrentMonthScores from '@/components/current-month-scores'
import CurrentTeam from '@/components/current-team'
import MyTeams from '@/components/my-teams'
import { ScoresTable } from '@/components/scores-table'
import ScoringSystem from '@/components/scoring-system'
import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog'
import { AppContextProvider } from '@/lib/app-context'
import { Team, User } from '@/lib/types'
import { Session } from '@supabase/auth-helpers-nextjs'
import { startOfMonth } from 'date-fns'
import { useEffect, useState } from 'react'
import Login from './login'

/*
  create team with name, search for player by email or name, and invite if not found
  have somewhere for user to add their board for the day, and they'll have to provide the answer
  for previous months, show total scores by player in a simple card
  wall of fame, have a way for players to mark boards in either wall
  wall of shame
*/

const AppGrid = ({ teamsData, session }: { teamsData: any[]; session: Session | null }) => {
  const teams = teamsData.map((t: any) => new Team(t))
  const [selectedTeam, setSelectedTeam] = useState(teams[0])
  const [selectedMonth, setSelectedMonth] = useState(startOfMonth(new Date()))
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => {
    if (session) setLoginOpen(false)
    else setLoginOpen(true)
  }, [session, loginOpen])

  if (!teamsData) return <div>Loading...</div>

  return (
    <AppContextProvider
      value={{ teams, selectedTeam, setSelectedTeam, selectedMonth, setSelectedMonth }}
    >
      <div className='p-2 grid gap-2 @md:grid-cols-3 @md:p-12 @md:gap-6'>
        <ScoresTable classes={'@md:col-span-3'} />
        <CurrentTeam />
        <MyTeams />
        <ScoringSystem classes={'@md:row-span-3'} />
        <CurrentMonthScores />
        <CurrentMonthScores />
      </div>
      <AlertDialog open={loginOpen} onOpenChange={setLoginOpen}>
        <AlertDialogContent>
          <Login />
        </AlertDialogContent>
      </AlertDialog>
    </AppContextProvider>
  )
}

export default AppGrid
