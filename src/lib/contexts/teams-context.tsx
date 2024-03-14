'use client'

import { createClient } from '@/lib/supabase/client'
import { Team, UserToken, team_with_players } from '@/lib/types'
import {  jwtDecode } from 'jwt-decode'
import { Dispatch, ReactNode, SetStateAction, createContext, useContext, useEffect, useState } from 'react'

type TeamsContext = {
  teams: Team[]
  setTeams: Dispatch<SetStateAction<Team[]>>
  teamId: number
  setTeamId: Dispatch<SetStateAction<number>>
  month: Date
  setMonth: Dispatch<SetStateAction<Date>>
  proMember: boolean
  setProMember: Dispatch<SetStateAction<boolean>>
}

const TeamsContext = createContext<TeamsContext | undefined>(undefined)

type TeamsProviderProps = {
  initialTeams: team_with_players[]
  isProMember: boolean
  children: ReactNode
}

export function TeamsProvider({ initialTeams, isProMember, children }: TeamsProviderProps) {
  const _teams = initialTeams?.map((t: team_with_players) => Team.prototype.fromDbTeam(t, t.players)) ?? []
  const [teams, setTeams] = useState(_teams)
  const [month, setMonth] = useState(new Date())
  const [teamId, setTeamId] = useState(_teams[0]?.id ?? -1)
  const [proMember, setProMember] = useState(isProMember)

  const supabase = createClient()

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const jwt = jwtDecode<UserToken>(session.access_token)
        const membershipStatus = jwt.user_member_status
        if (membershipStatus === 'pro' && !proMember) {
          setProMember(true)
        } else if (membershipStatus !== 'pro' && proMember) {
          setProMember(false)
        }
      }
    })
    return subscription.unsubscribe()
  }, [])

  return (
    <TeamsContext.Provider
      value={{ teams, setTeams, teamId, setTeamId, month, setMonth, proMember, setProMember }}
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
