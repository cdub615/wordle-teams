'use client'

import CurrentMonthScores from '@/components/current-month-scores'
import MyTeams from '@/components/my-teams'
import ScoresTable from '@/components/scores-table/scores-table'
import ScoringSystem from '@/components/scoring-system'
import { AppContextProvider } from '@/lib/app-context'
import { Team } from '@/lib/types'
import { startOfMonth } from 'date-fns'
import { useState } from 'react'

/*
  create team with name, search for player by email or name, and invite if not found
  have somewhere for user to add their board for the day, and they'll have to provide the answer
  for previous months, show total scores by player in a simple card
  wall of fame, have a way for players to mark boards in either wall
  wall of shame
*/

const AppGrid = ({ teamsData }: { teamsData: any[] }) => {
  const teams = teamsData.map((t: any) => new Team(t))
  const [selectedTeam, setSelectedTeam] = useState(teams[0])
  const [selectedMonth, setSelectedMonth] = useState(startOfMonth(new Date()))

  return (
    <AppContextProvider value={{ teams, selectedTeam, setSelectedTeam, selectedMonth, setSelectedMonth }}>
      <div className='p-4 grid gap-2 @md/root:grid-cols-3 @md/root:p-12 @md/root:gap-6'>
        <ScoresTable
          classes={'@md/root:col-span-3'}
        />
        <MyTeams />
        <CurrentMonthScores />
        <ScoringSystem classes={'@md/root:row-span-3'} />
        <CurrentMonthScores />
        <CurrentMonthScores />
      </div>
    </AppContextProvider>
  )
}

export default AppGrid
