'use client'

import { Team, team_with_players } from '@/lib/types'
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useState } from 'react'

const TeamsContext = createContext<[Team[], Dispatch<SetStateAction<Team[]>>] | undefined>(undefined)

type TeamsProviderProps = {
  initialTeams: team_with_players[]
  children: ReactNode
}

export function TeamsProvider({ initialTeams, children }: TeamsProviderProps) {
  const _teams = initialTeams?.map((t: team_with_players) => Team.prototype.fromDbTeam(t, t.players)) ?? []
  const [teams, setTeams] = useState(_teams)
  return <TeamsContext.Provider value={[teams, setTeams]}>{children}</TeamsContext.Provider>
}

export function useTeams() {
  const context = useContext(TeamsContext)
  if (context === undefined) {
    throw new Error('useTeams must be used within a TeamsProvider')
  }
  return context
}
