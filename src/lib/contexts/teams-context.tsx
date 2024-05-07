'use client'

import { Team, User, team_with_players } from '@/lib/types'
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useEffect, useState } from 'react'
import {isBrowser} from '../utils'

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
  const [month, setMonth] = useState(() => {
    if (isBrowser()) {
      const selectedMonth = localStorage.getItem('selectedMonth')
      return selectedMonth ? new Date(selectedMonth) : new Date()
    }
    return new Date()
  })
  const [teamId, setTeamId] = useState(() => {
    if (isBrowser()) {
      const selectedTeam = localStorage.getItem('selectedTeam')
      return selectedTeam ? Number.parseInt(selectedTeam) : _teams[0]?.id ?? -1
    }
    return _teams[0]?.id ?? -1
  })
  const [user, setUser] = useState<User>(_user)

  useEffect(() => {
    localStorage.setItem('selectedMonth', month.toISOString())
  }, [month])

  useEffect(() => {
    localStorage.setItem('selectedTeam', teamId.toString())
  }, [teamId])

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
