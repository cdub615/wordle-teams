'use client'

import CurrentMonthScores from '@/components/current-month-scores'
import MyTeams from '@/components/my-teams'
import ScoresTable from '@/components/scores-table/scores-table'
import ScoringSystem from '@/components/scoring-system'
import { Team } from '@/lib/types'
import { startOfMonth } from 'date-fns'
import { useState } from 'react'

/*
  create team with name, search for player by email or name, and invite if not found
  have somewhere for user to add their board for the day, and they'll have to provide the answer
  have table that shows current month score for team per player per day
    allow user to change month and team displayed if they're on multiple teams
  show scoring system
  for previous months, show total scores by player in a simple card
  wall of fame, have a way for players to mark boards in either wall
  wall of shame
*/

const AppGrid = ({ teamsData }: { teamsData: any[] }) => {
  const teams = teamsData.map((t: any) => new Team(t))
  const [selectedTeam, setSelectedTeam] = useState(teams[0])
  const [selectedMonth, setSelectedMonth] = useState(startOfMonth(new Date()))

  return (
    <div className='p-4 grid gap-2 @md/root:grid-cols-3 @md/root:p-12 @md/root:gap-6'>
      <ScoresTable
        teams={teams}
        team={selectedTeam}
        setTeam={setSelectedTeam}
        month={new Date(selectedMonth)}
        setMonth={setSelectedMonth}
        classes={'@md/root:col-span-3'}
      />
      <MyTeams teams={teams} />
      <CurrentMonthScores team={selectedTeam} />
      <ScoringSystem teamSystem={selectedTeam.scoringSystem} classes={'@md/root:row-span-3'} />
      <CurrentMonthScores team={selectedTeam} />
      <CurrentMonthScores team={selectedTeam} />
    </div>
  )
}

export default AppGrid
