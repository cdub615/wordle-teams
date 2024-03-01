'use client'

import { Team, team_with_players } from '@/lib/types'
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useState } from 'react'
import { monthAsDate } from '../utils'

type TeamsContext = {
  teams: Team[]
  setTeams: Dispatch<SetStateAction<Team[]>>
  teamId: number
  setTeamId: Dispatch<SetStateAction<number>>
  selectedMonth: Date
  setSelectedMonth: Dispatch<SetStateAction<Date>>
}

const TeamsContext = createContext<TeamsContext | undefined>(undefined)

type TeamsProviderProps = {
  initialTeams: team_with_players[]
  initialTeamId: number
  month: string
  children: ReactNode
}

export function TeamsProvider({ initialTeams, initialTeamId, month, children }: TeamsProviderProps) {
  const _teams = initialTeams?.map((t: team_with_players) => Team.prototype.fromDbTeam(t, t.players)) ?? []
  const [teams, setTeams] = useState(_teams)
  const initialSelectedMonth = month === 'current' ? new Date() : monthAsDate(month)
  const [selectedMonth, setSelectedMonth] = useState(initialSelectedMonth)
  const [teamId, setTeamId] = useState(initialTeamId)
  return (
    <TeamsContext.Provider value={{ teams, setTeams, teamId, setTeamId, selectedMonth, setSelectedMonth }}>
      {children}
    </TeamsContext.Provider>
  )
}

export function useTeams() {
  const context = useContext(TeamsContext)
  if (context === undefined) {
    throw new Error('useTeams must be used within a TeamsProvider')
  }
  return context
}
