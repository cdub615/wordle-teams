'use client'

import { Team, team_with_players } from '@/lib/types'
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useState } from 'react'

type TeamsContext = {
  teams: Team[]
  setTeams: Dispatch<SetStateAction<Team[]>>
  teamId: number
  setTeamId: Dispatch<SetStateAction<number>>
  month: Date
  setMonth: Dispatch<SetStateAction<Date>>
  subscriber: boolean
  setSubscriber: Dispatch<SetStateAction<boolean>>
}

const TeamsContext = createContext<TeamsContext | undefined>(undefined)

type TeamsProviderProps = {
  initialTeams: team_with_players[]
  isSubscriber: boolean
  children: ReactNode
}

export function TeamsProvider({ initialTeams, isSubscriber, children }: TeamsProviderProps) {
  const _teams = initialTeams?.map((t: team_with_players) => Team.prototype.fromDbTeam(t, t.players)) ?? []
  const [teams, setTeams] = useState(_teams)
  const [month, setMonth] = useState(new Date())
  const [teamId, setTeamId] = useState(_teams[0]?.id ?? -1)
  const [subscriber, setSubscriber] = useState(isSubscriber)
  return (
    <TeamsContext.Provider
      value={{ teams, setTeams, teamId, setTeamId, month, setMonth, subscriber, setSubscriber }}
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
