'use client'

import { Team, User, team_with_players } from '@/lib/types'
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useState } from 'react'

type TeamsContext = {
  teams: Team[]
  setTeams: Dispatch<SetStateAction<Team[]>>
  teamId: number
  setTeamId: Dispatch<SetStateAction<number>>
  month: Date
  setMonth: Dispatch<SetStateAction<Date>>
  user: User
  setUser: Dispatch<SetStateAction<User>>
}

const TeamsContext = createContext<TeamsContext | undefined>(undefined)

type TeamsProviderProps = {
  initialTeams: team_with_players[]
  _user: User
  children: ReactNode
}

export function TeamsProvider({ initialTeams, _user, children }: TeamsProviderProps) {
  const _teams = initialTeams?.map((t: team_with_players) => Team.prototype.fromDbTeam(t, t.players)) ?? []
  const [teams, setTeams] = useState(_teams)
  const [month, setMonth] = useState(new Date())
  const [teamId, setTeamId] = useState(_teams[0]?.id ?? -1)
  const [user, setUser] = useState<User>(_user)

  return (
    <TeamsContext.Provider
      value={{
        teams,
        setTeams,
        teamId,
        setTeamId,
        month,
        setMonth,
        user,
        setUser,
      }}
    >
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
